---
name: Organizer product scope
description: User-approved direction for future AI organization and remix ownership.
---

The original webhook is the note. AI must never create additional notes from it;
one webhook may produce multiple tasks and reminders.

Use UTC for reminder instants and localized display. Detect the owner's timezone,
save it, and provide a settings override.

Limit the product to one user per remix; remixers can expand multi-user support.

Support Replit-native AI and an owner's own provider key, starting with OpenAI.
Keep provider and service integrations replaceable so users need not depend on
Replit for AI or connected services.

**Why:** The user explicitly refined and agreed to this product direction.

**How to apply:** Treat these as requirements when implementation is requested.
This discussion did not authorize building the organizer yet. Preserve the original
webhook and distinguish current functionality from proposed capabilities.
