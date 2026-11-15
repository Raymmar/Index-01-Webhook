// Curated text models supporting this app's chat/structured-output workflow.
// Provider IDs are intentionally explicit; family names such as gpt-5.6 are not IDs.
export const managedModels = ["gpt-5-mini", "gpt-5-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"];
export const directModels = ["gpt-5-mini", "gpt-5-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5.2"];

export function processingFailure(error: unknown) {
  const e = error as { status?: number; code?: string; name?: string };
  if (e?.code === "UNSUPPORTED_MODEL" || e?.code === "model_not_found")
    return { retry: false, message: "The selected model is unavailable for this provider. Choose a model in Settings, then retry." };
  if (e?.status === 401 || e?.status === 403)
    return { retry: false, message: "The AI provider denied access. Check the provider credentials or model access in Settings." };
  if (e?.status === 429)
    return { retry: true, message: "The AI provider's rate or usage limit was reached. Check available credits, then retry." };
  if (e?.status === 400 || e?.status === 404 || e?.status === 422)
    return { retry: false, message: "The AI provider rejected this request. Choose a model that supports structured text output, then retry." };
  if (e?.name === "APIConnectionTimeoutError" || e?.name === "APIConnectionError")
    return { retry: true, message: "The AI provider could not be reached or timed out. Retry this note." };
  if (e?.name === "ZodError" || e?.name === "SyntaxError")
    return { retry: true, message: "The AI returned an invalid result. Retry this note." };
  return { retry: true, message: "Could not organize this note after retrying. Check AI settings and retry." };
}
