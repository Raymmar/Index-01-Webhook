import { type ReactNode } from "react";
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
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
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
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`flex items-stretch overflow-hidden rounded-md border ${secret ? "border-accent/60 bg-accent/5" : "bg-card"}`}>
        <code className="flex-1 overflow-x-auto whitespace-nowrap px-3 py-2 font-mono text-[13px]" data-testid={`text-${testId}`}>{value}</code>
        <CopyButton value={value} testId={testId} />
      </div>
    </div>
  );
}

import { useState } from "react";
function CopyButton({ value, testId }: { value: string; testId: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" data-testid={`button-copy-${testId}`}
      className="border-l px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}
