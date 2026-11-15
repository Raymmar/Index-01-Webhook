# Ring understanding layer

The original webhook is the only note. The understanding layer creates linked
tasks and reminders, never another note and never external side effects.

## Provider configuration

- Default: Replit-managed OpenAI, configured through Replit AI Integrations.
- Direct: set `OPENAI_API_KEY` in server secrets (or the deployment's secure
  environment configuration outside Replit), then select OpenAI direct in Settings.
- The owner chooses provider/model for this installation. Keys never travel to
  the frontend. There is no automatic fallback from direct to managed billing.
- Both modes default to `gpt-5-mini`; models must support structured JSON output.
- The provider interface lives in `lib/understanding.ts`. Add another adapter
  there without changing note ingestion or action-item APIs.

## Ownership and time

The first authenticated account reaching the app atomically claims its singleton
owner record. No separate owner onboarding. Additional accounts are denied by
default; the owner can enable them in Settings. Turning the toggle off denies
other accounts' APIs and incoming webhooks without deleting their existing data.
Every note and item remains scoped to its own account.

The browser detects an IANA timezone once, saves it per account, and Settings
permits overrides. Extraction anchors relative dates to recordedAt (receivedAt
only when absent). Resolved dates are stored as timestamptz/UTC. Ambiguous or
nonexistent local times require review. Changes to the display timezone do not
reschedule saved instants.

## Durable processing

Webhook delivery commits its note and pending job together before returning.
The server worker checks PostgreSQL for queued jobs; this is not browser inbox
polling. SSE refreshes the frontend when data changes.

Workers claim rows with SKIP LOCKED and a five-minute lease. Three attempts with
backoff are allowed; failures are visible and manually retryable. An expired
lease can be recovered after a restart. Lease fencing plus atomic item insertion
and job completion prevents duplicate items from concurrent/retried processing.
Completed jobs are not re-extracted, so user edits/deletions are respected.
Historical notes are organized only when requested.

The worker runs with the API process. An inactive/stopped deployment cannot run
jobs; durable pending work resumes when an API instance starts. This is not a
reminder-delivery scheduler. A future workflow worker may consume action items
without changing this ingestion/understanding boundary.

## Regression checks

Run from workspace root:

```
NODE_ENV=production node artifacts/api-server/tests/organizer.mjs
```

This creates a temporary PostgreSQL schema, tests API ownership/CRUD, worker
concurrency, timestamp handling and one managed AI extraction, then removes the
schema. It uses a synthetic transcript and incurs a small model request. Real
Clerk sign-in is separately verified by the browser test; test identities are
stubbed only inside this isolated route harness, never in application code.
