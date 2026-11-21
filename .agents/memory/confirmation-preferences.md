---
name: Cross-device confirmation preferences
description: User expectations for remembered dismissal and deletion confirmations.
---
“Don't show this again” must apply consistently to task dismissal, task deletion, and message deletion across web and mobile, including swipe and menu entry points. Store choices on the account, not in browser or device storage.

**Why:** The user explicitly reiterated that the intended behavior is consistent across all devices, not separate local choices.

**How to apply:** Treat confirmation choices as user preferences with server-driven synchronization. Keep the three choices independent; a dismissal opt-out is not consent to skip deletion confirmation.

Mobile deletion must be quiet on success: no task Undo cards, linked-task notices,
or replacement success popups. Keep pre-delete account confirmations, actionable
failures, and web Undo behavior.

**Why:** The user requested removal of unsolicited mobile post-deletion notices,
not a new notification preference or a change to deletion retention.

**How to apply:** Do not reintroduce mobile success notices when changing deletion
flows; preserve the account-backed safeguards separately from success feedback.
