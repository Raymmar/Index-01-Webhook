import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPromptsQueryKey, useGetPrompts, useUpdatePrompts } from "./generated/api";
import type { PromptInstructions } from "./generated/api.schemas";

export const PROMPT_MAX = 6000;
export const PROMPT_FIELDS: readonly { key: keyof PromptInstructions; label: string }[] = [
  { key: "taskRules", label: "Create tasks when" },
  { key: "dateRules", label: "Interpret dates using" },
  { key: "titleStyle", label: "Write task titles like" },
  { key: "personalContext", label: "Keep this context in mind" },
];

export const samePrompts = (a: PromptInstructions, b: PromptInstructions) =>
  PROMPT_FIELDS.every((f) => a[f.key] === b[f.key]);

/** Account-scoped prompts cache key; first element still matches SSE refreshes of /api/prompts. */
export const promptsQueryKey = (accountId: string) => [...getGetPromptsQueryKey(), accountId] as const;

// Unsaved drafts survive in-app navigation, scoped per signed-in account.
const retained = new Map<string, PromptInstructions>();

function promptError(e: unknown): string {
  const d = (e as { data?: { error?: string; message?: string } } | null)?.data;
  return d?.error || d?.message || (e as { message?: string } | null)?.message || "Could not save. Try again.";
}

/**
 * Shared prompt editor state. A clean form (no draft) always shows the latest
 * server instructions, so SSE/refetch updates are adopted; a dirty draft is
 * never replaced by server data.
 */
export function usePromptForm(accountId: string | null | undefined) {
  const qc = useQueryClient();
  const key = accountId ?? "";
  const query = useGetPrompts({ query: { queryKey: promptsQueryKey(key), enabled: !!key } });
  const mutation = useUpdatePrompts();
  const mutateAsync = mutation.mutateAsync;
  const currentAccount = useRef(key);
  currentAccount.current = key;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [draft, setDraftState] = useState<PromptInstructions | null>(() => (key ? retained.get(key) ?? null : null));
  const [scope, setScope] = useState(key);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const data = query.data;

  // Account switched under a mounted form: drop the old account's draft from view.
  if (scope !== key) { setScope(key); setDraftState(key ? retained.get(key) ?? null : null); setSaved(false); setError(""); }

  const server = data?.instructions;
  const values = draft ?? server ?? null;
  const dirty = !!(draft && server && !samePrompts(draft, server));

  // A draft that now matches the server is clean again.
  useEffect(() => { if (draft && server && samePrompts(draft, server)) setDraftState(null); }, [draft, server]);
  useEffect(() => {
    if (!key) return;
    if (dirty && draft) retained.set(key, draft); else retained.delete(key);
  }, [key, dirty, draft]);

  const setField = useCallback((field: keyof PromptInstructions, value: string) => {
    setSaved(false);
    setDraftState((d) => {
      const base = d ?? server;
      return base ? { ...base, [field]: value } : d;
    });
  }, [server]);

  const resetToDefaults = useCallback(() => {
    if (!data) return;
    setSaved(false);
    setDraftState({ ...data.defaults });
  }, [data]);

  const discard = useCallback(() => { if (key) retained.delete(key); setDraftState(null); }, [key]);

  const over = !!values && PROMPT_FIELDS.some((f) => values[f.key].length > PROMPT_MAX);
  const saveAccount = key;
  const save = useCallback(async () => {
    if (!draft) return;
    setError(""); setSaved(false);
    try {
      const next = await mutateAsync({ data: draft });
      // Drop late responses after sign-out, account switch, or unmount.
      if (!saveAccount || currentAccount.current !== saveAccount) return;
      qc.setQueryData(promptsQueryKey(saveAccount), next);
      // Editing remains available during saves; keep any newer unsaved draft.
      const retainedDraft = retained.get(saveAccount);
      if (retainedDraft && samePrompts(retainedDraft, draft)) retained.delete(saveAccount);
      if (!mounted.current) return;
      setDraftState((d) => (d === draft ? null : d));
      setSaved(true);
    } catch (e) {
      if (mounted.current && currentAccount.current === saveAccount) setError(promptError(e));
    }
  }, [draft, mutateAsync, qc, saveAccount]);

  return {
    query, data: key ? data : undefined, values: key ? values : null, dirty, over, error, saved,
    saving: mutation.isPending,
    atDefaults: !!(values && data && samePrompts(values, data.defaults)),
    canSave: dirty && !over && !mutation.isPending,
    setField, resetToDefaults, save, discard,
  };
}
