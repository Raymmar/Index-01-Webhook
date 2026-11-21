import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshInbox } from "@workspace/api-client-react";
import { getListEventsQueryKey, getListWebhooksQueryKey, getGetOrganizerQueryKey, getGetSettingsQueryKey } from "@workspace/api-client-react";

/** Mount once, in the signed-in shell. */
export function useInboxStream(enabled = true) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");

  useEffect(() => {
    if (!enabled) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const stream = new EventSource(`${base}/api/events/stream`, { withCredentials: true });
    const refresh = () => {
      void refreshInbox(queryClient);
    };
    stream.addEventListener("ready", () => { setStatus("live"); refresh(); });
    stream.addEventListener("inbox-changed", refresh);
    stream.onerror = () => setStatus("reconnecting");
    return () => stream.close();
  }, [queryClient, enabled]);

  return status;
}
