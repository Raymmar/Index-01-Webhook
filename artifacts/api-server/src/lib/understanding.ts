import OpenAI from "openai";
import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { PromptInstructions } from "@workspace/api-zod";
import { buildExtractionMessages } from "./extraction-prompt";

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
      ),
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
  instructions?: PromptInstructions;
}) {
  const referenceAt = input.receivedAt ?? input.recordedAt;
  if (input.transcript.length > 30_000)
    throw new Error("Transcript exceeds processing limit");
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
    messages: buildExtractionMessages(input.transcript, referenceAt, input.timezone, input.instructions),
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
      if (item.localDueAt !== null && item.minutesFromRecording !== null) {
        const error = new Error("AI returned conflicting deadline formats");
        error.name = "TaskDateError";
        throw error;
      }
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
      const resolved = resolveDue(dated, referenceAt, input.timezone);
      if (resolved.dueAt && resolved.dueAt < referenceAt) {
        const error = new Error("AI returned a deadline before message receipt");
        error.name = "TaskDateError";
        throw error;
      }
      return {
        ...item,
        kind: "task" as const,
        ...resolved,
      };
    })
    .filter((item) => {
      const key = `${item.kind}:${item.title.toLowerCase()}:${item.dueAt?.toISOString() ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
