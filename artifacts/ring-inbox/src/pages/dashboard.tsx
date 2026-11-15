import { useEffect, useState } from "react";
import { Link } from "wouter";
import { addDays, format, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useGetOrganizer, getGetOrganizerQueryKey, useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { ActionItemRow } from "./items";
import { Skeleton } from "@/components/ui/skeleton";
import { browserZone } from "@/lib/tz";
import { compareActionItems } from "@/lib/action-order";
import { useInboxDrawer } from "@/hooks/use-inbox-drawer";

const button = "rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function Dashboard() {
  const { openInbox } = useInboxDrawer();
  const q = useGetOrganizer({ query: { queryKey: getGetOrganizerQueryKey() } });
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const tz = settings.data?.timezone ?? browserZone();
  const [now, setNow] = useState(() => new Date());
  // Update calendar date at midnight without polling any API.
  useEffect(() => {
    document.title = "Dashboard · Ring Inbox";
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const todayKey = formatInTimeZone(now, tz, "yyyy-MM-dd");
  // Local calendar arithmetic uses date-only values, independent of UTC offsets.
  const today = new Date(`${todayKey}T12:00:00`);
  const [week, setWeek] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "scheduled" | "unscheduled">("all");
  const [closed, setClosed] = useState(false);
  const first = addDays(startOfWeek(today, { weekStartsOn: 1 }), week * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const items = q.data?.items ?? [];
  const open = items.filter(i => i.status === "open");
  const dayOf = (instant: string) => formatInTimeZone(new Date(instant), tz, "yyyy-MM-dd");
  const visible = items.filter(i =>
    (closed ? i.status !== "open" : i.status === "open") &&
    (filter === "all" || (filter === "scheduled" ? !!i.dueAt : !i.dueAt)) &&
    (!date || (i.dueAt && dayOf(i.dueAt) === date))
  ).sort(compareActionItems);
  const reset = () => { setDate(null); setWeek(0); setClosed(false); };

  if (q.isLoading || settings.isLoading) return <div className="space-y-5" aria-label="Loading dashboard"><Skeleton className="h-10 w-48" /><Skeleton className="h-36 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || settings.isError) return <div role="alert" className="rounded-lg border border-border bg-card p-5 text-sm">Could not load dashboard. <button className="underline" onClick={() => { void q.refetch(); void settings.refetch(); }}>Retry</button></div>;

  return (
    <div data-testid="dashboard">
      <header className="mb-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-3xl">Dashboard</h1>
          <span className="text-xs text-muted-foreground">{format(today, "EEEE, MMMM d")}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <button type="button" onClick={() => openInbox()} className="hover:text-foreground"><span className="font-mono text-foreground" data-testid="stat-messages">{q.data?.messageCount ?? 0}</span> messages</button>
          <Link href="/tasks" className="hover:text-foreground"><span className="font-mono text-foreground">{open.length}</span> open tasks</Link>
          <Link href="/tasks?schedule=scheduled" className="hover:text-foreground"><span className="font-mono text-foreground">{open.filter(i => i.dueAt).length}</span> scheduled</Link>
        </div>
      </header>
      <section aria-label="Tasks">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Your week</h2>
          <button onClick={reset} className={`${button} ${!date ? "text-foreground" : ""}`}>All upcoming</button>
        </div>
        <div className="mb-5 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
            <button aria-label="Previous week" className={button} onClick={() => { setWeek(w => w - 1); setDate(null); }}><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs">{format(first, "MMM d")} – {format(days[6], "MMM d, yyyy")}</span>
            <button aria-label="Next week" className={button} onClick={() => { setWeek(w => w + 1); setDate(null); }}><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 p-2">
            {days.map(day => {
              const key = format(day, "yyyy-MM-dd");
              const count = filter === "unscheduled" ? 0 : open.filter(i => i.dueAt && dayOf(i.dueAt) === key).length;
              return <button key={key} aria-label={`${format(day, "EEEE, MMMM d")}, ${count} open items`} aria-pressed={date === key} data-testid={`day-${key}`} onClick={() => { setDate(date === key ? null : key); setClosed(false); }} className={`flex min-w-0 flex-col items-center gap-1 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${date === key ? "bg-secondary text-foreground" : "hover:bg-secondary/60"}`}>
                <span className="text-[11px] text-muted-foreground">{format(day, "EEE")}</span>
                <span className={`text-sm ${key === todayKey ? "text-accent" : ""}`}>{format(day, "d")}</span>
                <span className="h-3 text-[10px] text-muted-foreground">{count || "–"}</span>
              </button>;
            })}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-0.5" aria-label="Item type">
            {(["all", "scheduled", "unscheduled"] as const).map(kind => <button key={kind} onClick={() => { setFilter(kind); if (kind === "unscheduled") setDate(null); }} aria-pressed={filter === kind} data-testid={`filter-${kind}`} className={`${button} ${filter === kind ? "bg-secondary text-foreground" : ""}`}>{kind === "all" ? "All" : kind === "scheduled" ? "Scheduled" : "Unscheduled"}</button>)}
          </div>
          <span className="text-[11px] text-muted-foreground">{date ? format(new Date(`${date}T12:00:00`), "EEE, MMM d") : "All dates"} · {visible.length}</span>
        </div>
        {visible.length ? <ul className="divide-y divide-border rounded-lg border border-border bg-card">{visible.map(item => <ActionItemRow key={item.id} item={item} tz={tz} />)}</ul> :
          <div className="rounded-lg border border-border p-10 text-center text-sm">{date ? "Nothing scheduled for this day." : closed ? "No completed or dismissed items." : "No open items."}</div>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{tz.replaceAll("_", " ")}</span>
          <button className={button} onClick={() => setClosed(v => !v)}>{closed ? "Show open items" : "Completed & dismissed"}</button>
        </div>
      </section>
    </div>
  );
}
