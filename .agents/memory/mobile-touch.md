---
name: Mobile touch interactions
description: User expectation for task-detail and calendar swipe navigation.
---
Requested mobile swipes must work with fingers; arrow buttons are not a substitute.

Card action menus must use the smallest practical layout space and sit across
from the card title, without making the row taller.
**Why:** The user explicitly rejected oversized buttons on both task and message cards.
**How to apply:** Keep the visible layout compact; use invisible touch padding
instead of expanding the card header.

**Why:** The user explicitly corrected task-detail and calendar navigation that did not respond to finger swipes.

**How to apply:** Preserve direct horizontal gestures in those views without interfering with text editing, date pickers, or audio controls. Do not treat working navigation buttons as proof that swiping works.

When combining raw touch observation with PanResponder, measure both from the
same initial touch position rather than mixing raw displacement with responder
`dx`.

**Why:** React Native Web can start responder displacement at claim time, after
the finger has already moved. Mixing these distances made deliberate swipes
fall short of the release threshold in real browser touch tests.

**How to apply:** Verify release thresholds with actual touch events, including
reversed drags and scroll cancellation, rather than calling callbacks directly.

Animation assertions in React Native Web touch harnesses must run with
`NODE_ENV=development`, not `test`.

**Why:** React Native Web silently substitutes instant mock animations in test
mode. Gesture counts can pass while no real snap-back animation runs.

**How to apply:** Sample intermediate frames and verify that mutations that
reorder rows or open confirmations occur only after the displaced row returns.
