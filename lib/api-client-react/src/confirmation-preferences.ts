import { useQueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey, useGetSettings, useUpdateSettings } from "./generated/api";
import type { SourceDeletionScope } from "./generated/api.schemas";

export type ConfirmationPreference =
  | "skipTaskDismissConfirmation"
  | "skipTaskDeleteConfirmation"
  | "skipMessageDeleteConfirmation";

export const sourceDeletionPreferences = (scope: SourceDeletionScope): ConfirmationPreference[] =>
  scope === "all" ? ["skipMessageDeleteConfirmation", "skipTaskDeleteConfirmation"]
    : [scope === "note" ? "skipMessageDeleteConfirmation" : "skipTaskDeleteConfirmation"];
export const sourceDeletionLabel = (scope: SourceDeletionScope) =>
  scope === "note" ? "Delete note" : scope === "tasks" ? "Delete tasks" : "Delete all";
export const sourceDeletionDescription = (scope: SourceDeletionScope) =>
  scope === "note" ? "The original note and audio will be hidden. Linked tasks remain, with an original-content-deleted notice."
    : scope === "tasks" ? "All tasks belonging to this note will be removed, including completed, dismissed, and pinned tasks. The note and audio stay in Notes. This bulk action has no Undo."
      : "This note and its audio will be hidden, and all tasks belonging to it will be removed, including completed, dismissed, and pinned tasks. Other notes and tasks stay unchanged. This action has no Undo.";

// Both clients share the same account settings cache, refreshed by SSE.
// Missing/loading preferences fail safe: show confirmation.
export function useConfirmationPreferences() {
  const query = useGetSettings();
  const client = useQueryClient();
  const update = useUpdateSettings();
  return {
    skips: (key: ConfirmationPreference) => query.data?.[key] === true,
    pending: update.isPending,
    async remember(key: ConfirmationPreference | ConfirmationPreference[]) {
      const keys = Array.isArray(key) ? key : [key];
      const next = await update.mutateAsync({ data: Object.fromEntries(keys.map(key => [key, true])) });
      await client.cancelQueries({ queryKey: getGetSettingsQueryKey() });
      client.setQueryData(getGetSettingsQueryKey(), next);
    },
  };
}
