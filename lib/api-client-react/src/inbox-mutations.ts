import { useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import {
  useUpdateItem as generatedUpdate, useCreateItem as generatedCreate,
  usePinItem as generatedPin, useDeleteSource as generatedDeleteSource,
} from "./generated/api";
import { refreshInbox } from "./inbox-primitives";

/** All task/source writes refresh the same lists and open details on either platform. */
function useRefreshOptions<TData, TError, TVariables, TContext>(
  options?: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  const client = useQueryClient();
  return {
    ...options,
    onSettled: async (...args: Parameters<NonNullable<UseMutationOptions<TData, TError, TVariables, TContext>["onSettled"]>>) => {
      try { await options?.onSettled?.(...args); }
      finally { await refreshInbox(client); }
    },
  };
}
export function useTaskUpdate(options?: Parameters<typeof generatedUpdate>[0]) {
  return generatedUpdate({ ...options, mutation: useRefreshOptions(options?.mutation) });
}
export function useTaskCreate(options?: Parameters<typeof generatedCreate>[0]) {
  return generatedCreate({ ...options, mutation: useRefreshOptions(options?.mutation) });
}
export function useTaskPin(options?: Parameters<typeof generatedPin>[0]) {
  return generatedPin({ ...options, mutation: useRefreshOptions(options?.mutation) });
}
export function useSourceDeletion(options?: Parameters<typeof generatedDeleteSource>[0]) {
  return generatedDeleteSource({ ...options, mutation: useRefreshOptions(options?.mutation) });
}
