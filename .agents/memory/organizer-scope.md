---
name: Organizer product scope
description: User-approved direction for future AI organization and remix ownership.
---

Use ONE inbox-item primitive. A message is a note by default; an explicit action
makes that same item a task; a due date makes it scheduled. These are attributes
and filtered views of the same item, never separate extracted records.
Tasks has All, Scheduled, and Unscheduled filters. The inbox covers notes;
there is no separate Notes tab or page. Keep transcript, audio, status, and date together.
**Why:** The user explicitly replaced the earlier multi-extraction model:
"these are just distinctions on the same item. They're not a bunch of different items."

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
placement when processing finishes. Tasks shares its item UI with Dashboard.
There is no separate Reminders page. Sort open
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
