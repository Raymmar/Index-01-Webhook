---
name: Visual consistency
description: User's standing requirement for consistent app-wide borders and colors.
---

Use a unified style guide and color system around the whole app, not isolated
page-level fixes.

**Why:** The user reported recurring dark borders replacing the intended light
edges and explicitly asked for consistent edges throughout the app.

**How to apply:** Preserve the existing visual design when fixing inconsistencies.
Include login, forms, separators, inbox cards, toasts, and toast action buttons
in shared styling decisions. The user reiterated that notifications must use
the same light edges and palette, not independent component defaults.
Do not treat a request to compact a card or fix its edges as permission to resize
or restyle the transcript.

Normalize message transcript and action-title text using one shared content
font size and regular weight, while keeping metadata smaller.
**Why:** The user explicitly requested consistent inbox/dashboard font sizes
after noticing the larger inbox text.
