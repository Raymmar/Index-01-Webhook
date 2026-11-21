import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { useListReviewRules, listRulesKey, triggerSummary, OUTPUTS } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

const row = "flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-secondary/50";

export default function PromptsPage() {
  const { userId } = useAuth();
  const acct = userId ?? "";
  const q = useListReviewRules({ query: { queryKey: listRulesKey(acct), enabled: !!acct } });
  const rules = q.data ?? [];

  return (
    <div className="space-y-6">
      <Link href="/settings" data-testid="button-back-settings" className="text-sm text-muted-foreground hover:text-foreground">&lsaquo; Settings</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Prompts</h1>
        <Link href="/settings/prompts/new" data-testid="link-new-rule" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">New rule</Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Always on</h2>
        <div className="rounded-lg border border-border bg-card">
          <Link href="/settings/prompts/extraction" data-testid="link-extraction" className={row}>
            <span className="min-w-0"><span className="block">Task extraction</span><span className="block text-xs text-muted-foreground">Runs on every new message. Cannot be disabled.</span></span>
            <span className="text-muted-foreground">Edit</span>
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Additional rules</h2>
        {(q.isLoading || !acct) && <Skeleton className="h-24 w-full" />}
        {q.isError && <div className="rounded-lg border border-destructive/40 p-4 text-sm">Could not load rules. <button className="underline" data-testid="button-retry-rules" onClick={() => q.refetch()}>Retry</button></div>}
        {q.isSuccess && rules.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground" data-testid="text-no-rules">
            No additional rules yet. A rule reads recent messages, tasks, or other rules' output and writes a report, keeps an overview, or tidies open tasks.
          </div>
        )}
        {rules.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {rules.map(r => (
              <Link key={r.id} href={`/settings/prompts/${r.id}`} data-testid={`link-rule-${r.id}`} className={row}>
                <span className="min-w-0">
                  <span className="block truncate">{r.name}</span>
                  <span className="block text-xs text-muted-foreground">{triggerSummary(r)} · {OUTPUTS.find(o => o.value === r.output)?.label}{r.inputRuleIds.length ? ` · ${r.inputRuleIds.length} rule input${r.inputRuleIds.length > 1 ? "s" : ""}` : ""}</span>
                </span>
                <span className={`shrink-0 text-xs ${r.enabled ? "text-foreground" : "text-muted-foreground"}`}>{r.enabled ? "On" : "Off"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
