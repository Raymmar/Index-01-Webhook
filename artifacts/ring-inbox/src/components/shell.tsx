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
            <span className="font-display text-xl">Index</span>
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

export function CopyField({ label, value, testId, secret, masked = false }: { label: string; value: string; testId: string; secret?: boolean; masked?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  useEffect(() => { setStatus("idle"); }, [value]);
  useEffect(() => {
    if (status === "manual") {
      input.current?.focus();
      input.current?.select();
    }
  }, [status]);
  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    const field = input.current;
    if (!field) return;
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
      if (copied) button.current?.focus();
    }
  }
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <button ref={button} type="button" data-testid={`button-copy-${testId}`}
          aria-label={`Copy ${label}`}
          className={`flex w-full items-stretch overflow-hidden rounded-md border text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${secret ? "border-accent/60 bg-accent/5" : "border-border bg-card"}`}
          onClick={copy}>
        <span aria-hidden="true" className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-[13px]" data-testid={`text-${testId}`}>
          {masked || secret ? "••••••••••••••••" : value}
        </span>
        <span className="flex items-center border-l border-border px-3 text-xs text-muted-foreground">
          {status === "copied" ? "Copied" : "Copy"}
        </span>
      </button>
      <input ref={input} readOnly value={value} aria-label={`Manually copy ${label}`} spellCheck={false}
        aria-hidden={status !== "manual"} tabIndex={status === "manual" ? 0 : -1}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => { if (status === "manual") setStatus("idle"); }}
        className={status === "manual" ? "mt-2 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-ring" : "sr-only"} />
      <p role="status" aria-live="polite" className="mt-1 text-xs text-muted-foreground">
        {status === "manual" ? "Automatic copying is blocked. The value is temporarily shown and selected—press Ctrl+C or ⌘C, or touch and hold to copy. It hides when you leave the field." : status === "copied" ? "Copied to clipboard." : ""}
      </p>
    </div>
  );
}
