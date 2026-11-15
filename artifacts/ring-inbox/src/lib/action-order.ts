type OrderedItem = { id: string; dueAt: string | null; createdAt: string };

/** Due dates determine urgency; ingestion order only breaks equal-date ties. */
export function compareActionItems(a: OrderedItem, b: OrderedItem): number {
  const due = (item: OrderedItem) => {
    const value = item.dueAt ? Date.parse(item.dueAt) : NaN;
    return Number.isFinite(value) ? value : Infinity;
  };
  const left = due(a), right = due(b);
  if (left !== right) return left < right ? -1 : 1;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
}
