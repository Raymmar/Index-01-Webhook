// Isolated synthetic history: no sign-in bypass, network requests or real data.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getGetOrganizerQueryKey, getListEventsQueryKey } from "@workspace/api-client-react";
import { InboxFeed } from "../../src/pages/inbox";
import { InboxDrawerContext } from "../../src/hooks/use-inbox-drawer";
import "../../src/index.css";

const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
notifyManager.setScheduler(callback => callback());
const key = [...getListEventsQueryKey({ pageSize: 20 }), "feed"];
const event = (n: number) => ({
  id: `note-${n}`, receivedAt: new Date(1800000000000 - n * 60000).toISOString(),
  kind: "recording", transcription: `Message ${n}. Review the project notes, arrange the next meeting and send the updated plan. `.repeat(3 + n % 4),
  webhookName: "Performance fixture", payload: { transcript: "Example payload ".repeat(100), sequence: n },
  audioUrl: null, recordedAt: null, audioSize: null,
});
const events = Array.from({ length: Number(new URLSearchParams(location.search).get("count") ?? 1000) }, (_, n) => event(n));
const items = events.filter((_, n) => n % 5 === 0).flatMap(e => [0, 1, 2].map(n => ({
  id: `${e.id}-task-${n}`, sourceEventId: e.id, title: `Follow up ${n}`, status: "open",
  kind: "task", timezone: "UTC", dueAt: null, needsReview: false,
})));
client.setQueryData(key, { items: events, nextCursor: null });
client.setQueryData(getGetOrganizerQueryKey(), { items, jobs: [] });
const root = createRoot(document.getElementById("root")!);
const embedded = new URLSearchParams(location.search).get("embedded") !== "false";
const selectedNote = new URLSearchParams(location.search).get("event");
const start = performance.now();
flushSync(() => root.render(
  <QueryClientProvider client={client}>
    <InboxDrawerContext.Provider value={{ openInbox() {} }}>
      <div data-inbox-scroll style={{ height: embedded ? "95vh" : undefined, overflow: embedded ? "auto" : undefined, maxWidth: 720, margin: "auto" }}>
        <InboxFeed embedded={embedded} selectedNote={selectedNote} />
      </div>
    </InboxDrawerContext.Provider>
  </QueryClientProvider>,
));
document.body.getBoundingClientRect();
const mountMs = performance.now() - start;
let arrival = 0;
Object.assign(window, {
  fixture: {
    mountMs,
    enableAudio() {
      // A ten-second silent WAV generated only for playback-state checks.
      const bytes = new Uint8Array(80044).fill(128);
      const view = new DataView(bytes.buffer);
      const text = (offset: number, value: string) => [...value].forEach((c, n) => bytes[offset + n] = c.charCodeAt(0));
      text(0, "RIFF"); view.setUint32(4, 80036, true); text(8, "WAVE");
      text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
      view.setUint16(32, 1, true); view.setUint16(34, 8, true);
      text(36, "data"); view.setUint32(40, 80000, true);
      const audioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      flushSync(() => client.setQueryData(key, (previous: any) => ({
        ...previous, items: previous.items.map((e: any) => e.id === "note-0" ? { ...e, audioUrl } : e),
      })));
    },
    prioritize() {
      flushSync(() => client.setQueryData(getGetOrganizerQueryKey(), { items, jobs: [{ eventId: "note-1500", status: "processing" }] }));
    },
    async refresh() {
      const start = performance.now();
      flushSync(() => client.setQueryData(key, (previous: any) => ({ ...previous, items: [event(--arrival), ...previous.items] })));
      document.body.getBoundingClientRect();
      return performance.now() - start;
    },
    async scroll() {
      const times: number[] = [];
      const scroller = document.querySelector<HTMLElement>("[data-inbox-scroll]")!;
      let previous = performance.now();
      for (let n = 0; n < 100; n++) {
        if (embedded) scroller.scrollTop += 180;
        else window.scrollBy(0, 180);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        times.push(now - previous);
        previous = now;
      }
      times.sort((a, b) => a - b);
      return { p50: times[50], p95: times[95], max: times.at(-1) };
    },
  },
});
