import { TASK_UNDO_MS } from "./inbox-primitives";
export { TASK_UNDO_MS } from "./inbox-primitives";
export type DeletedTask = { id: string; title: string };
export type DeletionNotice = DeletedTask & { expiresAt: number; state: "ready" | "restoring"; error?: string };
type DeletionApi = {
  remove: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  changed: () => void;
  now?: () => number;
};

/** Shared lifecycle; each platform owns presentation, not deletion semantics. */
export class TaskDeletion {
  notices: DeletionNotice[] = [];
  private busy = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(private api: DeletionApi) {}
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
      this.publish(this.notices.filter(row => row.state !== "ready" || this.now() < row.expiresAt));
    }
  };
  dismiss = (id: string) => {
    if (!this.busy.has(id)) this.publish(this.notices.filter(row => row.id !== id));
  };
  async remove(item: DeletedTask) {
    if (this.busy.has(item.id)) return;
    this.busy.add(item.id);
    const expiresAt = this.now() + TASK_UNDO_MS;
    try {
      await this.api.remove(item.id);
      this.publish([...this.notices.filter(row => row.id !== item.id), ...(this.now() < expiresAt ? [{
        id: item.id, title: item.title, expiresAt, state: "ready" as const,
      }] : [])]);
    } finally { this.busy.delete(item.id); this.api.changed(); }
  }
  async undo(id: string) {
    const notice = this.notices.find(row => row.id === id);
    if (!notice || notice.state !== "ready" || this.busy.has(id)) return;
    if (this.now() >= notice.expiresAt) { this.expire(); return; }
    this.busy.add(id);
    this.update(id, { state: "restoring", error: undefined });
    try {
      await this.api.restore(id);
      this.publish(this.notices.filter(row => row.id !== id));
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      const expired = status === 404 || status === 410 || this.now() >= notice.expiresAt;
      if (expired) this.publish(this.notices.filter(row => row.id !== id));
      else this.update(id, { state: "ready", error: "Could not restore. Try Undo again before the window closes." });
    } finally { this.busy.delete(id); this.api.changed(); }
  }
}
