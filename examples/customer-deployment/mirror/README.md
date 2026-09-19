# Overlay Convex read mirror

Replicates a self-hosted Convex deployment into normalized Postgres tables so
BI tools, warehouses, and data lakes get a supported SQL surface — without
touching the backend's internal `documents`/`indexes` persistence tables.

## How it works

One infinite stream: `POST {CONVEX_URL}/api/v1/data/sync` — the supported
Data Sync endpoint. The mirror posts `{syncId, cursor, selection}` and gets
back a page of `{status, truncates, values, syncId, pagination.nextCursor}`.

1. **Snapshot** — the first responses page through every document
   (`status: "snapshotting"`).
2. **Deltas** — subsequent pages carry inserts, updates, and tombstones
   (`status: "stale"` while draining, `"upToDate"` when caught up — the
   mirror then sleeps `MIRROR_POLL_MS` between polls).
3. **Truncates** — `truncates: [{component, table}]` mark tables whose
   contents were bulk-replaced (e.g. `convex import --replace`, table
   clears). The mirror runs `TRUNCATE` on the mirror table in the same
   transaction — bulk deletes can NOT silently drift the mirror.
4. **Durability** — each page is applied in one transaction together with
   the new opaque `nextCursor` in `mirror._meta`. A crash mid-page replays
   the page safely (upserts/truncates are idempotent); restarts resume from
   the stored cursor with a fresh `syncId`.
5. **Schema** — one Postgres table per Convex table under `MIRROR_SCHEMA`
   (default `mirror`). Component-scoped tables are prefixed
   `<component>_<table>` (e.g. the Stripe component's tables appear as
   `mirror.stripe_*`).

### Mirror table shape

```sql
mirror.<table>(
  id            text PRIMARY KEY,   -- Convex document _id
  creation_time timestamptz,        -- Convex _creationTime
  ts            bigint NOT NULL,    -- DataSync entry timestamp (stale-write guard)
  doc           jsonb NOT NULL,     -- full document fields
  synced_at     timestamptz         -- when the mirror wrote this row
)
```

`doc` keeps the complete document as `jsonb` — extract fields with
`doc->>'fieldName'` or create views/indexes per workload. Tombstones become
`DELETE`s; the `ts <=` guard means out-of-order replays can't resurrect stale
writes. `ts` is a nanosecond-scale i64 — precision is preserved end-to-end
(the mirror quotes 16+-digit integers before parsing).

### Durable state

`mirror._meta` is a key-value table holding `sync_cursor` (the opaque
DataSync cursor). Deleting the schema (or the `sync_cursor` row) and
restarting forces a full resync.

## Configuration

| Env | Required | Default | Meaning |
| --- | --- | --- | --- |
| `CONVEX_URL` / `CONVEX_SELF_HOSTED_URL` | yes | — | Backend client API origin (in-cluster `http://backend:3210`) |
| `CONVEX_ADMIN_KEY` / `CONVEX_SELF_HOSTED_ADMIN_KEY` | yes | — | Deployment admin key (`deployment:data:view` scope) from `bin/convex-bootstrap.sh` |
| `MIRROR_DATABASE_URL` | yes | — | Postgres DSN the mirror writes to |
| `MIRROR_ADMIN_URL` | no | — | Admin DSN used once at startup to `CREATE DATABASE` the target if missing |
| `MIRROR_SCHEMA` | no | `mirror` | Postgres schema for mirror tables |
| `MIRROR_POLL_MS` | no | `2000` | Delta poll interval when caught up |
| `MIRROR_TABLES` | no | — | Comma-separated Convex table allowlist (empty = all) |
| `MIRROR_RETRY_BASE_MS` / `MIRROR_RETRY_MAX_MS` | no | `1000`/`30000` | Error backoff bounds |

## Running

```bash
# Inside the customer-deployment dir, after bootstrap:
docker compose \
  -f docker-compose.convex.yml -f docker-compose.mirror.yml \
  --env-file convex.env --env-file .env.convex.local \
  up -d mirror

docker compose -f docker-compose.convex.yml -f docker-compose.mirror.yml \
  logs -f mirror
```

Point `MIRROR_DATABASE_URL` at managed Postgres (RDS/Aurora/Cloud SQL) for
real deployments — the mirror only needs a database it owns; it does not need
to share the backend's persistence instance.

## Operations

- **Lag**: the mirror polls `MIRROR_POLL_MS` after `upToDate`, so lag is
  bounded by that interval plus write volume. `SELECT max(synced_at) FROM
  mirror.<table>` shows the last applied write; `SELECT v FROM mirror._meta
  WHERE k='sync_cursor'` shows the durable position (opaque cursor).
- **Full resync**: `DROP SCHEMA mirror CASCADE;` then restart the sidecar.
- **Failure mode**: export/API/Postgres errors retry with exponential
  backoff; the cursor never advances past an uncommitted page.
- **Upgrades**: mirror tables are additive-only (`CREATE TABLE IF NOT EXISTS`);
  new Convex tables appear automatically on their first document.

## Local development

```bash
cd examples/customer-deployment/mirror
npm install
npm test          # node:test unit suite (no DB needed)
```
