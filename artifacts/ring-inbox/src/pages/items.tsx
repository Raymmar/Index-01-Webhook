import { useEffect, useRef, useState } from "react";
import { useInboxDrawer } from "@/hooks/use-inbox-drawer";
import { useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CornerUpLeft, MoreVertical, Trash2, X } from "lucide-react";
import { useGetOrganizer, getGetOrganizerQueryKey, getListEventsQueryKey, useGetSettings, getGetSettingsQueryKey, useCreateItem, useUpdateItem, useDeleteItem, type ActionItem, type ItemUpdate } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { browserZone, formatDue, toLocalInput, tryLocalInput } from "@/lib/tz";
import { compareActionItems } from "@/lib/action-order";

const field = "rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }),
    qc.invalidateQueries({ queryKey: getListEventsQueryKey() }),
  ]);
}

export function ActionItemRow({ item, tz }: { item: ActionItem; tz: string }) {
  const { openInbox } = useInboxDrawer();
  const invalidate = useInvalidate();
  const { toast } = useToast();
  const update = useUpdateItem({ mutation: { onSettled: invalidate } });
  const del = useDeleteItem({ mutation: { onSettled: invalidate } });
  const [title, setTitle] = useState(item.title);
  const [editingDate, setEditingDate] = useState(false);
  const [date, setDate] = useState(toLocalInput(item.dueAt, tz));
  const [dateErr, setDateErr] = useState("");
  const [confirm, setConfirm] = useState<"dismiss" | "delete" | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const skipSave = useRef(false);
  useEffect(() => { if (!editingTitle) setTitle(item.title); }, [item.title, editingTitle]);
  const done = item.status !== "open";

  function patch(data: ItemUpdate, undo?: { label: string; data: ItemUpdate }) {
    update.mutate({ id: item.id, data }, {
      onSuccess: () => {
        if (undo) toast({ description: undo.label, action: <ToastAction altText="Undo" data-testid={`button-undo-${item.id}`} onClick={() => update.mutate({ id: item.id, data: undo.data })}>Undo</ToastAction> });
      },
      onError: () => toast({ variant: "destructive", description: "Could not save. Try again." }),
    });
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
    setDateErr("");
    setEditingDate(false);
    if (iso === item.dueAt && !item.needsReview) return;
    patch({ dueAt: iso, needsReview: false });
  }

  return (
    <li className={`group flex items-start gap-3 px-3 py-2.5 ${update.isPending ? "opacity-70" : ""}`} data-testid={`row-item-${item.id}`}>
      <button type="button" aria-label={done ? "Reopen" : "Complete"} data-testid={`button-complete-${item.id}`} disabled={update.isPending}
        onClick={() => item.status === "open"
          ? patch({ status: "completed" }, { label: "Marked complete.", data: { status: "open" } })
          : patch({ status: "open" })}
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.status === "completed" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-foreground/40"}`}>
        {item.status === "completed" && <Check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => setEditingTitle(true)} onBlur={saveTitle} maxLength={500}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { skipSave.current = true; e.currentTarget.blur(); } }}
          aria-label="Title" data-testid={`input-title-${item.id}`}
          className={`app-content-text w-full rounded bg-transparent px-1 -mx-1 outline-none hover:bg-secondary/50 focus:bg-card focus-visible:ring-2 focus-visible:ring-ring ${done ? "text-muted-foreground line-through" : ""}`} />
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
              {item.dueAt ? <time dateTime={item.dueAt}>{formatDue(item.dueAt, tz)}</time> : "No date"}
            </button>
          )}
          {item.needsReview && <span className="rounded border border-accent/50 px-1.5 text-accent" title={item.originalTimeText ?? undefined} data-testid={`status-review-${item.id}`}>Check time{item.originalTimeText ? `: “${item.originalTimeText}”` : ""}</span>}
          {item.status === "dismissed" && <span>Dismissed</span>}
          {item.sourceEventId && <button type="button" onClick={() => openInbox(item.sourceEventId!)} data-testid={`link-source-${item.id}`} className="hover:text-foreground">Original note</button>}
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
          <DropdownMenuItem onSelect={() => setConfirm("delete")} data-testid={`menu-delete-${item.id}`}><Trash2 className="mr-2 h-4 w-4" />Remove task</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl font-normal">{confirm === "delete" ? "Remove this task?" : "Dismiss this task?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "delete" ? "Only this task is removed. Other tasks, the original message, and its audio stay unchanged." : "It moves out of your open list. You can restore it later."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm" className={confirm === "delete" ? "bg-destructive text-destructive-foreground" : ""}
              onClick={() => {
                if (confirm === "delete") del.mutate({ id: item.id }, { onError: () => toast({ variant: "destructive", description: "Could not delete. Try again." }) });
                else patch({ status: "dismissed" }, { label: "Dismissed.", data: { status: "open" } });
                setConfirm(null);
              }}>{confirm === "delete" ? "Remove task" : "Dismiss"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export function Composer({ tz }: { tz: string }) {
  const invalidate = useInvalidate();
  const create = useCreateItem({ mutation: { onSettled: invalidate } });
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [dateErr, setDateErr] = useState("");
  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
      e.preventDefault();
      const t = title.trim();
      if (!t) return;
      const { iso, error } = tryLocalInput(date, tz);
      if (error) { setDateErr(error); return; }
      create.mutate({ data: { title: t, dueAt: iso } }, { onSuccess: () => { setTitle(""); setDate(""); } });
    }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="New task" data-testid="input-new-title" className={`${field} min-w-0 flex-1 py-2`} />
      <input type="datetime-local" value={date} onChange={(e) => { setDate(e.target.value); setDateErr(""); }} aria-invalid={!!dateErr} aria-label="Due (optional)" data-testid="input-new-due" className={`${field} min-w-0 py-2`} />
      <button disabled={create.isPending || !title.trim()} data-testid="button-add" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{create.isPending ? "Adding..." : "Add"}</button>
      {dateErr && <p role="alert" className="text-sm text-destructive sm:self-center" data-testid="text-new-due-error">{dateErr}</p>}
      {create.isError && <p className="text-sm text-destructive sm:self-center">Could not add.</p>}
    </form>
  );
}

export default function Items() {
  const q = useGetOrganizer({ query: { queryKey: getGetOrganizerQueryKey() } });
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const tz = settings.data?.timezone ?? browserZone();
  const [show, setShow] = useState<"open" | "done">("open");
  const search = useSearch();
  const [schedule, setSchedule] = useState("all");
  useEffect(() => {
    const value = new URLSearchParams(search).get("schedule");
    setSchedule(value === "scheduled" || value === "unscheduled" ? value : "all");
  }, [search]);
  const mine = (q.data?.items ?? []).filter(i => schedule === "all" || (schedule === "scheduled" ? !!i.dueAt : !i.dueAt));
  const open = mine.filter((i) => i.status === "open").sort(compareActionItems);
  const closed = mine.filter((i) => i.status !== "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const list = show === "open" ? open : closed;
  const label = "Tasks";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-3xl">{label}</h1>
        <div className="flex rounded-md border border-border bg-card p-0.5 text-xs" role="tablist">
          {(["open", "done"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={show === s} onClick={() => setShow(s)} data-testid={`tab-${s}`}
              className={`rounded px-2.5 py-1 ${show === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {s === "open" ? `Open ${open.length}` : `Closed ${closed.length}`}
            </button>
          ))}
        </div>
      </div>
      <Composer tz={tz} />
      <div className="flex gap-1" aria-label="Task schedule">
        {(["all", "scheduled", "unscheduled"] as const).map(value => <button key={value} type="button" aria-pressed={schedule === value} data-testid={`filter-${value}`} onClick={() => setSchedule(value)} className={`rounded-md px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${schedule === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"}`}>{value === "all" ? "All" : value === "scheduled" ? "Scheduled" : "Unscheduled"}</button>)}
      </div>
      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : q.isError ? (
        <div className="rounded-lg border border-destructive/40 p-5 text-sm">Could not load {label.toLowerCase()}. <button className="underline" data-testid="button-retry" onClick={() => q.refetch()}>Retry</button></div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center" data-testid="empty-items">
          <p className="font-display text-2xl">{show === "open" ? "Nothing to do." : "Nothing closed yet."}</p>
          {show === "open" && <p className="mt-1 text-sm text-muted-foreground">Speak to your ring, or add one above.</p>}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {list.map((i) => <ActionItemRow key={i.id} item={i} tz={tz} />)}
        </ul>
      )}
    </div>
  );
}
