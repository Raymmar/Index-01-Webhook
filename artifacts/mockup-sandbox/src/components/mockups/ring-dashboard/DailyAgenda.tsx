import { useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Shell, EventCard, ItemRow, seededItems, seededMessages, type ActionItem, type NavSection } from "./_shared";
import "./_group.css";

const TODAY = "2026-06-18";
const control = "rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Filter = "all" | "task" | "reminder";
type Bucket = "Today" | "Tomorrow" | "Later" | "No date";
const buckets: Bucket[] = ["Today", "Tomorrow", "Later", "No date"];

function dateKey(date: string) {
  return format(new Date(date), "yyyy-MM-dd");
}

/** Daily grouping of the existing item rows. No fixture data leaves the page. */
export function DailyAgenda() {
  const [items, setItems] = useState<ActionItem[]>(() => seededItems.map((item) => ({ ...item })));
  const [section, setSection] = useState<NavSection>("dashboard");
  const [filter, setFilter] = useState<Filter>("all");
  const [day, setDay] = useState(TODAY);
  const [showClosed, setShowClosed] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState(3);
  const [highlight, setHighlight] = useState<string | null>(null);
  const nextDay = format(addDays(new Date(`${day}T12:00:00`), 1), "yyyy-MM-dd");
  const open = items.filter((item) => item.status === "open");
  const selectedFilter = section === "tasks" ? "task" : section === "reminders" ? "reminder" : filter;
  const filtered = items.filter((item) => (showClosed || item.status === "open") && (selectedFilter === "all" || item.kind === selectedFilter));
  const bucketFor = (item: ActionItem): Bucket => {
    if (!item.dueAt) return "No date";
    const due = dateKey(item.dueAt);
    if (due <= day) return "Today";
    return due === nextDay ? "Tomorrow" : "Later";
  };
  const updateItem = (updated: ActionItem) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
  const deleteItem = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  const navigate = (next: NavSection) => { setSection(next); setHighlight(null); };
  const source = (id: string) => {
    setVisibleMessages(seededMessages.length);
    setHighlight(id);
    if (section !== "dashboard") setSection("inbox");
    // Repeated source selections also bring the existing original into view.
    window.setTimeout(() => document.getElementById(`event-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const moveDay = (amount: number) => setDay(format(addDays(new Date(`${day}T12:00:00`), amount), "yyyy-MM-dd"));
  const title = section === "dashboard" ? "Dashboard" : section.charAt(0).toUpperCase() + section.slice(1);

  const feed = (
    <section aria-label="Inbox feed" className="min-w-0">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl">{section === "inbox" ? "Original notes" : "Inbox"}</h2>
        <span className="text-xs text-muted-foreground">{seededMessages.length} messages</span>
      </div>
      <div className={section === "dashboard" ? "max-h-[70dvh] space-y-3 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-220px)]" : "space-y-3"}>
        {seededMessages.slice(0, visibleMessages).map((event) => (
          <EventCard key={event.id} e={event} items={items.filter((item) => item.sourceEventId === event.id)} highlight={highlight === event.id} onNavigate={navigate} />
        ))}
        <div className="py-3 text-center">
          {visibleMessages < seededMessages.length
            ? <button type="button" className={control} onClick={() => setVisibleMessages((count) => Math.min(count + 3, seededMessages.length))}>Load earlier messages</button>
            : <p className="text-xs text-muted-foreground">You’ve reached the beginning of your inbox.</p>}
        </div>
      </div>
    </section>
  );

  return (
    <Shell active={section} fullWidth items={items} onNavigate={navigate}>
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-7 border-b border-border pb-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
            <h1 className="font-display text-3xl">{title}</h1>
            <p className="text-xs text-muted-foreground">{format(new Date(`${TODAY}T12:00:00`), "EEEE, MMMM d, yyyy")}</p>
          </div>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-baseline gap-1.5"><dd className="font-mono text-foreground">{seededMessages.length}</dd><dt>messages</dt></div>
            <div className="flex items-baseline gap-1.5"><dd className="font-mono text-foreground">{open.filter((item) => item.kind === "task").length}</dd><dt>open tasks</dt></div>
            <div className="flex items-baseline gap-1.5"><dd className="font-mono text-foreground">{open.filter((item) => item.kind === "reminder").length}</dd><dt>reminders</dt></div>
          </dl>
        </header>

        {section === "inbox" ? <div className="max-w-3xl">{feed}</div> : section === "webhooks" || section === "settings" ? (
          <section className="max-w-xl rounded-lg border border-border px-5 py-6">
            <h2 className="font-display text-2xl">{section === "webhooks" ? "Ring" : "Workspace settings"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">This dashboard preview uses sample notes. Account {section} are available in the original app.</p>
            <button type="button" onClick={() => navigate("dashboard")} className={`${control} mt-4`}>Back to Dashboard</button>
          </section>
        ) : (
          <div className={section === "dashboard" ? "grid min-w-0 grid-cols-1 gap-9 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:gap-7" : "max-w-3xl"}>
            <section className="min-w-0" aria-label="Daily agenda">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl">Upcoming</h2>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} className="accent-[hsl(var(--primary))]" />
                  Show closed
                </label>
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-0.5" aria-label="Item type">
                  {(["all", "task", "reminder"] as const).map((value) => (
                    <button type="button" key={value} aria-pressed={selectedFilter === value}
                      onClick={() => { setFilter(value); if (section !== "dashboard") setSection("dashboard"); }}
                      className={`rounded-md px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedFilter === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}>
                      {value === "all" ? "All" : value === "task" ? "Tasks" : "Reminders"}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">{filtered.length} {showClosed ? "items" : "open"}</span>
              </div>
              <div className="mb-5 flex flex-wrap items-center gap-1.5 border-y border-border py-2.5">
                <button type="button" className={`${control} px-1.5`} aria-label="Previous day" onClick={() => moveDay(-1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
                <label className="sr-only" htmlFor="agenda-date">Agenda date</label>
                <input id="agenda-date" type="date" value={day} onChange={(event) => { if (event.target.value && /^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setDay(event.target.value); }}
                  className="min-w-0 rounded bg-transparent px-1 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <button type="button" className={`${control} px-1.5`} aria-label="Next day" onClick={() => moveDay(1)}><ChevronRight className="h-3.5 w-3.5" /></button>
                {day !== TODAY && <button type="button" onClick={() => setDay(TODAY)} className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary">Today</button>}
              </div>
              <div className="space-y-5">
                {buckets.map((bucket) => {
                  const grouped = filtered.filter((item) => bucketFor(item) === bucket).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
                  const overdue = bucket === "Today" ? grouped.filter((item) => item.dueAt && dateKey(item.dueAt) < day && item.status === "open").length : 0;
                  return (
                    <section key={bucket} aria-label={bucket}>
                      <div className="mb-1.5 flex items-baseline gap-2 px-3 text-xs">
                        <h3 className="font-medium">{day === TODAY || bucket === "Later" || bucket === "No date" ? bucket : bucket === "Today" ? format(new Date(`${day}T12:00:00`), "EEE, MMM d") : format(new Date(`${nextDay}T12:00:00`), "EEE, MMM d")}</h3>
                        <span className="font-mono text-[11px] text-muted-foreground">{grouped.length}</span>
                        {overdue > 0 && <span className="ml-auto text-[11px] text-muted-foreground">Includes {overdue} overdue</span>}
                      </div>
                      {grouped.length ? <div className="divide-y divide-border rounded-lg border border-border">
                        {grouped.map((item) => (
                          <div key={item.id} className="pb-0.5 pt-1">
                            <p className="px-10 pt-1 text-[10px] text-muted-foreground">{item.kind === "task" ? "Task" : "Reminder"}</p>
                            <ul><ItemRow item={item} tz="UTC" onChange={updateItem} onDelete={deleteItem} onSource={source} /></ul>
                          </div>
                        ))}
                      </div> : <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">{bucket === "No date" ? "No unscheduled items." : bucket === "Later" ? "Nothing scheduled further ahead." : "Nothing scheduled."}</p>}
                    </section>
                  );
                })}
              </div>
              {filtered.length === 0 && <div className="mt-5 rounded-lg border border-border p-4"><p className="text-sm">No {selectedFilter === "all" ? "items" : selectedFilter === "task" ? "tasks" : "reminders"} in this view.</p><p className="mt-1 text-xs text-muted-foreground">Original notes remain in your inbox.</p><button type="button" onClick={() => { setShowClosed(true); setFilter("all"); }} className={`${control} mt-3`}>Show all items</button></div>}
            </section>
            {section === "dashboard" && <aside className="min-w-0 lg:border-l lg:border-border lg:pl-7">{feed}</aside>}
          </div>
        )}
      </div>
    </Shell>
  );
}
