import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, FileText, Inbox as InboxIcon, LayoutDashboard, ListChecks, Menu, Settings as SettingsIcon, Webhook } from "lucide-react";
import { useGetSettings, getGetSettingsQueryKey, useGetOrganizer, getGetOrganizerQueryKey, useUpdateSettings } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useInboxStream } from "@/hooks/use-inbox-stream";
import { browserZone } from "@/lib/tz";
import { InboxDrawerContext } from "@/hooks/use-inbox-drawer";
import { InboxFeed } from "@/pages/inbox";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return <img src={`${basePath}/logo.svg`} alt="" className={className} />;
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/reminders", label: "Reminders", icon: BellRing },
];
const ADMIN = [
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function NavLink({ href, label, icon: Icon, active, count, onNav, onToggle, expanded }: { href: string; label: string; icon: typeof InboxIcon; active: boolean; count?: number; onNav: () => void; onToggle?: () => void; expanded?: boolean }) {
  const className = `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`;
  const content = <>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {count ? <span className="font-mono text-[11px] text-muted-foreground" data-testid={`count-${label.toLowerCase()}`}>{count}</span> : null}
    </>;
  return onToggle
    ? <button type="button" className={className} data-testid={`link-${label.toLowerCase()}`} aria-expanded={expanded} aria-controls="incoming-sidebar" onClick={onToggle}>{content}</button>
    : <Link href={href} onClick={onNav} data-testid={`link-${label.toLowerCase()}`} aria-current={active ? "page" : undefined} className={className}>{content}</Link>;
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button type="button" data-testid="button-logout" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => signOut({ redirectUrl: basePath || "/" })}>Sign out</button>;
}

function Denied() {
  const { user } = useUser();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6" data-testid="panel-denied">
        <Logo className="h-8 w-8" />
        <h1 className="mt-4 font-display text-3xl">Access denied</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.primaryEmailAddress?.emailAddress ?? "This account"} is not allowed on this inbox.</p>
        <div className="mt-5"><SignOutButton /></div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const search = useSearch();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const openInbox = (noteId?: string) => { setSelectedNote(noteId ?? null); setInboxOpen(true); setOpen(false); };
  useEffect(() => {
    const params = new URLSearchParams(search);
    const note = params.get("note");
    if (note) { setSelectedNote(note); setInboxOpen(true); }
    else if (params.get("inbox") === "1") { setSelectedNote(null); setInboxOpen(true); }
  }, [search]);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const menuButton = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const allowed = settings.data?.allowed === true;
  useInboxStream(allowed);
  const organizer = useGetOrganizer({ query: { queryKey: getGetOrganizerQueryKey(), enabled: allowed } });
  const update = useUpdateSettings();
  const tzSent = useRef(false);
  const mutateRef = useRef(update.mutate);
  mutateRef.current = update.mutate;

  const sendTz = useRef(() => {});
  sendTz.current = () => mutateRef.current({ data: { timezone: browserZone() } }, { onSuccess: (s) => qc.setQueryData(getGetSettingsQueryKey(), s) });
  useEffect(() => {
    if (!settings.data || !settings.data.allowed || settings.data.timezone !== null || tzSent.current) return;
    tzSent.current = true;
    sendTz.current();
  }, [settings.data]);

  useEffect(() => { setOpen(false); }, [loc]);

  if (settings.isLoading) {
    return <div className="flex min-h-[100dvh] bg-background"><div className="hidden w-60 border-r border-border md:block" /><div className="flex-1 space-y-3 p-8"><Skeleton className="h-8 w-40" /><Skeleton className="h-28 w-full max-w-3xl" /><Skeleton className="h-28 w-full max-w-3xl" /></div></div>;
  }
  if (settings.isError || !settings.data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="rounded-lg border border-destructive/40 bg-card p-5 text-sm">Could not load your account. <button className="underline" data-testid="button-retry-settings" onClick={() => settings.refetch()}>Retry</button> <SignOutButton /></div>
      </div>
    );
  }
  if (!allowed) return <Denied />;

  const items = organizer.data?.items ?? [];
  const openCount = (k: string) => items.filter((i) => i.kind === k && i.status === "open").length;
  const counts: Record<string, number> = { "/tasks": openCount("task"), "/reminders": openCount("reminder") };
  const close = () => setOpen(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" onClick={close} className="flex items-center gap-2 px-4 pb-4 pt-5" data-testid="link-home">
        <Logo className="h-6 w-6" />
        <span className="font-display text-xl">Ring Inbox</span>
      </Link>
      <nav className="flex flex-col gap-0.5 px-2" aria-label="Workspace">
        {NAV.map((n) => <NavLink key={n.href} {...n} active={n.href === "/inbox" ? inboxOpen : loc === n.href} count={counts[n.href]} onNav={close}
          onToggle={n.href === "/inbox" ? () => { setSelectedNote(null); setInboxOpen(value => !value); close(); } : undefined}
          expanded={n.href === "/inbox" ? inboxOpen : undefined} />)}
      </nav>
      <div className="mt-6 px-4 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Admin</div>
      <nav className="flex flex-col gap-0.5 px-2" aria-label="Settings">
        {ADMIN.map((n) => <NavLink key={n.href} {...n} active={loc === n.href} onNav={close} />)}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3">
        <div className="truncate text-xs text-foreground" data-testid="text-user">{user?.primaryEmailAddress?.emailAddress}</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{settings.data.isOwner ? "Owner" : "Member"}</span>
          <SignOutButton />
        </div>
      </div>
    </div>
  );

  return (
    <InboxDrawerContext.Provider value={{ openInbox }}>
    <div className="min-h-[100dvh] bg-background md:flex">
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 border-r border-border bg-sidebar md:block">{sidebar}</aside>
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur md:hidden">
        <button ref={menuButton} type="button" aria-label="Open navigation" data-testid="button-menu" onClick={() => setOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Menu className="h-4 w-4" /></button>
        <Logo className="h-5 w-5" /><span className="font-display text-lg">Ring Inbox</span>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" onCloseAutoFocus={(event) => { event.preventDefault(); menuButton.current?.focus(); }} className="w-64 border-r border-border bg-sidebar p-0 md:hidden" aria-describedby={undefined} data-testid="sheet-nav">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1 lg:flex">
      {wide && inboxOpen && <section id="incoming-sidebar" aria-label="Incoming messages" className="animate-in slide-in-from-left-4 motion-reduce:animate-none min-w-0 border-b border-border px-4 py-6 lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:w-80 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r xl:w-96">
        <header className="mb-4 flex shrink-0 flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl">Incoming messages</h2>
          <button type="button" data-testid="button-close-inbox" className="rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
            setInboxOpen(false);
            document.querySelector<HTMLButtonElement>('button[data-testid="link-inbox"]')?.focus();
          }}>Close inbox</button>
        </header>
        <div tabIndex={0} aria-label="Incoming message feed" className="max-h-[50dvh] min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-h-none lg:flex-1">
          <InboxFeed embedded selectedNote={selectedNote} />
        </div>
      </section>}
      {!wide && <Sheet open={inboxOpen} onOpenChange={setInboxOpen}>
        <SheetContent id="incoming-sidebar" side="left" aria-describedby={undefined} className="flex w-full max-w-full flex-col border-border bg-background p-4 sm:max-w-md" onCloseAutoFocus={(event) => {
          event.preventDefault();
          const inboxButton = document.querySelector<HTMLButtonElement>('button[data-testid="link-inbox"]');
          if (inboxButton?.getClientRects().length) inboxButton.focus(); else menuButton.current?.focus();
        }}>
          <header className="flex items-center justify-between gap-2 pr-7">
            <SheetTitle className="font-display text-2xl font-normal">Incoming messages</SheetTitle>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setInboxOpen(false)}>Close inbox</button>
          </header>
          <div tabIndex={0} aria-label="Incoming message feed" className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <InboxFeed embedded selectedNote={selectedNote} />
          </div>
        </SheetContent>
      </Sheet>}
      <main className="min-w-0 flex-1"><div className="app-page">
        {update.isError && settings.data.timezone === null && (
          <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-sm" data-testid="banner-timezone-error">
            Could not save your timezone. <button type="button" className="underline disabled:opacity-50" disabled={update.isPending} data-testid="button-retry-timezone" onClick={() => sendTz.current()}>Retry</button>
          </div>
        )}
        {children}
      </div></main>
      </div>
    </div>
    </InboxDrawerContext.Provider>
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
