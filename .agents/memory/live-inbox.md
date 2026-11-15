---
name: Live inbox updates
description: Why the ring inbox uses SSE and cross-instance notifications.
---
Use webhook-driven SSE for live inbox updates, not periodic list polling.

**Why:** The user explicitly requested automatic SSE updates when a webhook arrives instead of checking every five seconds.

**How to apply:** Notify only after the delivery transaction commits, scope streams to the authenticated account, and refetch on connection/reconnection to catch missed deliveries. Keep notifications cross-instance because a production webhook and browser stream can land on different API instances. Keep heartbeat traffic distinct from polling for records.
