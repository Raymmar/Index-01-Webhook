import { Link } from "wouter";
import { format } from "date-fns";
import type { ReviewRule, ReviewRun, ReviewSource } from "@workspace/api-client-react";
import { useReviewRuleActivity, RUN_LABEL, SOURCE_LABEL, OVERVIEW_MAX, runActive } from "@workspace/api-client-react";
import { TaskTitleField as GrowingTextField } from "@/components/task-title-field";

const btn = "rounded-md px-3 py-1.5 text-sm disabled:opacity-50";
const when = (s: string) => format(new Date(s), "MMM d, HH:mm");

function SourceRef({ s, rules }: { s: ReviewSource; rules: ReviewRule[] }) {
  const label = <><span className="text-muted-foreground">{SOURCE_LABEL[s.kind]}</span> {s.label}</>;
  if (s.kind === "message") return <Link href={`/dashboard?note=${encodeURIComponent(s.id)}`} className="hover:underline">{label}</Link>;
  if (s.kind === "review") {
    const r = rules.find(x => x.id === s.id);
    if (r) return <Link href={`/settings/prompts/${r.id}`} className="hover:underline">{label}</Link>;
  }
  return <span>{label}</span>;
}

function Run({ run, rule, rules, onUndo, undoing }: { run: ReviewRun; rule: ReviewRule; rules: ReviewRule[]; onUndo: (id: string) => void; undoing: boolean }) {
  const failed = run.status === "failed";
  return (
    <li className="space-y-2 px-4 py-3" data-testid={`run-${run.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span><span className={failed ? "text-destructive" : runActive(run) ? "text-foreground" : ""}>{RUN_LABEL[run.status]}</span> · {when(run.createdAt)}{run.ruleRevision !== rule.revision ? " · earlier version" : ""}</span>
        <span>Window {when(run.windowStart)} to {when(run.windowEnd)}</span>
      </div>
      {run.error && <p className="text-sm text-destructive">{run.error}</p>}
      {run.report && <div className="app-content-text whitespace-pre-wrap break-words text-sm">{run.report}</div>}
      {run.changedTaskIds.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{run.changedTaskIds.length} task{run.changedTaskIds.length > 1 ? "s" : ""} changed{run.undoneAt ? ` · undone ${when(run.undoneAt)}` : ""}</span>
          {!run.undoneAt && <button type="button" disabled={undoing} onClick={() => onUndo(run.id)} data-testid={`button-undo-${run.id}`} className="underline hover:text-foreground disabled:opacity-50">Undo</button>}
        </div>
      )}
      {run.sources.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{run.sources.length} source{run.sources.length > 1 ? "s" : ""}</summary>
          <ul className="mt-1 space-y-0.5">{run.sources.map(s => <li key={`${s.kind}-${s.id}`} className="break-words"><SourceRef s={s} rules={rules} /></li>)}</ul>
        </details>
      )}
    </li>
  );
}

export function ReviewActivity({ accountId, rule, rules, disabled }: { accountId: string; rule: ReviewRule; rules: ReviewRule[]; disabled: boolean }) {
  const a = useReviewRuleActivity(accountId, rule);
  const o = a.overview;
  const latestFailed = a.all[0]?.status === "failed";

  return (
    <div className="space-y-6">
      {rule.output === "overview" && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl">Overview</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground" role="status">{o.saving ? "Saving…" : o.dirty ? "Unsaved" : o.saved ? "Saved" : rule.overviewUpdatedAt ? `Updated ${when(rule.overviewUpdatedAt)}` : ""}</span>
              {o.dirty && <button type="button" onClick={o.discard} className={`${btn} text-muted-foreground hover:text-foreground`}>Revert</button>}
              <button type="button" disabled={!o.dirty || o.saving} onClick={() => void o.save()} data-testid="button-save-overview" className={`${btn} bg-primary text-primary-foreground`}>Save overview</button>
            </div>
          </div>
          {o.error && <p role="alert" className="text-sm text-destructive">{o.error}</p>}
          {o.stale && <p className="text-xs text-muted-foreground" data-testid="text-overview-stale">A newer overview arrived while you were editing. Revert to see it, or save to try your version.</p>}
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <GrowingTextField value={o.text} onChange={e => o.set(e.target.value)} data-testid="input-overview" placeholder="Empty until the first run."
              style={{ minHeight: 104, fontSize: 16, lineHeight: "26px" }} className="app-content-text w-full bg-transparent outline-none placeholder:text-muted-foreground" />
            {o.text.length > OVERVIEW_MAX * 0.8 && <div className={`text-right font-mono text-[11px] ${o.text.length > OVERVIEW_MAX ? "text-destructive" : "text-muted-foreground"}`}>{o.text.length}/{OVERVIEW_MAX}</div>}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl">History</h2>
          <div className="flex items-center gap-2">
            {disabled && <span className="text-xs text-muted-foreground">Save changes to run</span>}
            <button type="button" disabled={disabled || a.running} onClick={() => void a.runNow()} data-testid="button-run-now" className={`${btn} border border-border hover:bg-secondary`}>{a.running ? "Starting…" : latestFailed ? "Retry" : "Run now"}</button>
          </div>
        </div>
        {a.error && <p role="alert" className="text-sm text-destructive">{a.error}</p>}
        {a.runs.isLoading && <div className="h-16 animate-pulse rounded-lg bg-secondary/60" />}
        {a.runs.isError && <div className="rounded-lg border border-destructive/40 p-4 text-sm">Could not load history. <button className="underline" onClick={() => a.runs.refetch()}>Retry</button></div>}
        {a.runs.isSuccess && a.all.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-runs">No runs yet.</p>}
        {a.all.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {a.all.map(r => <Run key={r.id} run={r} rule={rule} rules={rules} onUndo={id => void a.undoRun(id)} undoing={a.undoing} />)}
          </ul>
        )}
        {a.hasMore && <button type="button" disabled={a.loadingMore} onClick={() => void a.loadMore()} className={`${btn} text-muted-foreground hover:text-foreground`}>{a.loadingMore ? "Loading…" : "Older runs"}</button>}
      </section>
    </div>
  );
}
