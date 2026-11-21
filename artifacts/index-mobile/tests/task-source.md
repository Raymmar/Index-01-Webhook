# Task source checks

Run from the workspace root:

```sh
node artifacts/index-mobile/tests/task-source.mjs
pnpm --filter @workspace/index-mobile typecheck
node artifacts/index-mobile/tests/swipe-task-row.mjs
```

The source test renders the real task editor, shared sheet, recording component,
Dashboard, and linked inbox tasks in a 375 × 812 React Native Web browser.
Generated query/mutation hooks use an isolated local HTTP fixture server, not
the application's data or a bypass of its authentication.

Covered:
- Dashboard and linked inbox task entry.
- Recording before the labeled, selectable, full original transcript.
- Text-only, audio-only, whitespace/missing transcript, and deleted sources.
- A task's deleted-source flag suppressing even a cached source.
- Source-neutral loading, failure/retry, and delayed responses after switching.
- Per-task recording cleanup; authenticated byte fetch, play/pause, and restart
  calls to a stubbed native audio bridge.
- Source-area touch isolation, vertical touch scrolling, and selection of an
  entire 80-paragraph transcript through its final paragraph.
- Task navigation callbacks, discard/keep/save confirmation, due-date save, and
  absence of source content or source requests in the new-task form.

Screenshots are written under the ignored `generated-artifacts/` directory.
The harness does not load the app's font assets; typography sizes, line heights,
and palette come from the actual shared UI styles.

## Limitations

The running Expo preview was checked and showed the sign-in screen. The
signed-in sheet was verified in the isolated component browser, not in an
authenticated application session.

No physical iOS/Android device was available. Audible playback, native text
selection handles, and native task-detail gesture recognition were not verified.
The audio bridge is explicitly stubbed; play calls do not establish actual
decoding or sound output.

Task switching is tested through the editor's existing navigation callback.
Attempts to drive task-detail navigation using browser-generated touch/mouse
gestures in this harness did not switch tasks, so those attempts are not counted
as passing gesture coverage. No gesture implementation was changed. The separate
row-swipe test passes actual-touch row interactions, not detail-sheet navigation.
