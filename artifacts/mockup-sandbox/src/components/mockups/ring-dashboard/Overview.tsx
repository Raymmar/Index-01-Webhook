import { useMemo, useState } from "react";
import { EventCard, ItemRow, Shell, seededItems, seededMessages, type ActionItem, type NavSection } from "./_shared";
import "./_group.css";

type KindFilter = "all" | "task" | "reminder";
const control = "rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Synthetic fixtures use June 18 as their reference day. No live account data.
export function Overview() {
  const [items, setItems] = useState<ActionItem[]>(() => seededItems.map((item) => ({ ...item })));
  const [section, setSection] = useState<NavSection>("dashboard");
  const [kind, setKind] = useState<KindFilter>("all");
  const [date, setDate] = useState("any");
  const [status, setStatus] = useState<ActionItem["status"]>("open");
  const [visibleNotes, setVisibleNotes] = useState(2);
  const [highlight, setHighlight] = useState<string | null>(null);
  const openTasks = items.filter((item) => item.kind === "task" && item.status === "open").length;
  const openReminders = items.filter((item) => item.kind === "reminder" && item.status === "open").length;
  const selectedKind = section === "tasks" ? "task" : section === "reminders" ? "reminder" : kind;
  const filtered = useMemo(() => items.filter((item) => {
    if (item.status !== status || (selectedKind !== "all" && item.kind !== selectedKind)) return false;
    if (date === "undated") return !item.dueAt;
    if (date === "today") return item.dueAt?.slice(0, 10) === "2026-06-18";
    if (date === "tomorrow") return item.dueAt?.slice(0, 10) === "2026-06-19";
    return true;
  }).sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.createdAt.localeCompare(b.createdAt);
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  }), [items, selectedKind, date, status]);
  function navigate(next: NavSection) {
    setSection(next);
    setDate("any");
    setStatus("open");
  }
  function source(id: string) {
    const index = seededMessages.findIndex((message) => message.id === id);
    setVisibleNotes((count) => Math.max(count, index + 1));
    setHighlight(id);
    if (section !== "dashboard") setSection("inbox");
    // A repeated source click still brings the same original note into view.
    requestAnimationFrame(() => document.getElementById(`event-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  const isDashboard = section === "dashboard";
  const isItems = isDashboard || section === "tasks" || section === "reminders";
  const title = isDashboard ? "Dashboard" : section.charAt(0).toUpperCase() + section.slice(1);

  const feed = (
    <section aria-label="Inbox feed" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Inbox</h2>
        <span className="text-xs text-muted-foreground">{seededMessages.length} messages</span>
      </div>
      <div className="max-h-[640px] space-y-3 overflow-y-auto overscroll-y-contain pr-1 md:max-h-[calc(100dvh-220px)]" tabIndex={0} aria-label="Scrollable original notes">
        {seededMessages.slice(0, visibleNotes).map((event) => (
          <EventCard key={event.id} e={event} items={items.filter((item) => item.sourceEventId === event.id)} highlight={highlight === event.id} onNavigate={navigate} />
        ))}
        <div className="py-3 text-center">
          {visibleNotes < seededMessages.length
            ? <button type="button" className={`${control} hover:bg-secondary`} onClick={() => setVisibleNotes((count) => Math.min(count + 2, seededMessages.length))}>Load older messages <span className="ml-1 text-muted-foreground">({seededMessages.length - visibleNotes})</span></button>
            : <p className="text-xs text-muted-foreground" role="status">You’ve reached the beginning of your inbox.</p>}
        </div>
      </div>
    </section>
  );

  return (
    <Shell active={section} fullWidth items={items} onNavigate={navigate}>
      <div className="mx-auto max-w-7xl">
        <header className="mb-7">
          <h1 className="font-display text-3xl">{title}</h1>
          {isDashboard && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Workspace counts">
            <span><span className="font-mono text-foreground">{seededMessages.length}</span> messages</span>
            <span><span className="font-mono text-foreground">{openTasks}</span> open tasks</span>
            <span><span className="font-mono text-foreground">{openReminders}</span> reminders</span>
          </div>}
        </header>
        {isItems ? <div className={isDashboard ? "grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" : "max-w-3xl"}>
          <section aria-label="Actionable items" className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">{isDashboard ? "Tasks & reminders" : title}</h2>
              <span className="text-xs text-muted-foreground">{filtered.length} {status}</span>
            </div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
              {isDashboard && <div className="flex items-center gap-1" role="group" aria-label="Item type">
                {([["all", "All"], ["task", "Tasks"], ["reminder", "Reminders"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`rounded-md px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kind === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}>{label}</button>)}
              </div>}
              <div className="flex flex-wrap items-center gap-2">
                <select value={date} onChange={(event) => setDate(event.target.value)} aria-label="Filter by due date" className={control}>
                  <option value="any">Any date</option>
                  <option value="today">Today · Jun 18</option>
                  <option value="tomorrow">Tomorrow · Jun 19</option>
                  <option value="undated">No date</option>
                </select>
                <select value={status} onChange={(event) => setStatus(event.target.value as ActionItem["status"])} aria-label="Item status" className={control}>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">Due time first, then items without a date. Times in UTC.</p>
            {filtered.length ? <div className="divide-y divide-border rounded-lg border border-border bg-card">
              {filtered.map((item) => <div key={item.id} className="pt-2">
                <p className="px-10 text-[11px] text-muted-foreground">{item.kind === "task" ? "Task" : "Reminder"}</p>
                <ul><ItemRow item={item} tz="UTC" onChange={(updated) => setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry))} onDelete={(id) => setItems((current) => current.filter((entry) => entry.id !== id))} onSource={source} /></ul>
              </div>)}
            </div> : <div className="rounded-lg border border-border px-5 py-10 text-center">
              <h3 className="text-sm">{status === "open" ? "No open items here" : `No ${status} items`}</h3>
              <p className="mt-2 text-xs text-muted-foreground">Try another date, type, or status.</p>
              <button type="button" className="mt-4 rounded-md px-2.5 py-1.5 text-xs underline underline-offset-4 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setDate("any"); setKind("all"); setStatus("open"); }}>Reset filters</button>
            </div>}
          </section>
          {isDashboard && <div className="min-w-0 border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">{feed}</div>}
        </div> : section === "inbox" ? <div className="max-w-3xl">{feed}</div> : <div className="max-w-xl rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground">{title} are unchanged in this Dashboard preview.</p>
          <button type="button" className={`${control} mt-4 hover:bg-secondary`} onClick={() => navigate("dashboard")}>Back to Dashboard</button>
        </div>}
      </div>
    </Shell>
  );
}
