---
name: Organizer product scope
description: User-approved direction for future AI organization and remix ownership.
---

The user intends to open-source this version.
**Why:** The user stated this while naming the release.
**How to apply:** Keep the existing remix-friendly scope; do not assume a license
or publish source without a separate instruction.

Deleting an original inbox message must not remove tasks or other objects
created from it. Treat the message as soft-deleted and reference that its
original content was deleted in associated tasks.
**Why:** The user explicitly clarified that derived objects must survive deletion
of their source.
**How to apply:** Preserve this independence when adding future derived objects
or changing message retention.

The iOS companion must be a separate native mobile app, not a reskin or WebView
of the website. It shares the backend and accounts, defaults to Dashboard, and
has Dashboard, Inbox, Webhooks, and Settings bottom tabs with native glass controls.
**Why:** The user explicitly confirmed a new mobile artifact and native iOS UI.
**How to apply:** Preserve the website's dashboard/inbox-drawer layout while
using a separate Inbox tab on mobile.

Keep mobile development and production data separate; do not add an environment
selector. Expo development uses development data, and the published mobile app
is expected to use production data.
**Why:** The user chose to keep the environments separate after discussing a selector.
**How to apply:** Preserve that separation and ensure publishing targets the production backend.

Keep one unchanged source inbox message with zero, one, or many independently
managed child tasks. A reminder is a task with a due date, not a separate
primitive. Notes means sources with no remaining children, including closed ones.
Do not restore archived extractions or speculatively split historical summaries.
**Why:** The user explicitly superseded the one-message/one-action scope with
independent multi-action extraction, while preserving original transcript/audio.
**How to apply:** Extract only explicit instructions or definite commitments with
transcript-local action and object context. Preserve the user's substantive prompt
and examples; do not infer unspecified referents such as “Send this to production”.
Do not cap extraction to one task or combine distinct deliverables into a summary.
Task count and each task's scope come from the recording. Shared action/object
context can support separate tasks for independently named shows or dates.
**Why:** The user reiterated that the number of tasks must match the actual
content after a multi-show recording produced no tasks.

Use UTC for reminder instants and localized display. Detect the owner's timezone,
save it, and provide a settings override.
Resolve reminder dates from message receipt time. Date-only phrases such as
"tomorrow" should receive a concrete time, not be left undated for review.
**Why:** The user explicitly rejected leaving these reminders at "Check time".

The first person who logs in becomes the owner automatically, with no additional
setup. Default to one owner per remix. Provide a simple owner-controlled Settings
toggle to open the app to additional users; do not permanently lock out multi-user use.

Support Replit-native AI and an owner's own provider key, starting with OpenAI.
Keep provider and service integrations replaceable so users need not depend on
Replit for AI or connected services.

The current scope is ingestion and understanding only. Connectors stay separate;
external actions will be connected through a workflow layer later.

Dashboard is the primary signed-in view, based on the Week Ahead design.
Inbox is a toggleable drawer available in every signed-in view, not a standalone
page. On wide screens it opens between main navigation and page content; on
small screens it overlays the page. The Inbox nav control toggles it and its
header offers Close inbox. Original-note links open the message in the drawer.
Pin the note being processed at the top and highlight it; restore chronological
placement when processing finishes. Dashboard is the main action workspace;
there are no separate Tasks or Reminders pages. Default to all open items,
including overdue and undated items; calendar selection narrows the list. Sort open
actions by due-date urgency, not arrival time.
**Why:** The user refined "always available" to a sliding drawer rather than an
always-open panel or separate Inbox page.

Do not add UI that is unnecessary for implemented functionality. In particular,
do not add explanatory limitation text about reminder delivery while discussing
or building this initial scope.

**Why:** The user explicitly refined and agreed to this product direction.

**How to apply:** Preserve these requirements while extending the organizer.
Preserve the original webhook and distinguish current functionality from proposed
capabilities. The user authorized implementing the shared shell, AI, and settings
together in one pass.
