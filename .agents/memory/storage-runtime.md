---
name: Storage runtime compatibility
description: Development-specific storage project discovery and webhook verification.
---
Do not upgrade the Google Cloud Storage client without testing upload and readback in development.

**Why:** Version 9 unconditionally attempted project-ID discovery with Replit's sidecar credentials and failed in development, while production recordings worked. Version 7.22.0 passed upload/readback with the unchanged client configuration.

**How to apply:** Exercise authenticated multipart audio delivery, database persistence, and storage readback after storage dependency changes. Text-only Pebble test events bypass storage and cannot validate recording ingestion. Never infer a production failure merely from a development configuration difference.
