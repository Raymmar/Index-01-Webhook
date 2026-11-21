import type { PromptInstructions } from "@workspace/api-zod";

// Editable defaults, not hidden system policy. Empty saved fields stay empty.
export const defaultInstructions: PromptInstructions = {
  taskRules: "Create tasks for clear requests or commitments to do something. Keep observations, ideas, and test messages as notes. Create a separate task for each distinct action or independently scheduled deliverable, using shared context within the message. Do not create duplicate tasks just because an action is repeated.",
  dateRules: "Use the message's received date and time in my timezone as the anchor for every relative date. Distinguish historical context from the date requested for the action: 'yesterday I met Sam; remind me next Monday to follow up' means a future Monday follow-up, not a yesterday deadline. 'In a week' or 'a week out' means seven calendar days after receipt. 'Next week' means the following Monday–Sunday calendar week; without a named day, use Monday. 'Next Monday' means Monday in the following calendar week. A weekday without 'next' means its next occurrence, using today only if the requested time is still ahead. Keep actionable reminder deadlines at or after receipt; don't move them backward because background context mentions an earlier date. For a date without an hour, use the receipt's local hour and minute. Morning means 09:00, afternoon 13:00, evening 18:00, tonight 20:00. Explicit action dates and times take precedence. No timing request means no due date.",
  titleStyle: "Use a concise, readable action title with enough context to understand it on its own.",
  personalContext: "",
};

export function resolveInstructions(saved?: Partial<Record<keyof PromptInstructions, string | null>>): PromptInstructions {
  return {
    taskRules: saved?.taskRules ?? defaultInstructions.taskRules,
    dateRules: saved?.dateRules ?? defaultInstructions.dateRules,
    titleStyle: saved?.titleStyle ?? defaultInstructions.titleStyle,
    personalContext: saved?.personalContext ?? defaultInstructions.personalContext,
  };
}
export function renderSkill(instructions: PromptInstructions) {
  return [
    "# Task extraction skill",
    "## Create tasks when\n" + instructions.taskRules,
    "## Interpret dates using\n" + instructions.dateRules,
    "## Write task titles like\n" + instructions.titleStyle,
    "## Keep this context in mind\n" + instructions.personalContext,
  ].join("\n\n");
}
