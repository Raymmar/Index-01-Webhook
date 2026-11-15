# Task text regression checks

From the workspace root:

```sh
node artifacts/api-server/tests/task-paragraphs.mjs
pnpm --filter @workspace/ring-inbox exec node tests/task-text/browser.mjs
pnpm run typecheck
```

The API check uses real organizer routes and PostgreSQL in a temporary isolated
schema, with a fixture identity. It checks paragraph create/update/readback,
whitespace validation and the unchanged 500-character limit. It never changes
existing accounts or records and does not call an AI provider.

The browser check requires `chromium` on PATH (or `CHROMIUM` pointing to it).
It builds the actual web Composer/ActionItemRow and mobile ItemEditor through
React Native Web, with synthetic API responses. This is a temporary test page,
not a registered app route, and it does not bypass either app's authentication.
Audio, date picker, icons, safe-area insets and the native keyboard adapter are
stubbed; task inputs, sheets and mutations are real components. The harness
exposes the swipe callback to test task switching directly, not finger gestures.

It checks 375px and 1280px widths, initial long content, typing/paste, Enter,
blank paragraphs, blur-save, Escape, deletion/empty fields, reopening, cross-app
updates, focused selection, font completion, long unbroken text, the 105px mobile
minimum, switching tasks, unsaved navigation, and outer sheet scrolling. Output
and a screenshot go in ignored `generated-artifacts/task-text/`.

These checks do **not** verify authenticated full-app navigation, Safari,
physical-device native layout, a software keyboard, or actual finger gestures.
The native field relies on React Native content-size events and keeps the
existing keyboard-aware outer sheet; device verification is still needed.
