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

Prompt editors must show their full content and grow with edits; only the page
should scroll, not individual prompt fields.
**Why:** The user explicitly rejected small, internally scrolling prompt editors.
**How to apply:** Reuse autosizing rather than fixed rows or height caps.

Do not dismiss the keyboard on scroll in a page containing growing editors.
**Why:** React Native Web can treat programmatic scrolling caused by field growth
as a scroll that dismisses focus. This interrupted real sequential typing even
though whole-value fill tests passed.
**How to apply:** Test actual keystrokes near wrapping boundaries as well as
paste, resizing, and shrinking; preserve focus when the page moves.
