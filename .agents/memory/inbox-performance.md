---
name: Inbox performance tradeoffs
description: Why long-history optimization retains mounted cards without CSS content visibility.
---
Avoid adding estimated-height rendering containment to the inbox without testing
deep links near the end of a long retained history.

**Why:** A large-history experiment with `content-visibility: auto` improved
initial layout but caused deep-linked cards to land outside the viewport, even
when the highlighted card itself was exempt from containment. Removing
per-card entrance transforms and unnecessary refresh renders was sufficient for
smooth scrolling in the measured workload, without this risk.

**How to apply:** Prefer measured reductions in unchanged-card work. If future
scaling requires containment or unmounting windowing, verify both scroll roots,
deep-link landing, active audio, expanded payloads, unsaved task edits and
visible-card anchoring, rather than assuming stable React keys are sufficient.
