---
name: Browser test fixture boundaries
description: Avoid misleading browser test results from fixture globals and native bridge stubs.
---
Keep browser fixture state in a dedicated namespace rather than assigning browser API properties.

**Why:** `window.closed` is a browser-owned read-only property; using it as a close counter made successful editor saves appear to fail.

**How to apply:** Use an application-specific fixture object for counters and controls. Distinguish real browser rendering and API checks from stubbed native media behavior in test reports; player method calls do not prove audible playback.
