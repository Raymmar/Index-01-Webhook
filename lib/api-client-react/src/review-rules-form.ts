import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetReviewRuleQueryKey, getListReviewRulesQueryKey, getListReviewRunsQueryKey,
  listReviewRuns, useCreateReviewRule, useDeleteReviewRule, useGetReviewRule, useListReviewRules, useListReviewRuns,
  useRunReviewRule, useUndoReviewRun, useUpdateReviewOverview, useUpdateReviewRule,
} from "./generated/api";
import type { ReviewRule, ReviewRuleInput, ReviewRun, ReviewSource } from "./generated/api.schemas";

export const RULE_PROMPT_MAX = 12000;
export const RULE_NAME_MAX = 120;
export const OVERVIEW_MAX = 24000;
export const RULE_INPUT_MAX = 10;

export const TRIGGERS = [
  { value: "manual", label: "Manual" },
  { value: "quiet", label: "After a quiet period" },
  { value: "hourly", label: "Every few hours" },
  { value: "daily", label: "Daily" },
] as const;

export const OUTPUTS = [
  { value: "report", label: "Report", hint: "Writes a report for each run. Nothing else changes." },
  { value: "overview", label: "Overview", hint: "Keeps one persistent overview up to date. You can edit it between runs." },
  { value: "tasks", label: "Tasks", hint: "Allows automatic changes to open task titles and dates, and combining duplicates by dismissing them. Each run can be undone from history. Messages and tasks are never deleted." },
] as const;

export const listRulesKey = (a: string) => [...getListReviewRulesQueryKey(), a] as const;
export const ruleKey = (a: string, id: string) => [...getGetReviewRuleQueryKey(id), a] as const;
export const runsKey = (a: string, id: string) => [...getListReviewRunsQueryKey(id), a] as const;

function localTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } }

export function newRuleInput(): ReviewRuleInput {
  return {
    name: "", prompt: "", enabled: false, trigger: "manual", quietMinutes: 30, intervalHours: 4,
    dailyTime: "21:00", timezone: localTz(), lookbackHours: 24, includeMessages: true, includeTasks: true,
    inputRuleIds: [], output: "report",
  };
}

export function toInput(r: ReviewRuleInput): ReviewRuleInput {
  return {
    name: r.name, prompt: r.prompt, enabled: r.enabled, trigger: r.trigger, quietMinutes: r.quietMinutes,
    intervalHours: r.intervalHours, dailyTime: r.dailyTime, timezone: r.timezone, lookbackHours: r.lookbackHours,
    includeMessages: r.includeMessages, includeTasks: r.includeTasks, inputRuleIds: [...r.inputRuleIds], output: r.output,
  };
}

export const sameInput = (a: ReviewRuleInput, b: ReviewRuleInput) => JSON.stringify(toInput(a)) === JSON.stringify(toInput(b));

export function apiError(e: unknown, fallback = "Something went wrong. Try again."): string {
  const d = (e as { data?: { error?: string; message?: string } } | null)?.data;
  return d?.error || d?.message || (e as { message?: string } | null)?.message || fallback;
}

/** Client-side validation mirroring the API contract; returns a message or "". */
export function validateRule(v: ReviewRuleInput): string {
  if (!v.name.trim()) return "Name the rule.";
  if (v.name.length > RULE_NAME_MAX) return `Name is over ${RULE_NAME_MAX} characters.`;
  if (!v.prompt.trim()) return "Write the prompt.";
  if (v.prompt.length > RULE_PROMPT_MAX) return `Prompt is over ${RULE_PROMPT_MAX} characters.`;
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (v.trigger === "quiet" && !int(v.quietMinutes, 1, 1440)) return "Quiet minutes must be 1 to 1440.";
  if (v.trigger === "hourly" && !int(v.intervalHours, 1, 168)) return "Interval must be 1 to 168 hours.";
  if (v.trigger === "daily" && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v.dailyTime)) return "Daily time must be HH:mm.";
  if (v.trigger === "daily" && !v.timezone.trim()) return "Set a timezone.";
  if (!int(v.lookbackHours, 1, 720)) return "Look back must be 1 to 720 hours.";
  if (!v.includeMessages && !v.includeTasks && v.inputRuleIds.length === 0) return "Choose at least one input.";
  if (v.inputRuleIds.length > RULE_INPUT_MAX) return `Choose at most ${RULE_INPUT_MAX} rules as input.`;
  return "";
}

export function triggerSummary(r: ReviewRuleInput): string {
  switch (r.trigger) {
    case "quiet": return `After ${r.quietMinutes} quiet min`;
    case "hourly": return r.intervalHours === 1 ? "Hourly" : `Every ${r.intervalHours} h`;
    case "daily": return `Daily ${r.dailyTime}`;
    default: return "Manual";
  }
}

export function triggerHint(trigger: ReviewRuleInput["trigger"]): string {
  switch (trigger) {
    case "quiet": return "Runs once at least two new messages arrive and then nothing new comes in for the quiet period.";
    case "hourly": return "Runs on a fixed interval while enabled.";
    case "daily": return "Runs once a day at this local time.";
    default: return "Runs only when you choose Run now.";
  }
}

export const RUN_LABEL: Record<ReviewRun["status"], string> = {
  pending: "Queued", waiting: "Waiting", processing: "Running", completed: "Done", failed: "Failed", cancelled: "Cancelled",
};
export const runActive = (r: ReviewRun) => r.status === "pending" || r.status === "waiting" || r.status === "processing";
export const SOURCE_LABEL: Record<ReviewSource["kind"], string> = { message: "Message", task: "Task", review: "Review" };

const retained = new Map<string, ReviewRuleInput>();

/** Prefill the "new rule" draft (used by Duplicate). Copies start disabled. */
export function seedNewRuleDraft(accountId: string, from: ReviewRuleInput) {
  retained.set(`${accountId}:new`, { ...toInput(from), name: `${from.name} copy`.slice(0, RULE_NAME_MAX), enabled: false });
}

/**
 * Shared editor for one additional rule ("new" or id). A clean form tracks
 * server data (SSE refreshes are adopted); a dirty draft is retained across
 * navigation and never overwritten by server updates.
 */
export function useReviewRuleForm(accountId: string | null | undefined, id: string | null) {
  const qc = useQueryClient();
  const acct = accountId ?? "";
  const isNew = !id;
  const draftKey = acct ? `${acct}:${id ?? "new"}` : "";
  const query = useGetReviewRule(id ?? "", { query: { queryKey: ruleKey(acct, id ?? ""), enabled: !!acct && !!id } });
  const rules = useListReviewRules({ query: { queryKey: listRulesKey(acct), enabled: !!acct } });
  const create = useCreateReviewRule();
  const update = useUpdateReviewRule();
  const remove = useDeleteReviewRule();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scopeRef = useRef(draftKey); scopeRef.current = draftKey;
  const [draft, setDraft] = useState<ReviewRuleInput | null>(() => (draftKey ? retained.get(draftKey) ?? null : null));
  const [scope, setScope] = useState(draftKey);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (scope !== draftKey) { setScope(draftKey); setDraft(draftKey ? retained.get(draftKey) ?? null : null); setError(""); setSaved(false); }

  const rule = id ? query.data : undefined;
  const [blank] = useState(newRuleInput);
  const server: ReviewRuleInput | undefined = isNew ? blank : rule ? toInput(rule) : undefined;
  const values = draft ?? server ?? null;
  const dirty = !!(draft && server && !sameInput(draft, server));

  useEffect(() => { if (!isNew && draft && server && sameInput(draft, server)) setDraft(null); }, [draft, server, isNew]);
  useEffect(() => {
    if (!draftKey) return;
    if (dirty && draft) retained.set(draftKey, draft); else retained.delete(draftKey);
  }, [draftKey, dirty, draft]);

  const set = useCallback(<K extends keyof ReviewRuleInput>(field: K, value: ReviewRuleInput[K]) => {
    setSaved(false);
    setDraft(d => { const base = d ?? server; return base ? { ...base, [field]: value } : d; });
  }, [server]);

  const discard = useCallback(() => { if (draftKey) retained.delete(draftKey); setDraft(null); }, [draftKey]);

  const invalidate = useCallback((ruleId?: string) => {
    void qc.invalidateQueries({ queryKey: getListReviewRulesQueryKey() });
    if (ruleId) {
      void qc.invalidateQueries({ queryKey: getGetReviewRuleQueryKey(ruleId) });
      void qc.invalidateQueries({ queryKey: getListReviewRunsQueryKey(ruleId) });
    }
  }, [qc]);

  const invalid = values ? validateRule(values) : "";
  const pending = create.isPending || update.isPending || remove.isPending;

  /** Saves; resolves to the saved rule (or null on failure). */
  const save = useCallback(async (override?: Partial<ReviewRuleInput>): Promise<ReviewRule | null> => {
    const base = draft ?? server;
    if (!base) return null;
    const body = toInput({ ...base, ...override });
    const msg = validateRule(body);
    if (msg) { setError(msg); return null; }
    const at = draftKey;
    setError(""); setSaved(false);
    try {
      const next = id ? await update.mutateAsync({ id, data: body }) : await create.mutateAsync({ data: body });
      if (!at || scopeRef.current !== at) return next;
      qc.setQueryData(ruleKey(acct, next.id), next);
      invalidate(next.id);
      const r = retained.get(at);
      if (r && sameInput(r, body)) retained.delete(at);
      if (mounted.current) { setDraft(d => (d === draft || isNew ? null : d)); setSaved(true); }
      return next;
    } catch (e) {
      if (mounted.current && scopeRef.current === at) setError(apiError(e, "Could not save. Try again."));
      return null;
    }
  }, [draft, server, draftKey, id, isNew, update, create, qc, acct, invalidate]);

  const destroy = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    setError("");
    try {
      await remove.mutateAsync({ id });
      if (draftKey) retained.delete(draftKey);
      qc.removeQueries({ queryKey: getGetReviewRuleQueryKey(id) });
      void qc.invalidateQueries({ queryKey: getListReviewRulesQueryKey() });
      return true;
    } catch (e) { if (mounted.current) setError(apiError(e, "Could not delete.")); return false; }
  }, [id, remove, draftKey, qc]);

  const otherRules = (rules.data ?? []).filter(r => r.id !== id);

  return {
    query, rule, rules, otherRules, values, dirty, error, saved, pending, invalid, isNew,
    saving: create.isPending || update.isPending, deleting: remove.isPending,
    canSave: !!values && (dirty || isNew) && !invalid && !pending,
    set, discard, save, destroy, setError,
  };
}

/** Run history, run-now/retry, undo, and editable overview for one rule. */
export function useReviewRuleActivity(accountId: string | null | undefined, rule: ReviewRule | undefined) {
  const qc = useQueryClient();
  const acct = accountId ?? "";
  const id = rule?.id ?? "";
  const runs = useListReviewRuns(id, undefined, { query: { queryKey: runsKey(acct, id), enabled: !!acct && !!id } });
  const run = useRunReviewRule();
  const undo = useUndoReviewRun();
  const overview = useUpdateReviewOverview();
  const [error, setError] = useState("");
  const [more, setMore] = useState<ReviewRun[]>([]);
  const [moreDone, setMoreDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setMore([]); setMoreDone(false); setError(""); }, [id, acct]);

  const scopeRef = useRef(`${acct}:${id}`); scopeRef.current = `${acct}:${id}`;
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getListReviewRunsQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetReviewRuleQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getListReviewRulesQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/api/organizer"] });
  }, [qc, id]);

  const runNow = useCallback(async () => {
    if (!id) return;
    setError("");
    const at = scopeRef.current;
    try {
      const r = await run.mutateAsync({ id });
      if (scopeRef.current !== at) return;
      qc.setQueryData<ReviewRun[]>(runsKey(acct, id), old => old ? [r, ...old.filter(x => x.id !== r.id)] : [r]);
      refresh();
    } catch (e) { if (scopeRef.current === at) setError(apiError(e, "Could not start a run.")); }
  }, [id, run, qc, acct, refresh]);

  const undoRun = useCallback(async (runId: string) => {
    if (!id) return;
    setError("");
    const at = scopeRef.current;
    try {
      const r = await undo.mutateAsync({ id, runId });
      if (scopeRef.current !== at) return;
      qc.setQueryData<ReviewRun[]>(runsKey(acct, id), old => old?.map(x => (x.id === r.id ? r : x)));
      refresh();
    } catch (e) { if (scopeRef.current === at) setError(apiError(e, "Could not undo.")); }
  }, [id, undo, qc, acct, refresh]);

  const loadMore = useCallback(async () => {
    const all = [...(runs.data ?? []), ...more];
    const last = all[all.length - 1];
    if (!id || !last) return;
    setLoadingMore(true);
    const at = scopeRef.current;
    try {
      const page = await listReviewRuns(id, { before: last.createdAt });
      if (scopeRef.current !== at) return;
      setMore(m => [...m, ...page]);
      if (page.length < 50) setMoreDone(true);
    } catch (e) { setError(apiError(e, "Could not load older runs.")); }
    finally { setLoadingMore(false); }
  }, [id, runs.data, more]);

  const all = [...(runs.data ?? []), ...more.filter(m => !(runs.data ?? []).some(r => r.id === m.id))];
  const hasMore = !moreDone && all.length >= 50;

  return {
    runs, all, error, hasMore, loadingMore, loadMore, runNow, undoRun,
    running: run.isPending, undoing: undo.isPending,
    hasActive: all.some(runActive),
    overview: useOverviewDraft(acct, rule, overview.mutateAsync, overview.isPending, qc),
  };
}

type OverviewDraft = { text: string; revision: number };
const overviewDrafts = new Map<string, OverviewDraft>();

function useOverviewDraft(
  acct: string, rule: ReviewRule | undefined,
  mutateAsync: ReturnType<typeof useUpdateReviewOverview>["mutateAsync"], saving: boolean,
  qc: ReturnType<typeof useQueryClient>,
) {
  const key = acct && rule ? `${acct}:${rule.id}` : "";
  const keyRef = useRef(key); keyRef.current = key;
  const [draft, setDraft] = useState<OverviewDraft | null>(() => (key ? overviewDrafts.get(key) ?? null : null));
  const [scope, setScope] = useState(key);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (scope !== key) { setScope(key); setDraft(key ? overviewDrafts.get(key) ?? null : null); setError(""); setSaved(false); }
  const server = rule?.overview ?? "";
  const text = draft?.text ?? server;
  const dirty = draft !== null && draft.text !== server;
  // A draft started on an older revision means the overview changed underneath it.
  const stale = dirty && !!rule && draft!.revision !== rule.revision;
  useEffect(() => { if (draft && !dirty) setDraft(null); }, [draft, dirty]);
  useEffect(() => { if (key) { if (dirty && draft) overviewDrafts.set(key, draft); else overviewDrafts.delete(key); } }, [key, dirty, draft]);
  const save = useCallback(async () => {
    if (!rule || !draft) return;
    if (draft.text.length > OVERVIEW_MAX) { setError(`Overview is over ${OVERVIEW_MAX} characters.`); return; }
    const at = key, sent = draft;
    setError(""); setSaved(false);
    try {
      const next = await mutateAsync({ id: rule.id, data: { text: sent.text, revision: sent.revision } });
      void qc.invalidateQueries({ queryKey: getListReviewRulesQueryKey() });
      if (overviewDrafts.get(at) === sent) overviewDrafts.delete(at);
      if (keyRef.current !== at) return;
      qc.setQueryData(ruleKey(acct, rule.id), next);
      setDraft(d => (d === sent ? null : d)); setSaved(true);
    } catch (e) {
      if (keyRef.current === at) setError(apiError(e, "Could not save the overview. It changed since you started editing."));
    }
  }, [rule, draft, mutateAsync, qc, acct, key]);
  return {
    text, dirty, stale, error, saved, saving,
    set: (t: string) => { setSaved(false); setDraft(d => ({ text: t, revision: d?.revision ?? rule?.revision ?? 1 })); },
    discard: () => { if (key) overviewDrafts.delete(key); setDraft(null); setError(""); },
    save,
  };
}
