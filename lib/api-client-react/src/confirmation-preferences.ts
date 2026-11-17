import { useQueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey, useGetSettings, useUpdateSettings } from "./generated/api";

export type ConfirmationPreference =
  | "skipTaskDismissConfirmation"
  | "skipTaskDeleteConfirmation"
  | "skipMessageDeleteConfirmation";

// Both clients share the same account settings cache, refreshed by SSE.
// Missing/loading preferences fail safe: show confirmation.
export function useConfirmationPreferences() {
  const query = useGetSettings();
  const client = useQueryClient();
  const update = useUpdateSettings();
  return {
    skips: (key: ConfirmationPreference) => query.data?.[key] === true,
    pending: update.isPending,
    async remember(key: ConfirmationPreference) {
      const next = await update.mutateAsync({ data: { [key]: true } });
      await client.cancelQueries({ queryKey: getGetSettingsQueryKey() });
      client.setQueryData(getGetSettingsQueryKey(), next);
    },
  };
}
