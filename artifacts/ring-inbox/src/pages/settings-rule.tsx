import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useAuth } from "@clerk/react";
import { useReviewRuleForm, seedNewRuleDraft, TRIGGERS, OUTPUTS, RULE_PROMPT_MAX, RULE_INPUT_MAX, triggerHint } from "@workspace/api-client-react";
import type { ReviewRuleInput } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskTitleField as GrowingTextField } from "@/components/task-title-field";
import { ReviewActivity } from "@/components/review-activity";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

const btn = "rounded-md px-3 py-1.5 text-sm disabled:opacity-50";
const field = "rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "text-xs uppercase tracking-wide text-muted-foreground";

function Num({ value, onChange, min, max, testId }: { value: number; onChange: (n: number) => void; min: number; max: number; testId: string }) {
  return <input type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : ""} data-testid={testId}
    onChange={e => onChange(e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)))} className={`${field} w-20`} />;
}

export default function RulePage() {
  const params = useParams<{ id?: string }>();
  const id = !params.id || params.id === "new" ? null : params.id;
  const [, setLocation] = useLocation();
  const { userId } = useAuth();
  const f = useReviewRuleForm(userId, id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"discard" | "duplicate" | null>(null);
  const { values: v, dirty, rule } = f;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function back() {
    if (dirty) { setConfirmAction("discard"); return; }
    leave();
  }
  function leave() {
    f.discard();
    setLocation("/settings/prompts");
  }

  async function save(override?: Partial<ReviewRuleInput>) {
    const next = await f.save(override);
    if (next && !id) setLocation(`/settings/prompts/${next.id}`, { replace: true });
  }

  function duplicate() {
    if (!userId || !v) return;
    if (dirty) { setConfirmAction("duplicate"); return; }
    copyRule();
  }
  function copyRule() {
    if (!userId || !v) return;
    seedNewRuleDraft(userId, v);
    setLocation("/settings/prompts/new");
  }

  async function destroy() {
    if (await f.destroy()) setLocation("/settings/prompts");
  }

  const head = <button type="button" onClick={back} data-testid="button-back-prompts" className="text-sm text-muted-foreground hover:text-foreground">&lsaquo; Prompts</button>;
  if (!userId || (id && f.query.isLoading)) return <div className="space-y-4">{head}<Skeleton className="h-10 w-40" /><Skeleton className="h-28 w-full" /></div>;
  if (id && (f.query.isError || !rule)) return <div className="space-y-4">{head}<div className="rounded-lg border border-destructive/40 p-5 text-sm">Could not load this rule. It may have been deleted. <button className="underline" data-testid="button-retry" onClick={() => f.query.refetch()}>Retry</button></div></div>;
  if (!v) return null;

  const set = f.set;
  const usedBy = id ? f.otherRules.filter(r => r.inputRuleIds.includes(id)) : [];
  const toggleInput = (rid: string) => set("inputRuleIds", v.inputRuleIds.includes(rid) ? v.inputRuleIds.filter(x => x !== rid) : [...v.inputRuleIds, rid]);

  return (
    <div className="space-y-6">
      {head}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">{id ? "Rule" : "New rule"}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" role="status" data-testid="text-rule-status">{f.saving ? "Saving…" : dirty ? "Unsaved" : f.saved ? "Saved" : ""}</span>
          {id && <button type="button" onClick={duplicate} data-testid="button-duplicate-rule" className={`${btn} text-muted-foreground hover:text-foreground`}>Duplicate</button>}
          {id && <button type="button" onClick={() => setConfirmDelete(true)} data-testid="button-delete-rule" className={`${btn} text-muted-foreground hover:text-destructive`}>Delete</button>}
          {id && dirty && <button type="button" onClick={f.discard} className={`${btn} text-muted-foreground hover:text-foreground`}>Revert</button>}
          <button type="button" disabled={!f.canSave} onClick={() => void save()} data-testid="button-save-rule" className={`${btn} bg-primary text-primary-foreground`}>{id ? "Save" : "Create"}</button>
        </div>
      </div>
      {(f.error || (dirty && f.invalid)) && <p role="alert" className="text-sm text-destructive" data-testid="text-rule-error">{f.error || f.invalid}</p>}

      <ConfirmationDialog open={confirmDelete} onOpenChange={setConfirmDelete}
        title={`Delete “${rule?.name}”?`}
        description={`Its reports, overview, and run history are deleted. Your messages and tasks are not touched.${usedBy.length ? ` This rule is an input to ${usedBy.map(r => r.name).join(", ")}; remove it there first.` : ""}`}
        action={f.deleting ? "Deleting…" : "Delete rule"} destructive pending={f.deleting}
        testId="button-confirm-delete-rule" onConfirm={() => void destroy()} />
      <ConfirmationDialog open={confirmAction !== null} onOpenChange={open => { if (!open) setConfirmAction(null); }}
        title={confirmAction === "duplicate" ? "Duplicate with your edits?" : "Discard unsaved changes?"}
        description={confirmAction === "duplicate" ? "The copy will include your unsaved edits. The original rule will not be changed." : "Your unsaved rule changes will be discarded."}
        action={confirmAction === "duplicate" ? "Duplicate rule" : "Discard changes"}
        destructive={confirmAction !== "duplicate"} onConfirm={confirmAction === "duplicate" ? copyRule : leave} />

      <section className="divide-y divide-border rounded-lg border border-border bg-card">
        <label className="flex items-center justify-between gap-3 px-4 py-3">
          <input value={v.name} onChange={e => set("name", e.target.value)} maxLength={120} placeholder="Rule name" data-testid="input-rule-name"
            className="font-display min-w-0 flex-1 bg-transparent text-xl outline-none placeholder:text-muted-foreground" />
          <span className="flex shrink-0 items-center gap-2 text-sm">
            <input type="checkbox" checked={v.enabled} onChange={e => set("enabled", e.target.checked)} data-testid="toggle-rule-enabled" />
            Enabled
          </span>
        </label>
        <label className="block px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className={label}>Prompt</span>
            <span className={`font-mono text-[11px] ${v.prompt.length > RULE_PROMPT_MAX ? "text-destructive" : "text-muted-foreground"}`}>{v.prompt.length > RULE_PROMPT_MAX * 0.8 ? `${v.prompt.length}/${RULE_PROMPT_MAX}` : ""}</span>
          </div>
          <GrowingTextField value={v.prompt} onChange={e => set("prompt", e.target.value)} data-testid="input-rule-prompt"
            placeholder="What should this rule look for, and what should it write?"
            style={{ minHeight: 104, fontSize: 16, lineHeight: "26px" }} className="app-content-text mt-2 w-full bg-transparent outline-none placeholder:text-muted-foreground" />
        </label>

        <div className="space-y-2 px-4 py-3">
          <span className={label}>When</span>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select value={v.trigger} onChange={e => set("trigger", e.target.value as ReviewRuleInput["trigger"])} data-testid="select-trigger" className={field}>
              {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {v.trigger === "quiet" && <><Num value={v.quietMinutes} onChange={n => set("quietMinutes", n)} min={1} max={1440} testId="input-quiet-minutes" /> quiet minutes</>}
            {v.trigger === "hourly" && <>every <Num value={v.intervalHours} onChange={n => set("intervalHours", n)} min={1} max={168} testId="input-interval-hours" /> hours</>}
            {v.trigger === "daily" && <>at <input type="time" value={v.dailyTime} onChange={e => set("dailyTime", e.target.value)} data-testid="input-daily-time" className={field} />
              <input value={v.timezone} onChange={e => set("timezone", e.target.value)} data-testid="input-timezone" className={`${field} w-44`} aria-label="Timezone" /></>}
          </div>
          <p className="text-xs text-muted-foreground">{triggerHint(v.trigger)}</p>
        </div>

        <div className="space-y-2 px-4 py-3 text-sm">
          <span className={label}>Reads</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>Last <Num value={v.lookbackHours} onChange={n => set("lookbackHours", n)} min={1} max={720} testId="input-lookback" /> hours of</span>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={v.includeMessages} onChange={e => set("includeMessages", e.target.checked)} data-testid="toggle-include-messages" />messages</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={v.includeTasks} onChange={e => set("includeTasks", e.target.checked)} data-testid="toggle-include-tasks" />tasks</label>
          </div>
          {f.otherRules.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Plus output from other rules{v.inputRuleIds.length >= RULE_INPUT_MAX ? ` (max ${RULE_INPUT_MAX})` : ""}. Loops between rules are rejected on save.</p>
              <div className="flex flex-wrap gap-1.5">
                {f.otherRules.map(r => {
                  const on = v.inputRuleIds.includes(r.id);
                  return <button key={r.id} type="button" aria-pressed={on} disabled={!on && v.inputRuleIds.length >= RULE_INPUT_MAX} onClick={() => toggleInput(r.id)} data-testid={`toggle-input-${r.id}`}
                    className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${on ? "border-foreground/40 bg-secondary text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{r.name}</button>;
                })}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 px-4 py-3 text-sm">
          <span className={label}>Writes</span>
          <div className="flex flex-wrap gap-1.5">
            {OUTPUTS.map(o => <button key={o.value} type="button" aria-pressed={v.output === o.value} onClick={() => set("output", o.value)} data-testid={`output-${o.value}`}
              className={`rounded-md border px-2.5 py-1 ${v.output === o.value ? "border-foreground/40 bg-secondary" : "border-border text-muted-foreground hover:text-foreground"}`}>{o.label}</button>)}
          </div>
          <p className={`text-xs ${v.output === "tasks" ? "text-foreground" : "text-muted-foreground"}`} data-testid="text-output-hint">{OUTPUTS.find(o => o.value === v.output)?.hint}</p>
        </div>
      </section>

      {rule && <ReviewActivity accountId={userId} rule={rule} rules={f.rules.data ?? []} disabled={dirty} />}
    </div>
  );
}
