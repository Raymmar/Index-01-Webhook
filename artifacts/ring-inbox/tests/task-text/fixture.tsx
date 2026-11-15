// Isolated component harness, not an app route or an authentication bypass.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionItemRow, Composer } from "../../src/pages/items";
import { InboxDrawerContext } from "../../src/hooks/use-inbox-drawer";
import { ItemEditor } from "../../../index-mobile/components/item-editor";
import { getGetOrganizerQueryKey, useGetOrganizer, type ActionItem } from "@workspace/api-client-react";
import "../../src/index.css";

const long = ("A long task with several words that should wrap at narrow widths. ").repeat(6) + "\n\nSecond paragraph.";
let tasks: ActionItem[] = [
  { id: "long", title: long, status: "open", kind: "task", dueAt: null, timezone: "UTC", needsReview: false, sourceEventId: "source", originalTimeText: null, createdAt: "2026-11-15T10:00:00Z" },
  { id: "short", title: "Short task", status: "open", kind: "task", dueAt: null, timezone: "UTC", needsReview: false, sourceEventId: "source", originalTimeText: null, createdAt: "2026-11-15T10:00:00Z" },
];
const requests: { method: string; title?: string }[] = [];
window.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const data = init?.body ? JSON.parse(String(init.body)) : {};
  if (method !== "GET") {
    requests.push({ method, title: data.title });
    if (method === "POST") tasks.push({ ...tasks[0], id: "created", ...data });
    if (method === "PATCH") tasks = tasks.map(t => url.endsWith("/" + t.id) ? { ...t, ...data } : t);
  }
  return new Response(JSON.stringify(url.includes("/events/") ? { audioUrl: null } : { items: tasks, jobs: [], messageCount: 0 }), { status: 200, headers: { "content-type": "application/json" } });
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
client.setQueryData(getGetOrganizerQueryKey(), { items: tasks, jobs: [], messageCount: 0 });
function Harness() {
  const [editor, setEditor] = useState(false);
  const query = useGetOrganizer();
  return <InboxDrawerContext.Provider value={{ openInbox() {} }}>
    <main style={{ maxWidth: 720, margin: "auto", padding: 22 }}>
      <Composer tz="UTC" />
      <ul>{query.data?.items.map(item => <ActionItemRow key={item.id} item={item} tz="UTC" />)}</ul>
      <button id="open-mobile" onClick={() => setEditor(true)}>Open mobile task editor</button>
      {editor && <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ItemEditor item={query.data?.items[0]} tasks={query.data?.items} tz="UTC" onClose={() => setEditor(false)} />
      </SafeAreaProvider>}
    </main>
  </InboxDrawerContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
Object.assign(window, { fixture: { requests, get tasks() { return tasks; }, long, refresh: () => client.invalidateQueries({ queryKey: getGetOrganizerQueryKey() }) } });
