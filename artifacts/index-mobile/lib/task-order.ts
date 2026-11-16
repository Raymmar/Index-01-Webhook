import type { ActionItem } from '@workspace/api-client-react';

export function compareTasks(a: ActionItem, b: ActionItem) {
  if (a.pinnedAt || b.pinnedAt) {
    if (!a.pinnedAt) return 1;
    if (!b.pinnedAt) return -1;
    return b.pinnedAt.localeCompare(a.pinnedAt) || a.id.localeCompare(b.id);
  }
  return (a.dueAt && b.dueAt ? a.dueAt.localeCompare(b.dueAt) || b.createdAt.localeCompare(a.createdAt) : a.dueAt ? -1 : b.dueAt ? 1 : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id);
}
