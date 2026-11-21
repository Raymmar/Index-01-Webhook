# Mobile swipe task cards verification

Run from the workspace root:

```sh
pnpm --filter @workspace/index-mobile typecheck
node artifacts/index-mobile/tests/swipe-task-row.mjs
node artifacts/index-mobile/tests/dashboard-swipes.mjs
node artifacts/index-mobile/tests/quiet-deletion.mjs
NODE_ENV=production node artifacts/api-server/tests/task-paragraphs.mjs
```

## Behavior

Dashboard right swipes toggle pinning. The reveal says **Pin** for an unpinned
task and **Unpin** for a pinned task. During a pending request it reflects the
latest intended state; the badge and ordering only change on authoritative
responses. Explicit menu Pin/Repin and Unpin remain explicit commands.

Both directions require release **strictly beyond half the measured row width**.
Exactly halfway, short fast flicks, canceled gestures, vertical scrolls, and
drags returning inside halfway do nothing. Movement tracks horizontal distance
from the initial touch, without early resistance. A 200ms cubic ease-out returns
the row without bounce; accepted actions run after the return finishes, so
reordering and delete confirmation cannot reset a visibly displaced row.
Touches during that brief return are ignored rather than interrupting it.

Left swipes request task deletion, not dismissal. Confirmation preferences and
15-second Undo remain unchanged. Mobile Inbox uses the same row in left-only
mode; message deletion still retains linked tasks. Desktop gestures, pin ranking,
API routes, schema, palette and deletion scope are unchanged.

## Automated evidence

- **Actual RN Web row with Chromium touch events:** below/exactly/above-half
  boundaries in both directions at widths 240, 320 and 360; resizing the same row,
  including during a drag; direct tracking beyond the old resistance point;
  sampled intermediate return frames with no overshoot and no mutation before
  rest; reverse/cancel in both directions; short fast flicks; multi-touch
  cancellation; pending right-only acceptance; Pin/Unpin labels; Inbox left-only
  mode; nested media isolation; ordinary edit taps, swipe tap suppression and
  actual vertical scrolling.
- **Actual Dashboard in an isolated HTTP harness:** generated API hooks and a
  real QueryClient; pin → unpin → pin via touch; explicit Pin/Repin/Unpin menu
  commands; delayed POST followed by intended DELETE; three pending gestures
  coalescing to the latest state; failed requests, including a server write
  followed by a failed response; queued-intent cleanup and retry; badges and
  ordering after refetch; exact-half delete cancellation, above-half confirmation,
  cancel and quiet successful deletion. Only the surrounding UI, session and
  calendar/editor shell are stubbed. No application authentication is bypassed.
- **Quiet deletion regression:** real Dashboard/LinkedTasks, confirmation dialogs,
  generated hooks and cache; enabled/skipped account confirmation choices,
  failure/retry even when skipped, consecutive deletes with long titles, no
  success notices, independent dismissal preferences, scrolling and navigation.
  Real message confirmations and all source scopes are covered separately by
  `scoped-deletion.mjs`, including skipped-confirmation failure/retry.
- **Real organizer routes and isolated PostgreSQL schema:** pin/repin recency,
  concurrent pins, repeated unpin/pin with fresh reads, unrelated edits retaining
  pins, owner scoping, task removal/restore/expiry, source redaction and retained
  sibling tasks. This is server persistence coverage rather than a browser fixture.

The touch harnesses use development mode: React Native Web substitutes instant
mock animations in test mode, which would invalidate animation verification.
`CHROMIUM_PATH` overrides the default Chromium executable. Explicit menu and
confirmation controls in the Dashboard harness use clicks; swipes use actual
touch events. The row harness independently verifies ordinary edit taps.

## Visual and native-device limits

The running Expo preview renders the existing sign-in screen at 402×874, without
application errors. The signed-in UI was **not** visually verified in the app.
The isolated Dashboard harness was visually inspected, and real return-animation
frames were measured in Chromium. Those harnesses do not establish native feel.

No physical iOS/Android device or native simulator was available. Before a native
release, check slow drags, short flicks, both return directions, orientation/width
changes, vertical scrolling, rapid repeated pin toggles under slow networking,
and delete confirmation on a device. Verify that the card stays aligned with
the finger through halfway and returns without a jump, bounce, or shifted row.
