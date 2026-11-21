import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSettings, getGetSettingsQueryKey, useUpdateSettings, type SettingsUpdate } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { browserZone, zones } from "@/lib/tz";

const field = "rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="text-sm">{label}</div>{hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}</div>
      <div className="sm:shrink-0">{children}</div>
    </div>
  );
}

function errMsg(e: unknown): string {
  const d = (e as { data?: { error?: string; message?: string } } | null)?.data;
  return d?.error || d?.message || "Could not save. Try again.";
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const update = useUpdateSettings();
  const s = q.data;
  const allZones = useMemo(() => zones(), []);
  const [tz, setTz] = useState("");
  const [model, setModel] = useState("");
  const [err, setErr] = useState("");
  const [providerErr, setProviderErr] = useState("");

  useEffect(() => { if (s) { setTz(s.timezone ?? browserZone()); setModel(s.aiModel || "gpt-5-mini"); } }, [s]);

  function save(data: SettingsUpdate) {
    setErr("");
    if (data.aiProvider !== undefined) setProviderErr("");
    update.mutate({ data }, {
      onSuccess: (next) => { qc.setQueryData(getGetSettingsQueryKey(), next); },
      onError: (e) => {
        if (data.aiProvider !== undefined) setProviderErr(errMsg(e));
        else setErr(errMsg(e));
      },
    });
  }

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-40" /><Skeleton className="h-32 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError || !s) return <div className="rounded-lg border border-destructive/40 p-5 text-sm">Could not load settings. <button className="underline" data-testid="button-retry" onClick={() => q.refetch()}>Retry</button></div>;

  const zoneList = allZones.includes(tz) || !tz ? allZones : [tz, ...allZones];
  const directMissing = s.aiProvider === "openai" && !s.directKeyConfigured;
  const choices = s.availableModels ?? [];
  const customModel = s.aiProvider === "openai" && !choices.includes(model);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Settings</h1>
      {err && <p role="alert" className="text-sm text-destructive" data-testid="text-settings-error">{err}</p>}

      <Section title="Account">
        <Row label="Timezone" hint="Task dates use this zone.">
          <select value={tz} disabled={update.isPending} data-testid="select-timezone" className={`${field} w-full sm:w-64`}
            onChange={(e) => { setTz(e.target.value); save({ timezone: e.target.value }); }}>
            {zoneList.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </Row>
      </Section>

      <Section title="Extraction">
        <Link href="/settings/prompts" data-testid="link-prompts" className="flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/50">
          <span>Prompts</span><span className="text-muted-foreground">&rsaquo;</span>
        </Link>
      </Section>

      {s.isOwner && (
        <>
          <Section title="Access">
            <Row label="Allow additional users" hint="Others can sign up and keep their own private inbox.">
              <Switch checked={s.allowSignups} disabled={update.isPending} onCheckedChange={(v) => save({ allowSignups: v })} data-testid="switch-allow-signups" />
            </Row>
          </Section>

          <Section title="Understanding">
            <Row label="Provider" hint={s.aiProvider === "replit" ? (s.managedConfigured ? "Replit AI Integrations is configured." : "Replit AI Integrations is not configured.") : s.directKeyConfigured ? "OPENAI_API_KEY is configured." : undefined}>
              <div className="space-y-2">
              <div className="flex rounded-md border border-border p-0.5 text-sm" role="radiogroup" aria-label="AI provider" aria-describedby={providerErr || directMissing ? "provider-warning" : undefined}>
                {([["replit", "Replit managed"], ["openai", "OpenAI direct"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={s.aiProvider === v} disabled={update.isPending} data-testid={`radio-provider-${v}`}
                    onClick={() => { setProviderErr(""); if (v !== s.aiProvider) save({ aiProvider: v, aiModel: "gpt-5-mini" }); }}
                    className={`rounded px-3 py-1 disabled:opacity-60 ${s.aiProvider === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
                ))}
              </div>
              {(providerErr || directMissing) && <p id="provider-warning" role="alert" className="max-w-xs text-xs text-destructive" data-testid="text-provider-error">{providerErr || "Set OPENAI_API_KEY in server secrets first"}</p>}
              </div>
            </Row>
            <Row label="Model">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const m = model.trim(); if (m && m !== s.aiModel) save({ aiModel: m }); }}>
                <div className="space-y-2">
                  <select aria-label="AI model" value={customModel ? "__custom" : model} disabled={update.isPending} onChange={(e) => setModel(e.target.value === "__custom" ? "" : e.target.value)} data-testid="select-model" className={`${field} w-full font-mono text-[13px] sm:w-64`}>
                    {!choices.includes(model) && !customModel && <option value={model} disabled>{model} (unavailable)</option>}
                    {choices.map(m => <option key={m} value={m}>{m}</option>)}
                    {s.aiProvider === "openai" && <option value="__custom">Custom model</option>}
                  </select>
                  {customModel && <input aria-label="Custom OpenAI model ID" value={model} onChange={(e) => setModel(e.target.value)} maxLength={100} spellCheck={false} placeholder="Model ID" data-testid="input-model" className={`${field} w-full font-mono text-[13px]`} />}
                </div>
                <button disabled={update.isPending || !model.trim() || model.trim() === s.aiModel || (s.aiProvider === "replit" && !choices.includes(model))} data-testid="button-save-model" className="rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">Save</button>
              </form>
            </Row>
          </Section>
        </>
      )}
    </div>
  );
}
