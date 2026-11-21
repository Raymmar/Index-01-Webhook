---
name: Shared frontend context identity
description: Why matching package versions are not enough for context-based shared frontend libraries.
---
Verify production bundle module identity when shared-library hooks cannot see an app-level provider, even when package versions match.

**Why:** pnpm peer variants can bundle separate contexts; development can work while the signed-in production app crashes.

**How to apply:** Check resolved package paths and bundled provider count before changing authentication or adding another provider. Deduplicate the directly consumed context package, not transitive packages the app cannot resolve.

Apply the same rule to isolated esbuild browser harnesses: explicitly resolve React, React DOM, and React Query from the target app. **Why:** the harness otherwise can report hook/context failures that the app's deduplicated Vite build does not have.
