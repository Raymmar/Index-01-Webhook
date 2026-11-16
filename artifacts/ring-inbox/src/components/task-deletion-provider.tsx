import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteItem, useRestoreItem, getGetOrganizerQueryKey, getListEventsQueryKey } from "@workspace/api-client-react";
import { TaskDeletion } from "@/lib/task-deletion";

const Context = createContext<TaskDeletion | null>(null);
export function useTaskDeletion() {
  const value = useContext(Context);
  if (!value) throw new Error("Task deletion requires a signed-in workspace");
  return value;
}

export function TaskDeletionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const remove = useDeleteItem();
  const restore = useRestoreItem();
  const [deletion] = useState(() => new TaskDeletion({
    remove: id => remove.mutateAsync({ id }),
    restore: id => restore.mutateAsync({ id }),
    changed: () => {
      void queryClient.invalidateQueries({ queryKey: getGetOrganizerQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
    },
  }));
  return <Context.Provider value={deletion}>{children}<TaskDeletionMessages deletion={deletion} /></Context.Provider>;
}

export function TaskDeletionMessages({ deletion }: { deletion: TaskDeletion }) {
  const notices = useSyncExternalStore(deletion.subscribe, deletion.snapshot);
  useEffect(() => {
    const expire = () => deletion.expire();
    const timer = window.setInterval(expire, 250);
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [deletion]);
  const button = "shrink-0 rounded-md px-3 py-2 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  return <section aria-label="Task deletion messages" className="pointer-events-none fixed inset-x-3 bottom-3 z-50 ml-auto max-h-[45dvh] max-w-md space-y-2 overflow-y-auto">
    {notices.map(notice => <div key={notice.id} data-testid={`task-deletion-${notice.id}`} className="pointer-events-auto rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-sm">
      <p role="status" aria-atomic="true">
        {notice.state === "restored" ? `Restored “${notice.title}”.`
          : notice.state === "expired" ? `Removed “${notice.title}”. Undo is no longer available.`
          : notice.state === "restoring" ? `Restoring “${notice.title}”…`
          : `Removed “${notice.title}”. Undo is available for 15 seconds from deletion.`}
      </p>
      {notice.error && <p role="alert" className="mt-1 text-destructive">{notice.error}</p>}
      <div className="mt-1 flex justify-end gap-1">
        {(notice.state === "ready" || notice.state === "restoring") && <button type="button" className={button} disabled={notice.state === "restoring"}
          data-testid={`button-undo-delete-${notice.id}`} aria-label={`Undo removal of ${notice.title}`} onClick={() => void deletion.undo(notice.id)}>
          {notice.state === "restoring" ? "Restoring…" : "Undo"}
        </button>}
        <button type="button" className={button} disabled={notice.state === "restoring"} aria-label={`Close deletion message for ${notice.title}`} onClick={() => deletion.dismiss(notice.id)}>Close</button>
      </div>
    </div>)}
  </section>;
}
