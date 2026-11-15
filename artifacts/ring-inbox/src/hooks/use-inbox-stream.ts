import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListEventsQueryKey, getListWebhooksQueryKey } from "@workspace/api-client-react";

export function useInboxStream() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const stream = new EventSource(`${base}/api/events/stream`, { withCredentials: true });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
    };
    stream.addEventListener("ready", () => {
      setStatus("live");
      // Includes deliveries missed while offline or connecting.
      refresh();
    });
    stream.addEventListener("inbox-changed", refresh);
    stream.onerror = () => setStatus("reconnecting");
    return () => stream.close();
  }, [queryClient]);

  return status;
}
