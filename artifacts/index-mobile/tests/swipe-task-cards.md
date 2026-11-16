# Swipe task cards verification

Run from the workspace root:

- `pnpm --filter @workspace/api-spec run codegen`
- `pnpm run typecheck`
- `node artifacts/api-server/tests/task-paragraphs.mjs`
- `node artifacts/index-mobile/tests/swipe-task-row.mjs`
- `node artifacts/index-mobile/tests/web-swipe-delete.mjs`

Updated behavior: mobile left swipes dismiss and can be restored through the
Dismissed filter. The pin label and menu allow unpinning. Web task swipes remove
only the task; web inbox swipes soft-delete the original message, retaining
derived objects and displaying “Original content deleted” on associated tasks.

The database test also covers unpin, dismiss/restore, message deletion ownership,
redacted source responses, blocked deleted audio/extraction, and preserved
derived tasks. Run with `NODE_ENV=production` when the inbox router is included
to avoid the temporary test bundle resolving the development logging transport.
The additional web touch test verifies left-only deletion, nested task isolation,
canceled and reversed swipes, failed deletion, and retry.
It also verifies mouse drags and touch gestures over task-title textareas,
transcript paragraphs, and audio controls do not delete. Web deletion gestures
are touch-only on noninteractive row areas; mouse users use the delete action.
Deleted queued sources are canceled, and stale jobs check deletion before any
model invocation; the database regression asserts zero model calls.

Repinning regression: right swipes during an unfinished pin/unpin are accepted
and coalesced into a serialized pending pin, rather than discarded. The touch
harness checks repeated pin acceptance during pending operations and the
left-only mobile Inbox configuration. Database coverage repeats unpin → pin →
fresh read five times. The mobile Inbox uses this same left-only row, opens a
confirmation, and keeps linked tasks after deletion. The desktop Inbox delete
command is in each card's top-right actions menu.

The database test runs actual organizer routes against an isolated PostgreSQL
schema and test identities. It covers null defaults, pin A / pin B / repin A,
rapid concurrent pins, fresh-read persistence, unrelated edits preserving pins,
owner scoping, removal, and unchanged source messages and siblings.

The browser test bundles the actual row with React Native Web in a local,
test-only harness. Chromium touch events cover both directions, threshold
reversal, touch cancellation, pending-state disabling, edit taps, suppressed
swipe clicks, and vertical scrolling. It does not bypass app authentication.
Set `CHROMIUM_PATH` if Chromium is installed elsewhere.

The running Expo preview was checked at mobile size and rendered sign-in.
The authenticated Dashboard was not visually verified. No native simulator or
physical iOS device was available, so native scroll/responder arbitration remains
a device-testing limitation.

The broader existing `organizer.mjs` suite was attempted but stopped before
these operations: its extraction fixture remained pending instead of completed.
The focused database test above does not depend on the extraction worker.

Failed pin/delete requests do not optimistically remove or reorder rows. The
Dashboard displays the request error, releases its synchronous per-row lock, and
invalidates the organizer query. Successful mutations apply the server response
before refetching; existing account-scoped live notifications refresh other
sessions. These cache/error paths were inspected in code, not exercised in a
signed-in browser session.
