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
**How to apply:** Keep extraction preferences in the user's editable skill, not
hardcoded editorial rules or examples in the system prompt.
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

Historical dates in a recording are context, not automatically task deadlines.
“Yesterday I did XYZ; remind me on this date” must use the requested action date,
interpreted relative to the message receipt timestamp. Do not shift a deadline
backward merely because the narrative mentions the past.
**Why:** The user explicitly corrected treating “yesterday” as a past-deadline
policy question instead of interpreting its role in the message.
**How to apply:** Distinguish narrative timing from action timing. Keep date
conventions and extraction preferences editable in Settings > Prompts; the
system prompt should contain processing instructions and the output contract.

The first person who logs in becomes the owner automatically, with no additional
setup. Default to one owner per remix. Provide a simple owner-controlled Settings
toggle to open the app to additional users; do not permanently lock out multi-user use.

Support Replit-native AI and an owner's own provider key, starting with OpenAI.
Keep provider and service integrations replaceable so users need not depend on
Replit for AI or connected services.

The current scope is ingestion and understanding only. Connectors stay separate;
external actions will be connected through a workflow layer later.

The long-term product is a personal thinking partner: adaptable inputs from voice
assistants and other sources, user-guided workflows, related sequential thought
grouping, and daily higher-level insights.
**Why:** The user explicitly described this direction and requested modular
separation between ingestion, AI understanding, and future connectors.
**How to apply:** Preserve source messages independently of processing and keep
web/mobile on shared domain primitives and API contracts. Treat these future
capabilities as direction, not authorization to implement them.

The user wants two workflow types: individual task extraction and batch/timed
review, each driven by editable prompts rather than one hardcoded recursive loop.
Review should connect rapid sequences of thoughts, reconcile existing tasks,
and maintain a rolling overview of topics, projects, and current focus.
Leave initial task extraction unchanged: it processes individual messages, without
adding related messages, existing-board context, or cross-message reconciliation.
All batch understanding and synthesis belongs in a separate layer on top of the
existing message and task primitives.
**Why:** The user explicitly rejected changing the initial extraction flow or
making it gather broader context as part of adding review workflows.
**Why:** The product is a voice-note thinking partner between meetings, not only
a task inbox or long-form meeting summarizer. Repeated mentions can refine an
existing task instead of creating another, and non-actionable thoughts still
matter to the overview.
**How to apply:** Reuse messages and tasks (scheduled tasks remain tasks), select
different context bundles and triggers, and avoid a new project/knowledge-graph
system unless needed. These are product requirements under discussion, not
approval for destructive automatic merging or unrestricted autonomous changes.

Keep this simple: prioritize reliable core behavior before adding a more
powerful assistant, user-defined keyword rules, contacts, or dictated email drafts.
**Why:** The user explicitly rejected unnecessary complexity while describing a
future “chief of staff” role.
**How to apply:** Connect external intelligence using a central editable skill.
The user does want a workflow builder; avoiding a custom AI runtime does not
mean omitting workflow controls or inventing extra data layers.

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
