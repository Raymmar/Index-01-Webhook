---
name: Mobile publishing compatibility
description: Dependency-manager consistency between the workspace and Expo Launch.
---

Keep the workspace's exact pnpm version declared when maintaining mobile publishing; do not assume Expo Launch's default matches local tooling.

**Why:** An Apple publishing attempt installed with pnpm 11 while the workspace used pnpm 10. The remote install rejected ignored dependency scripts before reaching the native build, despite successful local installation.

**How to apply:** Check the actual install output in Expo Launch logs when publishing fails. Preserve script security rules and the existing dependency graph; fix manager drift before changing dependencies or broadly approving scripts.
