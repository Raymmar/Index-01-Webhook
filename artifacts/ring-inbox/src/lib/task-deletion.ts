export const TASK_UNDO_MS = 15_000;

export type DeletedTask = { id: string; title: string };
export type DeletionNotice = DeletedTask & {
  expiresAt: number;
  state: "ready" | "restoring" | "restored" | "expired";
  error?: string;
};
type DeletionApi = {
  remove: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  changed: () => void;
  now?: () => number;
};

/** Session-local deletion state, independent of rows and filtered lists. */
export class TaskDeletion {
  notices: DeletionNotice[] = [];
  private busy = new Set<string>();
  private listeners = new Set<() => void>();
  private api: DeletionApi;
  constructor(api: DeletionApi) { this.api = api; }
  private now = () => this.api.now?.() ?? Date.now();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.notices;
  private publish(rows: DeletionNotice[]) {
    this.notices = rows;
    this.listeners.forEach(listener => listener());
  }
  private update(id: string, change: Partial<DeletionNotice>) {
    this.publish(this.notices.map(row => row.id === id ? { ...row, ...change } : row));
  }
  expire = () => {
    if (this.notices.some(row => row.state === "ready" && this.now() >= row.expiresAt)) {
      this.publish(this.notices.map(row => row.state === "ready" && this.now() >= row.expiresAt
        ? { ...row, state: "expired", error: undefined } : row));
    }
  };
  dismiss = (id: string) => {
    if (!this.busy.has(id)) this.publish(this.notices.filter(row => row.id !== id));
  };
  async remove(item: DeletedTask) {
    if (this.busy.has(item.id)) return;
    this.busy.add(item.id);
    // Start before the request: slow responses must not extend server expiry.
    const expiresAt = this.now() + TASK_UNDO_MS;
    try {
      await this.api.remove(item.id);
      this.publish([...this.notices.filter(row => row.id !== item.id), {
        id: item.id, title: item.title, expiresAt,
        state: this.now() < expiresAt ? "ready" : "expired",
      }]);
    } finally {
      this.busy.delete(item.id);
      this.api.changed();
    }
  }
  async undo(id: string) {
    const notice = this.notices.find(row => row.id === id);
    if (!notice || notice.state !== "ready" || this.busy.has(id)) return;
    if (this.now() >= notice.expiresAt) { this.expire(); return; }
    this.busy.add(id);
    this.update(id, { state: "restoring", error: undefined });
    try {
      await this.api.restore(id);
      this.update(id, { state: "restored" });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      const expired = status === 404 || status === 410 || this.now() >= notice.expiresAt;
      this.update(id, {
        state: expired ? "expired" : "ready",
        error: expired ? "This task can no longer be restored." : "Could not restore. Try Undo again before the window closes.",
      });
    } finally {
      this.busy.delete(id);
      this.api.changed();
    }
  }
}
