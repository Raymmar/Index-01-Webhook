# Index 0.1 - Pebble Ring Webhook

A personal inbox for Pebble Index ring webhook deliveries, with Clerk login and private audio playback.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- The screenshot supplied by the user is a **Webhook · Click** setup that sends JSON with a click count. Pebble's recording-webhook documentation separately describes multipart audio/transcript uploads. Accept both; do not assume click events contain recordings.
- Capture each delivery separately for initial diagnostics rather than deduplicating on timestamps: Pebble's cited docs do not specify event IDs or retry semantics.
- Audio uploads come from Pebble as multipart requests, not from a browser direct-upload flow. Persist them privately in App Storage before acknowledging receipt.
- Browser requests use Clerk session cookies; Pebble requests use independent, revocable bearer tokens stored only as hashes.

## Product

Initial scope: sign in, create a personal webhook, copy setup information, and receive JSON/text/audio into a feed. This is for the creator now, with account-scoped ownership to support other users later.

## User preferences

- Keep the first version minimal: inbox and webhook setup only. Future voice-command routing, prompts, workflows, and integrations are explicitly out of scope.
- Validate actual UI, schema, naming, and implementation before assumptions; distinguish confirmed behavior from future proposals.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
