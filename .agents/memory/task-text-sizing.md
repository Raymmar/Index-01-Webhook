---
name: Task text sizing
description: Why browser autosizing uses an unfocused measurement copy instead of collapsing the live field.
---

Measure browser task text without temporarily collapsing the focused editor.

**Why:** In browser checks, resetting a focused React Native Web textarea's
height undercounted long unbroken text by a line. It can also move the outer
sheet while the caret is active. An unfocused, hidden measurement copy avoids
both effects without remounting the editor or changing its selection.

**How to apply:** Preserve non-destructive measurement when extending autosizing;
check long unbroken text with a focused caret, deletion, available width changes,
and containing-page scrolling, not only pasted paragraphs in an unfocused field.
