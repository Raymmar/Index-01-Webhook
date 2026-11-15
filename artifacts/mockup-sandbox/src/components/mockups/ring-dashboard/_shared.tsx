import { type ReactNode, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { BellRing, Check, Code2, CornerUpLeft, Inbox as InboxIcon, LayoutDashboard, ListChecks, Menu, MoreVertical, Settings as SettingsIcon, Trash2, Webhook, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import "./_group.css";

// Sandbox-only shapes mirror the visual fields used by the source API types.
export type ActionItem = {
  id: string; kind: "task" | "reminder"; title: string;
  status: "open" | "completed" | "dismissed"; dueAt: string | null;
  needsReview: boolean; originalTimeText?: string | null;
  sourceEventId: string | null; createdAt: string;
};
export type InboxEvent = {
  id: string; kind: string; transcription: string | null; webhookName: string;
  recordedAt: string | null; receivedAt: string;
  audioUrl?: string | null; audioSize?: number | null; payload: unknown;
};
export type ProcessingJob = { status: "pending" | "processing" | "completed" | "failed"; error?: string | null };
export type NavSection = "dashboard" | "inbox" | "tasks" | "reminders" | "webhooks" | "settings";

// Synthetic design fixtures only: no app/account data or network requests.
export const seededMessages: InboxEvent[] = [
  { id: "note-1", kind: "recording", transcription: "Review the first draft of the website before Friday. Also remind me to water the plants tomorrow morning at nine.", webhookName: "Ring", recordedAt: "2026-06-18T14:42:00Z", receivedAt: "2026-06-18T14:42:03Z", payload: { type: "recording", source: "ring", text: "Review the website draft and water the plants." } },
  { id: "note-2", kind: "recording", transcription: "Pick up a new sketchbook on the way home, and spend a little time exploring ideas for the reading corner.", webhookName: "Ring", recordedAt: "2026-06-18T12:18:00Z", receivedAt: "2026-06-18T12:18:02Z", payload: { type: "recording", source: "ring", text: "Pick up a sketchbook and explore reading corner ideas." } },
  { id: "note-3", kind: "recording", transcription: "Remind me to check the oven at six thirty tonight.", webhookName: "Ring", recordedAt: "2026-06-18T10:06:00Z", receivedAt: "2026-06-18T10:06:01Z", payload: { type: "recording", source: "ring", text: "Check the oven at six thirty." } },
  { id: "note-4", kind: "recording", transcription: "An idea for the weekend: take the long trail by the lake and bring a camera.", webhookName: "Ring", recordedAt: "2026-06-17T17:35:00Z", receivedAt: "2026-06-17T17:35:02Z", payload: { type: "recording", source: "ring", text: "Take the lake trail and bring a camera." } },
];
export const seededItems: ActionItem[] = [
  { id: "task-1", kind: "task", title: "Review the website draft", status: "open", dueAt: "2026-06-19T16:00:00Z", needsReview: false, sourceEventId: "note-1", createdAt: "2026-06-18T14:42:03Z" },
  { id: "task-2", kind: "task", title: "Pick up a new sketchbook", status: "open", dueAt: null, needsReview: false, sourceEventId: "note-2", createdAt: "2026-06-18T12:18:02Z" },
  { id: "task-3", kind: "task", title: "Explore ideas for the reading corner", status: "open", dueAt: null, needsReview: false, sourceEventId: "note-2", createdAt: "2026-06-18T12:18:02Z" },
  { id: "reminder-1", kind: "reminder", title: "Water the plants", status: "open", dueAt: "2026-06-19T09:00:00Z", needsReview: false, sourceEventId: "note-1", createdAt: "2026-06-18T14:42:03Z" },
  { id: "reminder-2", kind: "reminder", title: "Check the oven", status: "open", dueAt: "2026-06-18T18:30:00Z", needsReview: false, sourceEventId: "note-3", createdAt: "2026-06-18T10:06:01Z" },
];
export const messages = seededMessages;
export const items = seededItems;

// Copied from ring-inbox/src/components/shell.tsx (Logo, NAV, NavLink, sidebar,
// responsive shell). Auth/API effects removed; Link becomes a local button.
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/ring-logo.svg`} alt="" className={className} />;
}
const NAV = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "reminders", label: "Reminders", icon: BellRing },
] as const;
const ADMIN = [
  { key: "webhooks", label: "Webhooks", icon: Webhook },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;
function NavLink({ label, icon: Icon, active, count, onNav }: { label: string; icon: typeof InboxIcon; active: boolean; count?: number; onNav: () => void }) {
  return (
    <button type="button" onClick={onNav} data-testid={`link-${label.toLowerCase()}`} aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="flex-1 text-left">{label}</span>
      {count ? <span className="font-mono text-[11px] text-muted-foreground" data-testid={`count-${label.toLowerCase()}`}>{count}</span> : null}
    </button>
  );
}
export type ShellProps = {
  children: ReactNode; active?: NavSection; fullWidth?: boolean;
  originalSidebar?: boolean; items?: ActionItem[]; onNavigate?: (section: NavSection) => void;
};
export function Shell({ children, active = "dashboard", fullWidth = false, originalSidebar = false, items = seededItems, onNavigate }: ShellProps) {
  const [loc, setLoc] = useState<NavSection>(active);
  const [open, setOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setLoc(active); }, [active]);
  const nav = (section: NavSection) => { setLoc(section); setOpen(false); onNavigate?.(section); };
  const counts: Partial<Record<NavSection, number>> = {
    tasks: items.filter((i) => i.kind === "task" && i.status === "open").length,
    reminders: items.filter((i) => i.kind === "reminder" && i.status === "open").length,
  };
  const sidebar = (
    <div className="flex h-full flex-col">
      <button type="button" onClick={() => nav("inbox")} className="flex items-center gap-2 px-4 pb-4 pt-5" data-testid="link-home">
        <Logo className="h-6 w-6" />
        <span className="font-display text-xl">Ring Inbox</span>
      </button>
      <nav className="flex flex-col gap-0.5 px-2" aria-label="Workspace">
        {!originalSidebar && <NavLink label="Dashboard" icon={LayoutDashboard} active={loc === "dashboard"} onNav={() => nav("dashboard")} />}
        {NAV.map((n) => <NavLink key={n.key} label={n.label} icon={n.icon} active={loc === n.key} count={counts[n.key]} onNav={() => nav(n.key)} />)}
      </nav>
      <div className="mt-6 px-4 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Admin</div>
      <nav className="flex flex-col gap-0.5 px-2" aria-label="Settings">
        {ADMIN.map((n) => <NavLink key={n.key} label={n.label} icon={n.icon} active={loc === n.key} onNav={() => nav(n.key)} />)}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3">
        <div className="truncate text-xs text-foreground" data-testid="text-user">studio@example.test</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Owner</span>
          <button type="button" data-testid="button-logout" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSignedOut((value) => !value)}>{signedOut ? "Sign in" : "Sign out"}</button>
        </div>
      </div>
    </div>
  );
  return (
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
      <main className="min-w-0 flex-1"><div className={fullWidth ? "mx-auto px-5 py-8" : "mx-auto max-w-3xl px-5 py-8"}>
        {children}
      </div></main>
    </div>
  );
}

// Copied from ring-inbox/src/pages/inbox.tsx. API organize mutation and route
// links replaced with local state/callbacks; card markup/classes are unchanged.
function ts(s: string) { return format(new Date(s), "MMM d, h:mm a"); }
function size(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }
function Organize({ e, items, job, onNavigate }: { e: InboxEvent; items: ActionItem[]; job?: ProcessingJob; onNavigate?: (section: NavSection) => void }) {
  const [organized, setOrganized] = useState(false);
  if (!e.transcription) return null;
  const busy = job?.status === "pending" || job?.status === "processing";
  const tasks = items.filter((i) => i.kind === "task").length;
  const rems = items.filter((i) => i.kind === "reminder").length;
  const btn = "rounded px-1.5 py-0.5 text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  if (busy) return <span className="flex items-center gap-1.5" data-testid={`status-organizing-${e.id}`}><span className="ri-pulse h-1.5 w-1.5 rounded-full bg-accent" />Organizing</span>;
  if (job?.status === "failed" && !organized) return <span className="flex items-center gap-1 text-destructive" title={job.error ?? undefined} data-testid={`status-failed-${e.id}`}>Failed<button type="button" className={btn} data-testid={`button-retry-organize-${e.id}`} onClick={() => setOrganized(true)}>Retry</button></span>;
  if (items.length) return (
    <span className="flex items-center gap-2" data-testid={`text-extracted-${e.id}`}>
      {tasks > 0 && <button type="button" onClick={() => onNavigate?.("tasks")} className="hover:text-foreground">{tasks} {tasks === 1 ? "task" : "tasks"}</button>}
      {rems > 0 && <button type="button" onClick={() => onNavigate?.("reminders")} className="hover:text-foreground">{rems} {rems === 1 ? "reminder" : "reminders"}</button>}
    </span>
  );
  if (job?.status === "completed" || organized) return <span data-testid={`text-extracted-${e.id}`}>Nothing to organize</span>;
  return <button type="button" className={btn} data-testid={`button-organize-${e.id}`} onClick={() => setOrganized(true)}>Organize</button>;
}
export type EventCardProps = { e: InboxEvent; items?: ActionItem[]; job?: ProcessingJob; highlight?: boolean; onNavigate?: (section: NavSection) => void };
export function EventCard({ e, items = [], job, highlight = false, onNavigate }: EventCardProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight]);
  return (
    <article ref={ref} id={`event-${e.id}`} className={`ri-in rounded-lg border bg-card p-3 ${highlight ? "border-accent" : "border-border"}`} data-testid={`card-event-${e.id}`}>
      {e.transcription ? <p className="whitespace-pre-wrap break-words font-sans text-lg font-normal leading-relaxed" data-testid={`text-transcription-${e.id}`}>{e.transcription}</p> : <p className="text-sm text-muted-foreground">{e.kind === "recording" ? "Transcript unavailable" : "Webhook event received"}</p>}
      {e.audioUrl && (
        <div className="mt-2">
          <audio controls preload="none" src={e.audioUrl} className="h-8 w-full" data-testid={`audio-${e.id}`} />
        </div>
      )}
      <footer className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-1 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-40 truncate" title={e.webhookName}>{e.webhookName}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={e.recordedAt || e.receivedAt} title={`${e.recordedAt ? "Recorded" : "Received"} ${format(new Date(e.recordedAt || e.receivedAt), "PPpp")}`} data-testid={`text-received-${e.id}`}>{ts(e.recordedAt || e.receivedAt)}</time>
          {e.audioSize != null && <><span aria-hidden="true">·</span><span>{size(e.audioSize)}</span></>}
        </div>
        <div className="ml-auto flex shrink-0 items-center"><Organize e={e} items={items} job={job} onNavigate={onNavigate} /></div>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "Hide payload" : "Show payload"} title={open ? "Hide payload" : "Show payload"} aria-expanded={open} aria-controls={`payload-${e.id}`} data-testid={`button-payload-${e.id}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? "bg-secondary text-foreground" : ""}`}>
          <Code2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </footer>
      <pre id={`payload-${e.id}`} hidden={!open} aria-label="Event payload" className="mt-2 max-h-80 overflow-auto rounded-md bg-primary p-3 font-mono text-[12px] leading-relaxed text-primary-foreground">{JSON.stringify(e.payload, null, 2)}</pre>
    </article>
  );
}

// Local timezone adapter: date-fns-tz is not a sandbox dependency. Intl supplies
// the same wall-clock inputs; visual format matches ring-inbox/src/lib/tz.ts.
function wallDate(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
function toLocalInput(iso: string | null, tz: string) { return iso ? wallDate(iso, tz).slice(0, 16) : ""; }
function formatDue(iso: string, tz: string) { return format(new Date(wallDate(iso, tz)), "EEE, MMM d · h:mm a"); }
function tryLocalInput(value: string, tz: string): { iso: string | null; error?: string } {
  if (!value) return { iso: null };
  const target = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(target)) return { iso: null, error: "Invalid date." };
  let guess = target;
  for (let i = 0; i < 3; i++) guess += target - Date.parse(`${wallDate(new Date(guess).toISOString(), tz)}Z`);
  const iso = new Date(guess).toISOString();
  return toLocalInput(iso, tz) === value ? { iso } : { iso: null, error: "That time doesn’t exist here (clock change)." };
}
const field = "rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export type ItemRowProps = { item: ActionItem; tz?: string; onChange?: (item: ActionItem) => void; onDelete?: (id: string) => void; onSource?: (eventId: string) => void };

// Copied Row markup from ring-inbox/src/pages/items.tsx. BOTH task/reminder
// variants must use this component. Mutations/undo/toast replaced by local state.
export function ItemRow({ item: initialItem, tz = "UTC", onChange, onDelete, onSource }: ItemRowProps) {
  const [item, setItem] = useState(initialItem);
  const [deleted, setDeleted] = useState(false);
  const [sourceSelected, setSourceSelected] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [editingDate, setEditingDate] = useState(false);
  const [date, setDate] = useState(toLocalInput(item.dueAt, tz));
  const [dateErr, setDateErr] = useState("");
  const [confirm, setConfirm] = useState<"dismiss" | "delete" | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const skipSave = useRef(false);
  useEffect(() => { setItem(initialItem); }, [initialItem]);
  useEffect(() => { if (!editingTitle) setTitle(item.title); }, [item.title, editingTitle]);
  const done = item.status !== "open";
  function patch(data: Partial<ActionItem>) {
    const next = { ...item, ...data };
    setItem(next); onChange?.(next);
  }
  function saveTitle() {
    setEditingTitle(false);
    if (skipSave.current) { skipSave.current = false; setTitle(item.title); return; }
    const t = title.trim();
    if (!t) { setTitle(item.title); return; }
    if (t !== item.title) patch({ title: t }); else setTitle(item.title);
  }
  function saveDate() {
    const { iso, error } = tryLocalInput(date, tz);
    if (error) { setDateErr(error); return; }
    setDateErr(""); setEditingDate(false);
    if (iso === item.dueAt && !item.needsReview) return;
    patch({ dueAt: iso, needsReview: false });
  }
  if (deleted) return null;
  return (
    <li className="group flex items-start gap-3 px-3 py-2.5 " data-testid={`row-item-${item.id}`}>
      <button type="button" aria-label={done ? "Reopen" : "Complete"} data-testid={`button-complete-${item.id}`}
        onClick={() => item.status === "open" ? patch({ status: "completed" }) : patch({ status: "open" })}
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.status === "completed" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-foreground/40"}`}>
        {item.status === "completed" && <Check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => setEditingTitle(true)} onBlur={saveTitle} maxLength={500}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { skipSave.current = true; e.currentTarget.blur(); } }}
          aria-label="Title" data-testid={`input-title-${item.id}`}
          className={`w-full rounded bg-transparent px-1 -mx-1 text-[15px] outline-none hover:bg-secondary/50 focus:bg-card focus-visible:ring-2 focus-visible:ring-ring ${done ? "text-muted-foreground line-through" : ""}`} />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {editingDate ? (
            <span className="flex items-center gap-1">
              <input type="datetime-local" value={date} onChange={(e) => { setDate(e.target.value); setDateErr(""); }} autoFocus aria-invalid={!!dateErr} data-testid={`input-due-${item.id}`} className={`${field} py-0.5 text-xs`}
                onKeyDown={(e) => { if (e.key === "Enter") saveDate(); if (e.key === "Escape") { setEditingDate(false); setDateErr(""); } }} />
              <button type="button" onClick={saveDate} data-testid={`button-save-due-${item.id}`} className="rounded px-1.5 py-0.5 text-foreground hover:bg-secondary">Save</button>
              {item.dueAt && <button type="button" onClick={() => { setDate(""); setEditingDate(false); patch({ dueAt: null, needsReview: false }); }} data-testid={`button-clear-due-${item.id}`} className="rounded px-1.5 py-0.5 hover:bg-secondary">Clear</button>}
              {dateErr && <span role="alert" className="text-destructive" data-testid={`text-due-error-${item.id}`}>{dateErr}</span>}
              <button type="button" aria-label="Cancel" onClick={() => { setEditingDate(false); setDateErr(""); }} className="rounded p-0.5 hover:bg-secondary"><X className="h-3 w-3" /></button>
            </span>
          ) : (
            <button type="button" onClick={() => { setDate(toLocalInput(item.dueAt, tz)); setEditingDate(true); }} data-testid={`button-due-${item.id}`}
              className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {item.dueAt ? <time dateTime={item.dueAt}>{formatDue(item.dueAt, tz)}</time> : item.kind === "reminder" ? "Set a time" : "No date"}
            </button>
          )}
          {item.needsReview && <span className="rounded border border-accent/50 px-1.5 text-accent" title={item.originalTimeText ?? undefined} data-testid={`status-review-${item.id}`}>Check time{item.originalTimeText ? `: “${item.originalTimeText}”` : ""}</span>}
          {item.status === "dismissed" && <span>Dismissed</span>}
          {item.sourceEventId && <button type="button" onClick={() => { setSourceSelected((value) => !value); onSource?.(item.sourceEventId!); }} aria-pressed={sourceSelected} data-testid={`link-source-${item.id}`} className={`hover:text-foreground${sourceSelected ? " text-accent" : ""}`}>Original note</button>}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Item actions" data-testid={`button-menu-${item.id}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreVertical className="h-4 w-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border border-border">
          {item.status === "dismissed"
            ? <DropdownMenuItem onSelect={() => patch({ status: "open" })} data-testid={`menu-restore-${item.id}`}><CornerUpLeft className="mr-2 h-4 w-4" />Restore</DropdownMenuItem>
            : <DropdownMenuItem onSelect={() => setConfirm("dismiss")} data-testid={`menu-dismiss-${item.id}`}><X className="mr-2 h-4 w-4" />Dismiss</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm("delete")} data-testid={`menu-delete-${item.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl font-normal">{confirm === "delete" ? "Delete this item?" : "Dismiss this item?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "delete" ? "It will be removed permanently. The original note stays in the inbox." : "It moves out of your open list. You can restore it later."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm" className={confirm === "delete" ? "bg-destructive text-destructive-foreground" : ""}
              onClick={() => {
                if (confirm === "delete") { setDeleted(true); onDelete?.(item.id); }
                else patch({ status: "dismissed" });
                setConfirm(null);
              }}>{confirm === "delete" ? "Delete" : "Dismiss"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
