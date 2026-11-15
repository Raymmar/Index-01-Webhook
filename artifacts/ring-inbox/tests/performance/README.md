# Long-history inbox profile

## Reproduce

From the workspace root:

```sh
pnpm --filter @workspace/ring-inbox exec node tests/performance/profile.mjs
```

Requires `chromium` on PATH, or set `CHROMIUM` to its executable path.
The runner uses the existing Vite dependencies and Node's built-in WebSocket
client; no browser-testing dependencies are installed.

Before committing a change, use `--baseline` to build the relevant feed source
from `HEAD` with the same fixture. This compares the uncommitted implementation
against the checked-in version. Run sequentially, not concurrently.

The fixture is **not an application route**. It builds into the ignored
`generated-artifacts/inbox-performance/` directory, serves on an ephemeral
loopback port for the benchmark, and shuts down afterward. It never signs in,
bypasses application authentication, seeds a database, or calls the real API.
All note data, payloads, linked tasks and test audio are generated locally.

## Method

- Production React build of the actual `InboxFeed`, `EventCard`, action rows,
  query cache, priority ordering and scroll anchor.
- 500 and 2,000 retained notes, variable multi-line transcripts, nested payloads.
  Every fifth note has three editable linked actions.
- Both embedded scrolling and full-page scrolling at 1280 × 900 in headless
  Chromium, without CPU throttling.
- Wait 1.2 seconds after mount for the original entrance animations to settle.
- Scroll 100 frames in 180px increments; measure requestAnimationFrame intervals.
- Prepend five individual arrivals through the real QueryClient, measuring
  synchronous cache update + React commit + forced layout. Notifications are
  synchronous in the fixture so measurements include rendering, not just queueing.
  This measures the client-side live refresh, not network or server latency.
- Check all cards remain mounted, audio element/playback state and position are
  retained, an expanded payload stays open, an unsaved task-title edit retains
  focus/value, all three action rows remain, and live arrivals/priority reordering
  preserve the visible card within two pixels.
- Separately navigate to a deep-linked note near the end of the retained history;
  require its highlight and position to be in view in both layouts.

## Measurements

Representative sequential before/after runs on this workspace, November 15,
2026. Refresh values are the median of five arrivals. Frame times are the 95th
percentile of 100 frames. Shared-host timings fluctuate; these are observations,
not hard CI budgets.

| Loaded notes | Layout | Refresh before | Refresh after | Scroll p95 before | Scroll p95 after |
|---|---|---:|---:|---:|---:|
| 500 | Embedded | 158.3 ms | 3.4 ms | 19.6 ms | 17.1 ms |
| 500 | Full page | 96.1 ms | 3.7 ms | 17.9 ms | 17.3 ms |
| 2,000 | Embedded | 305.1 ms | 9.8 ms | 77.7 ms | 17.0 ms |
| 2,000 | Full page | 239.3 ms | 6.5 ms | 18.4 ms | 17.2 ms |

The 2,000-note fixture still contains 2,000 articles and approximately 44,900
DOM elements after five arrivals. History is not capped or evicted.
The first optimized 2,000-note embedded arrival took 41 ms; later arrivals took
8–11 ms. The optimization is not a guarantee of zero long frames.

After integrating the concurrently added new-arrival notice, the same checks
passed again. The 2,000-note refresh medians were 13.2 ms embedded and 9.1 ms
full-page; scroll p95 was 17.4 ms and 18.5 ms respectively. The original table
isolates this task's changes; the additional notice work adds a small cost.

## Findings and decisions

1. React Query's index-based structural sharing cloned shifted event objects
   after each prepend. Memoizing cards alone did not help. ID-based structural
   sharing, plus comparing linked-item references, makes unchanged cards skip
   their date formatting, hooks and action-row renders.
2. Priority ordering is memoized across loading/status-only renders. Linked task
   grouping appends to arrays rather than repeatedly copying sibling arrays.
3. The old scroll-anchor lookup scanned all preceding articles. It now binary
   searches the vertically ordered cards.
4. Every card had a persistent entrance-animation transform. Removing this
   per-card animation improves large embedded-feed scrolling. Other application
   animations and styling are unchanged.
5. Collapsed raw payloads are serialized only when opened.
6. CSS `content-visibility: auto` was evaluated and rejected: estimated heights
   caused the deep-link visibility check to fail. Without containment, scrolling
   already meets the measured need. No unmounting windowing is necessary for
   this measured workload, avoiding risks to interactive state.

## Limits

- Cold mounting an already-retained 2,000-note history still costs roughly
  1–2.4 seconds in these runs. Normal older-history loading mounts 20 notes at
  a time; this work targets sustained scrolling and live refresh, not eliminating
  the retained history's linear memory/mount cost.
- Audio checks verify the same element, playing state, source and non-reset
  position. The headless container has no working audio-output clock, so this
  does **not** verify audible playback.
- Real authenticated API/SSE delivery and Safari/mobile browser performance are
  not exercised by this isolated benchmark. The app's public landing page was
  separately checked; its signed-in UI was not verified through authentication.
- The build reports an existing dropdown-menu sourcemap-location warning but
  completes successfully.
