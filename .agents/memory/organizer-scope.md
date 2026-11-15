---
name: Organizer product scope
description: User-approved direction for future AI organization and remix ownership.
---

The original webhook is the note. AI must never create additional notes from it;
one webhook may produce multiple tasks and reminders.

Use UTC for reminder instants and localized display. Detect the owner's timezone,
save it, and provide a settings override.

The first person who logs in becomes the owner automatically, with no additional
setup. Default to one owner per remix. Provide a simple owner-controlled Settings
toggle to open the app to additional users; do not permanently lock out multi-user use.

Support Replit-native AI and an owner's own provider key, starting with OpenAI.
Keep provider and service integrations replaceable so users need not depend on
Replit for AI or connected services.

The current scope is ingestion and understanding only. Connectors stay separate;
external actions will be connected through a workflow layer later.

Do not add UI that is unnecessary for implemented functionality. In particular,
do not add explanatory limitation text about reminder delivery while discussing
or building this initial scope.

**Why:** The user explicitly refined and agreed to this product direction.

**How to apply:** Preserve these requirements while extending the organizer.
Preserve the original webhook and distinguish current functionality from proposed
capabilities. The user authorized implementing the shared shell, AI, and settings
together in one pass.
