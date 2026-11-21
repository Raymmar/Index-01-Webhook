import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { usePromptForm, PROMPT_FIELDS, PROMPT_MAX } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskTitleField as GrowingTextField } from "@/components/task-title-field";

const btn = "rounded-md px-3 py-1.5 text-sm disabled:opacity-50";

export default function PromptsPage() {
  const [, setLocation] = useLocation();
  const { userId } = useAuth();
  const f = usePromptForm(userId);
  const [showSkill, setShowSkill] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const pre = useRef<HTMLPreElement>(null);
  const { query: q, data, values, dirty } = f;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function back() {
    if (dirty && !window.confirm("Discard unsaved prompt changes?")) return;
    f.discard();
    setLocation("/settings");
  }

  async function copySkill(text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      // Embedded previews may deny the asynchronous clipboard API.
      let ok = false;
      const el = pre.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges(); sel?.addRange(range);
        try { ok = document.execCommand("copy"); } catch { /* manual selection remains */ }
      }
      setCopy(ok ? "copied" : "manual");
    }
    setTimeout(() => setCopy(c => (c === "copied" ? "idle" : c)), 1500);
  }

  const head = (
    <button type="button" onClick={back} data-testid="button-back-settings" className="text-sm text-muted-foreground hover:text-foreground">&lsaquo; Settings</button>
  );

  if (q.isLoading || !userId) return <div className="space-y-4">{head}<Skeleton className="h-10 w-40" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>;
  if (q.isError || !data || !values) return <div className="space-y-4">{head}<div className="rounded-lg border border-destructive/40 p-5 text-sm">Could not load prompts. <button className="underline" data-testid="button-retry" onClick={() => q.refetch()}>Retry</button></div></div>;

  return (
    <div className="space-y-6">
      {head}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Prompts</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" role="status" data-testid="text-prompts-status">
            {f.saving ? "Saving…" : dirty ? "Unsaved" : f.saved ? "Saved" : ""}
          </span>
          <button type="button" disabled={f.atDefaults || f.saving} onClick={f.resetToDefaults} data-testid="button-reset-prompts" className={`${btn} text-muted-foreground hover:text-foreground`}>Reset to defaults</button>
          <button type="button" disabled={!f.canSave} onClick={() => void f.save()} data-testid="button-save-prompts" className={`${btn} bg-primary text-primary-foreground`}>Save</button>
        </div>
      </div>
      {f.error && <p role="alert" className="text-sm text-destructive" data-testid="text-prompts-error">{f.error}</p>}

      <section className="rounded-lg border border-border bg-card divide-y divide-border">
        {PROMPT_FIELDS.map(field => {
          const v = values[field.key];
          return (
            <label key={field.key} className="block px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xl">{field.label}&hellip;</span>
                <span className={`font-mono text-[11px] ${v.length > PROMPT_MAX ? "text-destructive" : "text-muted-foreground"}`}>{v.length > PROMPT_MAX * 0.8 ? `${v.length}/${PROMPT_MAX}` : ""}</span>
              </div>
              <GrowingTextField value={v}
                onChange={e => f.setField(field.key, e.target.value)}
                data-testid={`input-${field.key}`}
                style={{ minHeight: 104, fontSize: 16, lineHeight: "26px" }}
                className="app-content-text mt-2 w-full bg-transparent outline-none placeholder:text-muted-foreground" placeholder="(blank)" />
            </label>
          );
        })}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => setShowSkill(v => !v)} data-testid="button-toggle-skill" className="text-muted-foreground hover:text-foreground">{showSkill ? "Hide" : "Show"} compiled skill</button>
          {showSkill && <button type="button" data-testid="button-copy-skill" className="text-muted-foreground hover:text-foreground" onClick={() => void copySkill(data.skill)}>{copy === "copied" ? "Copied" : "Copy"}</button>}
          {showSkill && copy === "manual" && <span role="status" className="text-xs text-muted-foreground">Copying is blocked here. Text is selected; press Ctrl+C or ⌘C.</span>}
          {showSkill && dirty && <span className="text-xs text-muted-foreground">Reflects last save</span>}
        </div>
        {showSkill && <pre ref={pre} data-testid="text-skill" className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 font-mono text-sm">{data.skill}</pre>}
      </section>
    </div>
  );
}
