---
name: Live inbox updates
description: Why the ring inbox uses SSE and cross-instance notifications.
---
Use webhook-driven SSE for live inbox updates, not periodic list polling.

**Why:** The user explicitly requested automatic SSE updates when a webhook arrives instead of checking every five seconds.

**How to apply:** Notify only after the delivery transaction commits, scope streams to the authenticated account, and refetch on connection/reconnection to catch missed deliveries. Keep notifications cross-instance because a production webhook and browser stream can land on different API instances. Keep heartbeat traffic distinct from polling for records.

Incoming history should load in small pages on scroll; deliberate source-note links may search older pages, but processing jobs alone must not trigger a history search.

**Why:** Automatic job discovery otherwise silently downloads the entire message history, defeating bounded inbox loading. Prioritization should apply to messages already loaded.

**How to apply:** Keep live head catch-up separate from the older-history boundary. A burst of live arrivals may require several pages to reconnect to the loaded head without gaps, but must not move the history cursor or reset the reader's visible message.
