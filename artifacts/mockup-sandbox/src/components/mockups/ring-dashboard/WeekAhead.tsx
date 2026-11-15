import { useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Shell, EventCard, ItemRow, seededItems, seededMessages, type ActionItem, type InboxEvent, type NavSection } from "./_shared";
import "./_group.css";

const today = new Date("2026-06-18T12:00:00Z");
const firstWeek = new Date("2026-06-15T12:00:00Z");
const olderMessages: InboxEvent[] = [
  { id: "week-note-5", kind: "recording", transcription: "The bookshop on Willow Street has a poetry reading next month. Look up the date when I get home.", webhookName: "Ring", recordedAt: "2026-06-16T15:24:00Z", receivedAt: "2026-06-16T15:24:02Z", payload: { type: "recording", source: "ring", text: "Look up the poetry reading at the Willow Street bookshop." } },
  { id: "week-note-6", kind: "recording", transcription: "Keep the afternoon free on Sunday. It would be nice to cook something slowly for a change.", webhookName: "Ring", recordedAt: "2026-06-15T11:16:00Z", receivedAt: "2026-06-15T11:16:02Z", payload: { type: "recording", source: "ring", text: "Keep Sunday afternoon free for cooking." } },
];
const button = "rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function WeekAhead() {
  const [items, setItems] = useState<ActionItem[]>(seededItems);
  const [section, setSection] = useState<NavSection>("dashboard");
  const [filter, setFilter] = useState<"all" | "task" | "reminder">("all");
  const [date, setDate] = useState<string | null>(null);
  const [week, setWeek] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedFeed, setExpandedFeed] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messages = expandedFeed ? [...seededMessages, ...olderMessages] : seededMessages;
  const open = items.filter((item) => item.status === "open");
  const days = Array.from({ length: 7 }, (_, i) => addDays(firstWeek, week * 7 + i));
  const selectedKind = section === "tasks" ? "task" : section === "reminders" ? "reminder" : filter;
  const visibleItems = items.filter((item) =>
    (showCompleted ? item.status !== "open" : item.status === "open") &&
    (selectedKind === "all" || item.kind === selectedKind) &&
    (section !== "dashboard" || !date || item.dueAt?.slice(0, 10) === date)
  ).sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999"));
  const update = (updated: ActionItem) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
  const remove = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  const source = (id: string) => { setSection("inbox"); setHighlight(null); requestAnimationFrame(() => setHighlight(id)); };
  const navigate = (next: NavSection) => {
    if (next === "webhooks" || next === "settings") {
      setNotice(`${next === "webhooks" ? "Webhooks" : "Settings"} remain in the existing app. This preview explores the Dashboard only.`);
      return;
    }
    setNotice(null);
    setSection(next); setShowCompleted(false); setHighlight(null);
  };
  const list = (
    <>
      {visibleItems.length ? <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {visibleItems.map((item) => <div key={item.id} role="presentation">
          <div className="px-10 pt-2 text-[11px] text-muted-foreground">{item.kind === "task" ? "Task" : "Reminder"}</div>
          <ul><ItemRow item={item} tz="UTC" onChange={update} onDelete={remove} onSource={source} /></ul>
        </div>)}
      </div> : <div className="rounded-lg border border-border px-5 py-10 text-center">
        <p className="text-sm">{date && section === "dashboard" ? "Nothing scheduled for this day." : showCompleted ? "No completed or dismissed items." : "No open items."}</p>
        <button type="button" onClick={() => { setDate(null); setFilter("all"); setShowCompleted(false); }} className={`${button} mt-2`}>All upcoming</button>
      </div>}
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Dates shown in UTC</span>
        <button type="button" className="rounded px-1 py-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? "Show open items" : "Completed & dismissed"}</button>
      </div>
    </>
  );
  const feed = (
    <section aria-label="Inbox" className="min-w-0">
      <div className="space-y-3">
        {messages.map((e) => <EventCard key={e.id} e={e} items={items.filter((item) => item.sourceEventId === e.id)} highlight={highlight === e.id} onNavigate={navigate} />)}
        <div className="py-3 text-center">
          {expandedFeed ? <p className="text-xs text-muted-foreground">You’ve reached the beginning of your inbox.</p> : <button type="button" onClick={() => setExpandedFeed(true)} className={`${button} border border-border`}>Load older notes</button>}
        </div>
      </div>
    </section>
  );
  return (
    <Shell active={section} fullWidth items={items} onNavigate={navigate}>
      <div className={`mx-auto ${section === "dashboard" ? "max-w-5xl" : "max-w-3xl"}`}>
        {notice && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"><span>{notice}</span><button type="button" className={button} onClick={() => setNotice(null)}>Dismiss</button></div>}
        {section !== "inbox" && <header className="mb-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-display text-3xl">{section === "dashboard" ? "Dashboard" : section === "tasks" ? "Tasks" : "Reminders"}</h1>
            <span className="text-xs text-muted-foreground">{format(today, "EEEE, MMMM d")}</span>
          </div>
          {section === "dashboard" && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span><span className="font-mono text-foreground">{messages.length}</span> messages</span>
            <span><span className="font-mono text-foreground">{open.filter((item) => item.kind === "task").length}</span> open tasks</span>
            <span><span className="font-mono text-foreground">{open.filter((item) => item.kind === "reminder").length}</span> reminders</span>
          </div>}
        </header>}
        {section === "inbox" ? feed : <div className="min-w-0">
          <section className="min-w-0" aria-label="Actionable items">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-2xl">{section === "dashboard" ? "Your week" : "Open items"}</h2>
              {section === "dashboard" && <button type="button" onClick={() => { setDate(null); setWeek(0); }} className={`${button} ${!date ? "text-foreground" : ""}`}>All upcoming</button>}
            </div>
            {section === "dashboard" && <div className="mb-5 rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-xs">{format(days[0], "MMM d")} – {format(days[6], "MMM d, yyyy")}</span>
                <div className="flex">
                  <button type="button" aria-label="Previous week" className={button} onClick={() => setWeek((value) => value - 1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Next week" className={button} onClick={() => setWeek((value) => value + 1)}><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 p-2">
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const count = open.filter((item) => item.dueAt?.slice(0, 10) === key).length;
                  return <button key={key} type="button" aria-label={`${format(day, "EEEE, MMMM d")}, ${count} open items`} aria-pressed={date === key} onClick={() => { setDate(date === key ? null : key); setShowCompleted(false); }} className={`flex min-w-0 flex-col items-center gap-1 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${date === key ? "bg-secondary text-foreground" : "hover:bg-secondary/60"}`}>
                    <span className="text-[11px] text-muted-foreground">{format(day, "EEE")}</span>
                    <span className={`text-sm ${key === "2026-06-18" ? "text-accent" : ""}`}>{format(day, "d")}</span>
                    <span className="h-3 text-[10px] text-muted-foreground">{count || "–"}</span>
                  </button>;
                })}
              </div>
            </div>}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              {section === "dashboard" ? <div className="flex gap-0.5" aria-label="Item type">
                {(["all", "task", "reminder"] as const).map((kind) => <button key={kind} type="button" onClick={() => setFilter(kind)} aria-pressed={filter === kind} className={`${button} ${filter === kind ? "bg-secondary text-foreground" : ""}`}>{kind === "all" ? "All" : kind === "task" ? "Tasks" : "Reminders"}</button>)}
              </div> : <span className="text-xs text-muted-foreground">{showCompleted ? "Completed & dismissed" : "Open"}</span>}
              <span className="text-[11px] text-muted-foreground">{date && section === "dashboard" ? format(new Date(`${date}T12:00:00Z`), "EEE, MMM d") : "All dates"} · {visibleItems.length}</span>
            </div>
            {list}
          </section>
        </div>}
      </div>
    </Shell>
  );
}
