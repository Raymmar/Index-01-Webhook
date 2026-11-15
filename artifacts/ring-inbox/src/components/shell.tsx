import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return <img src={`${basePath}/logo.svg`} alt="" className={className} />;
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const nav = [{ href: "/inbox", label: "Inbox" }, { href: "/webhooks", label: "Webhooks" }];
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-5 px-5 py-3">
          <Link href="/inbox" className="flex items-center gap-2" data-testid="link-home">
            <Logo className="h-6 w-6" />
            <span className="font-display text-xl">Ring Inbox</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} data-testid={`link-${n.label.toLowerCase()}`}
                className={`rounded-md px-2.5 py-1 transition-colors ${loc === n.href ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline truncate max-w-[180px]" data-testid="text-user">{user?.primaryEmailAddress?.emailAddress}</span>
            <button type="button" data-testid="button-logout" className="hover:text-foreground" onClick={() => signOut({ redirectUrl: basePath || "/" })}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>
    </div>
  );
}

export function CopyField({ label, value, testId, secret }: { label: string; value: string; testId: string; secret?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  useEffect(() => { setStatus("idle"); }, [value]);
  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    const field = input.current;
    if (!field) return;
    field.focus();
    field.select();
    field.setSelectionRange(0, value.length);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      // Embedded previews may deny the asynchronous clipboard API.
      field.focus();
      field.select();
      field.setSelectionRange(0, value.length);
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* Manual selection remains available. */ }
      setStatus(copied ? "copied" : "manual");
    }
  }
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`flex items-stretch overflow-hidden rounded-md border ${secret ? "border-accent/60 bg-accent/5" : "border-border bg-card"}`}>
        <input ref={input} readOnly value={value} aria-label={label} spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-inset focus:ring-accent"
          data-testid={`text-${testId}`} />
        <button type="button" data-testid={`button-copy-${testId}`}
          aria-label={`Copy ${label}`}
          className="border-l border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onClick={copy}>
          {status === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-1 text-xs text-muted-foreground">
        {status === "manual" ? "Automatic copying is blocked. The value is selected—press Ctrl+C or ⌘C, or touch and hold to copy." : status === "copied" ? "Copied to clipboard." : ""}
      </p>
    </div>
  );
}
