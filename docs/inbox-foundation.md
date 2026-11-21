# Inbox and processing boundaries

## Current flow

1. The Pebble receiver authenticates its webhook and validates JSON or multipart
   audio. `/api/messages` accepts normalized text messages from an authenticated,
   allowed account. Neither route calls a model.
2. `ingestMessage` atomically saves the original message and a durable
   `message.received` outbox record. A database commit is required before success.
   Audio bytes remain in private App Storage; the database stores references.
3. The dispatcher consumes receipts in a separate transaction. Only eligible,
   untouched text messages create a task-extraction job. Failed handoffs retain
   their receipt and a retry deadline; they do not undo the received message.
4. The existing leased worker processes task-extraction version 1. The provider
   and model used for an attempt are recorded on its job. One original can produce
   zero or many tasks. A reminder is still a task with a due date.
5. PostgreSQL notifications wake both workers and update signed-in clients over
   SSE. Startup/reconnect scans catch missed notifications. Timers are for known
   retry/lease deadlines and connection recovery, not periodic inbox polling.

## Contracts and compatibility

- Existing webhook paths, authentication, receipt response, and old event fields
  remain supported. Existing data is not rewritten or automatically reprocessed.
- Message responses add `source`, `text`, and `attachments`; `transcription`,
  `audioUrl`, and other legacy fields remain for installed mobile versions.
- Source identity consists of owner, source type, connection, and external ID.
  An external ID is scoped to that identity, not globally.
- `/api/messages` takes text, sourceType, sourceConnection, optional externalId,
  occurredAt (an ISO instant), and metadata. Ownership comes from the session.
  This is an authenticated API primitive, not a new anonymous ingestion endpoint
  or a newly implemented external connector.
- Pebble deliveries can supply `Idempotency-Key` or `deliveryId`. Without an ID,
  an exact recorded timestamp plus identical audio bytes identifies a recording
  redelivery. Text alone is never a deduplication key. Text-only deliveries without
  a stable ID remain distinct; there is no reliable way to distinguish all retries.
- Same identity/key and content returns the original receipt. Different content
  with an explicit reused key returns 409. Removed originals are not resurrected.
  Duplicate uploaded audio is cleaned up after resolving the original receipt.
- Receipt durability requires a working database and, for uploads, storage.
  “Independent of AI” does not mean accepting a message before it is durably saved.

## Shared clients

`lib/api-client-react` owns the generated API contract and shared domain rules:
task order/filtering, source-to-task grouping, deletion/undo lifecycle,
confirmation preferences, and SSE/mutation cache refresh policy.
Native sheets and web dialogs stay platform-specific. Existing action UIs are
not redesigned by this change. Local form state and UI-specific feedback remain
with their components.

## Extending later

An input adapter should validate/authenticate its source, persist attachments,
and call the ingestion service with server-derived ownership and source identity.
It should not import the task extractor or select an AI model.

A future processor should consume a durable receipt and own its own
versioned/idempotent runs. Do not overload the current one-job-per-message
task-extraction table for several independent processors. Derived outputs must
reference their originals and must not masquerade as new user messages.

No contacts connector, email sender, recursive loop, general workflow engine,
or autonomous external action is introduced here.

## Verification

- `pnpm run typecheck`
- `NODE_ENV=production node artifacts/api-server/tests/organizer.mjs`
  (isolated schema; includes real audio storage round-trip with cleanup)
- `NODE_ENV=production node artifacts/api-server/tests/webhook-revocation.mjs`
- `node artifacts/api-server/tests/inbox-primitives.mjs`
- `node artifacts/api-server/tests/job-wakeups.mjs`

Apply additive Drizzle schema changes before starting the updated API. Do not
delete historical rows or enqueue historical messages as part of rollout.
