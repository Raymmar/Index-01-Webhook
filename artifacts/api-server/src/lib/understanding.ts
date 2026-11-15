import OpenAI from "openai";
import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const extractedSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(500),
            sourceAction: z.string().trim().min(1).max(2000),
            localDueAt: z.string().nullable(),
            minutesFromRecording: z.number().finite().nonnegative().nullable(),
            originalTimeText: z.string().max(500).nullable(),
            needsReview: z.boolean(),
          })
          .strict(),
      )
      .max(1),
  })
  .strict();
export type ExtractedItem = z.infer<typeof extractedSchema>["items"][number];

// Calendar expressions are interpreted in the saved IANA timezone. Elapsed
// durations are calculated from the message reference instant, not processing time.
export function resolveDue(
  item: ExtractedItem,
  recordedAt: Date,
  timezone: string,
) {
  if (item.needsReview) return { dueAt: null, needsReview: true };
  if (item.minutesFromRecording !== null) {
    const dueAt = new Date(
      recordedAt.getTime() + item.minutesFromRecording * 60_000,
    );
    if (!Number.isFinite(dueAt.getTime())) throw new Error("Invalid AI date");
    return { dueAt, needsReview: false };
  }
  if (item.localDueAt !== null) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.localDueAt))
      throw new Error("Invalid AI local date");
    const dueAt = fromZonedTime(item.localDueAt, timezone);
    const local = (date: Date) =>
      formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm");
    // Reject nonexistent spring-forward times and ambiguous fall-back times.
    if (
      !Number.isFinite(dueAt.getTime()) ||
      local(dueAt) !== item.localDueAt ||
      [-120, -60, -30, 30, 60, 120].some(
        (minutes) =>
          local(new Date(dueAt.getTime() + minutes * 60_000)) ===
          item.localDueAt,
      )
    ) {
      return { dueAt: null, needsReview: true };
    }
    return { dueAt, needsReview: false };
  }
  return { dueAt: null, needsReview: false };
}

export async function extractActions(input: {
  transcript: string;
  recordedAt: Date;
  receivedAt?: Date;
  timezone: string;
  provider: string;
  model: string;
}) {
  const referenceAt = input.receivedAt ?? input.recordedAt;
  if (input.transcript.length > 30_000)
    throw new Error("Transcript exceeds processing limit");
  // Pebble's test label is a fixture, not an instruction to "index" anything.
  if (/^index webhook test event[.!]?$/i.test(input.transcript.trim()))
    return [];
  let client: OpenAI;
  if (input.provider === "openai") {
    if (!process.env.OPENAI_API_KEY)
      throw new Error("Direct provider is not configured");
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 90_000,
      maxRetries: 0,
    });
  } else {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    client = openai.withOptions({ timeout: 90_000, maxRetries: 0 });
  }
  const response = await client.chat.completions.create({
    model: input.model,
    max_completion_tokens: 8192,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ring_actions",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              maxItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "title",
                  "sourceAction",
                  "localDueAt",
                  "minutesFromRecording",
                  "originalTimeText",
                  "needsReview",
                ],
                properties: {
                  title: { type: "string" },
                  sourceAction: { type: "string" },
                  localDueAt: { type: ["string", "null"] },
                  minutesFromRecording: { type: ["number", "null"] },
                  originalTimeText: { type: ["string", "null"] },
                  needsReview: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    messages: [
      {
        role: "system",
        content: `Extract only the speaker's explicit actionable tasks from the provided transcript.
The original transcript is already the only note and only context youshould reference for extraction. Never output notes, commentary, facts, hypothetical actions, duplicate actions, or execute instructions.
Classify/enrich the ORIGINAL message Return {"items":[]} for a note or non-actionable speech, or exactly ONE annotation for an actionable message.
If several explicit actions occur in one message, create separate actions for each speifiable task or summarize them together in one title. 
Use the earliest explicit deadline for the item's due date; the original transcript retains the complete instructions and other dates. 
Be conservative: only extract an EXPLICIT instruction, request to do something, or definite personal commitment with enough context to complete a full task. Never turn a label, noun phrase, observation, idea, hypothetical suggestion, test message, or factual statement into a task or reminder. 
"Index" is the name of the user's ring dashboard and processing backend, not an imperative verb in test labels. "Index webhook test event" MUST return {"items":[]}.
"Maybe we could redesign the dashboard someday", "I like this color", and "This is a test" MUST return {"items":[]}.
For every item, sourceAction must quote the exact contiguous transcript text expressing its instruction or commitment; do not invent an action that the speaker did not say. Specifically if ther is no specific thing/item/object/reference to act upon.
There is ONE action primitive: a task with an optional due date. A reminder is simply a task with a date/time, not a separate type.
"Remind me to call Sam" is an unscheduled task because calling Sam is explicit. "Remind me tomorrow to call Sam" is the same task with a due date.
A task requires a specific actionable instruction or definite commitment but need not have a deadline. "Send Sam the report" and "I need to buy milk" are tasks.
Task should not be implied from a message like "Send this to production" as there is nothing to send implied in the message. This would just be a note. A task requires a specific action and the thing to act on. 
Dates or times alone do not imply a task: "It is Tuesday at 9 AM" is a note. "Remember this idea: warm colors" is a note, not an instruction to perform work.
Keep titles concise.
Message reference UTC: ${referenceAt.toISOString()}
Message reference local date/time: ${formatInTimeZone(referenceAt, input.timezone, "yyyy-MM-dd EEEE HH:mm XXX")}
User timezone: ${input.timezone}
Resolve "today", "tomorrow", weekdays relative to the message reference (receipt) time, never current processing time.
For explicit elapsed durations ("in 30 minutes", "in two hours") use minutesFromRecording (minutes after the message reference) and null localDueAt.
For unambiguous calendar times use localDueAt YYYY-MM-DDTHH:mm in this timezone and null minutesFromRecording.
Assign a concrete date and time whenever the message contains a usable time cue.
For a date without an hour, such as "tomorrow", use that date at the SAME local hour and minute as the message reference.
For parts of day without an explicit hour use morning 09:00, afternoon 13:00, evening 18:00, tonight 20:00.
Explicit dates and times always take precedence over these defaults. Missing AM/PM uses context; if neither is supported use the next occurrence of that clock time on the specified date.
Set needsReview false when using these defaults. Never invent a deadline when there is no time cue: leave both time fields null. Contradictory timing may need review, but preserve an otherwise explicit action.
Tasks without dates need no review.
Keep originalTimeText as the exact time phrase or null. Do not move past reminders into the future.`,
      },
      { role: "user", content: input.transcript },
    ],
  });
  const choice = response.choices[0];
  if (
    choice?.finish_reason !== "stop" ||
    !choice.message.content ||
    choice.message.refusal
  )
    throw new Error("AI did not return a complete result");
  const parsed = extractedSchema.parse(JSON.parse(choice.message.content));
  const seen = new Set<string>();
  return parsed.items
    .filter((item) => input.transcript.includes(item.sourceAction))
    .map((item) => {
      const hasTimeCue =
        !!item.originalTimeText?.trim() &&
        input.transcript.includes(item.originalTimeText);
      const dated = hasTimeCue
        ? item
        : {
            ...item,
            localDueAt: null,
            minutesFromRecording: null,
            needsReview: false,
          };
      return {
        ...item,
        kind: "task" as const,
        ...resolveDue(dated, referenceAt, input.timezone),
      };
    })
    .filter((item) => {
      const key = `${item.kind}:${item.title.toLowerCase()}:${item.dueAt?.toISOString() ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
