# Convex-only backend & enterprise self-hosting strategy

Status: recommendation (2026-09-17). Supersedes the dual Convex/Postgres direction flagged in `codebase-complexity-audit.md`. Delete nothing until Phase 1 below is proven.

## Decision

Standardize on Convex as the only backend runtime. Convex Cloud serves the hosted product; the open-source `convex-backend` binary serves enterprise self-hosting (BYOC). The bespoke Postgres repository layer, Drizzle schema/migrations, and the parity harness are deprecated and deleted once the self-hosted path is validated end-to-end.

## Why Convex-only wins

- **Parity by construction.** The self-hosted backend is the same code as Convex Cloud, synced within days. Every feature — realtime sync, transactions, crons, file storage, components, search — works identically for a self-hosted customer. The Postgres adapter could never achieve this; it is a permanent lagging re-implementation.
- **Maintenance surface.** The dual backend is the audit's #1 complexity source: ~37 Postgres repositories, a parallel ~2.3k-line Drizzle schema, 81 migrations, and a parity test harness. Removing it is an estimated 30–40% cut to server maintenance and collapses the config matrix (2 databases × 4 auth providers × 5 secrets providers → the production stack).
- **Velocity.** Every feature ships once. New `@convex-dev/*` components and Convex upgrades arrive free; on dual backends each one would need a Postgres twin.
- **The Postgres-only alternative is strictly worse.** It keeps the easy part (data ops) and forces us to rebuild the hard parts: live-query sync/invalidation, scheduler/crons, file storage, components — plus rewiring the web client's `useQuery` data layer. That is building a database company, not deleting one.
- **Escape hatches.** Open source (FSL Apache 2.0 → full Apache-2.0 after 2 years), `npx convex export` snapshots are portable, and the Data Sync API provides continuous egress. We are never locked in.

## What self-hosted Convex is

Three services: the **backend** (`ghcr.io/get-convex/convex-backend`, a single Rust binary bundling DB engine, V8/Node function runtimes, realtime sync, scheduler, HTTP actions), the **dashboard** (`ghcr.io/get-convex/convex-dashboard`), and our Next.js app hosted normally.

| Port | Purpose |
| --- | --- |
| 3210 | Cloud origin — client API, queries/mutations/WS sync (`NEXT_PUBLIC_CONVEX_URL` target) |
| 3211 | Site origin — Convex HTTP actions |
| 6791 | Dashboard (internal only) |

Storage layers: persistence defaults to SQLite (Docker volume) or external Postgres (tested v17) / MySQL v8 via `POSTGRES_URL`/`MYSQL_URL`; file/blob storage defaults to filesystem or S3-compatible (5 buckets: exports, snapshot-imports, modules, files, search). `S3_ENDPOINT_URL` covers R2 or S3-compatible.

Security model: `INSTANCE_SECRET` is the root secret → admin keys (`instance-name|hex`) minted via `docker compose exec backend ./generate_admin_key.sh`. Deploys use `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` instead of `CONVEX_DEPLOY_KEY`. Auth (`auth.config.ts` JWKS/WorkOS) works unchanged. `INTERNAL_API_SECRET` + `INTERNAL_SERVICE_AUTH_SECRET` must be set on the deployment, matching the app env, and must differ from each other.

## Enterprise topology (AWS reference)

```
ALB api.corp.com        → convex-backend :3210   ECS/EC2 single task (active)
ALB actions.corp.com    → convex-backend :3211   + standby task (passive)
internal ALB            → dashboard      :6791
RDS/Aurora Postgres     ← POSTGRES_URL            same region/AZ as backend
S3                      ← files, modules, search, exports
Next.js app             → their infra or ours
```

Non-negotiable: backend and Postgres in the same region, ideally same AZ — every mutation commit is a DB round trip, so network latency multiplies through transaction latency.

## The scaling story (be honest about the shape)

**Convex is the database; Postgres is its storage engine.** The backend writes opaque revision rows (`documents`, `indexes` tables) and a `leases` row; all query execution, index maintenance, subscription invalidation, and OCC happen in the single Rust process. Consequences:

- **Read replicas don't help** — no per-user-query SQL exists to offload.
- **The DB tier is never the bottleneck** — RDS/Aurora absorbs far more writes than one backend generates. Scale it with instance class, provisioned IOPS, or Aurora (storage autogrow suits the append-heavy write pattern).
- **The backend is single-writer by design.** The `leases` table is the split-brain guard. Global `ts` ordering, OCC validation, and in-memory subscription state all require one owner.

Scaling levers, in order:

1. **Vertical** — bigger instance + `APPLICATION_MAX_CONCURRENT_{QUERIES,MUTATIONS,V8_ACTIONS,NODE_ACTIONS}` (default 16 each) + `*_ACTION_USER_TIMEOUT_SECS`. Full knob list: `crates/common/src/knobs.rs`.
2. **Fast commits** — same-AZ Aurora/RDS; commit latency is the throughput ceiling.
3. **HA = active-passive** — standby container + `/version` healthcheck; promoted standby acquires the lease. Not active-active.
4. **Shard** — N independent backends, each with its own `INSTANCE_NAME` (→ own DB schema); route tenants app-side. The persistence layer has a `multitenant` mode (`instance_name` column on every table) — one Postgres cluster can host many instances. This is literally how Convex Cloud packs deployments.

### "Big brain" — the fleet control plane (build later, only if needed)

Cloud's real advantage over self-hosted is fleet orchestration, not per-deployment scaling (cloud deployments have the same write ceiling). The OSS repo even ships `big_brain_client` — the backend is designed to be driven by an external control plane. Ours would need: provisioning (instance name → schema → secret → admin key → container), routing (per-instance DNS), failover (lease-aware), upgrades, backups, and metering (Prometheus `/metrics`, off by default — `DISABLE_METRICS_ENDPOINT=false`).

Portability is free if written against four interfaces: containers, postgres provisioner, object store, DNS. Every cloud has all four. **Build it only when we host many tenants ourselves** — enterprise BYOC needs a Terraform module + runbook, not a fleet.

**License gate:** FSL forbids "a product designed to compete with hosted Convex Cloud." An orchestrator that runs Overlay's backend on customer infra is fine; selling managed Convex hosting is not — talk to Convex before going near that line.

## Enterprise data integration (lakes, Postgres consistency, CDC)

Enterprises integrate at three surfaces — never at the persistence tables.

1. **Data Sync API** (`list_snapshot` + `document_deltas`, CDC-style with deletes) — public HTTP API present in the self-hosted binary; auth = admin key. Powers the official **Fivetran source connector** (`crates/fivetran_source`) → Snowflake, BigQuery, Postgres, S3/Parquet. Airbyte covers streaming *import*. Air-gapped customers: Airbyte self-hosted or a ~200-line `document_deltas` poller.
2. **Read mirror (the "SQL access" deliverable)** — ship a sidecar service in our self-host compose that consumes deltas and materializes normalized relational tables in *their* Postgres. Near-real-time, BI-queryable, better than the old adapter layer because the schema can be denormalized for analytics.
3. **Live/service integration** — OSS client libraries (JS/Python/Rust) subscribe to queries against any deployment URL → live CDC into their systems in ~100 lines. Our existing webhook system (CRUD, deliveries, redrive) is the outbound event stream.

**Forbidden:** direct SQL on `documents`/`indexes`/`persistence_globals` — opaque `BYTEA` revision format keyed by internal `table_id`s, unstable across upgrades. Forensics only. Put this in the self-host docs.

## Ops lifecycle

- **Upgrades:** pin image tags (never float `latest` in prod); in-place migrations run automatically — watch logs for `Executing Migration n/m … MigrationComplete`; always `npx convex export` first. Fallback: export → swap image → `import --replace-all` (requires downtime; final export after traffic stops).
- **Backups:** RDS snapshots/PITR + scheduled `npx convex export` (portable, doubles as DB-engine migration path).
- **Observability:** opt-in Prometheus `/metrics`; `RUST_LOG`; `REDACT_LOGS_TO_CLIENT=true` to match cloud log hygiene; `DISABLE_BEACON=true` to kill the anonymous usage beacon.
- **Retention:** `DOCUMENT_RETENTION_DELAY` defaults to 2 days self-hosted — bounds `documents` table growth.
- **Data reset:** no reset command by design; `npx convex import --table X --replace --format jsonLines /dev/null -y` per table.
- **Key rotation:** rotating `INSTANCE_SECRET` invalidates all keys/sessions.

## Honest tradeoffs to disclose

- Single-node backend → active-passive HA, not multi-AZ active-active. Availability ~ failover time.
- The backend is a Rust black box to customer ops; debugging escalates to us + Convex `#self-hosted` Discord (no SLA support channel).
- No managed billing/metering/Insights — meter via `/metrics` ourselves if we bill on usage.
- SQL access requires the mirror — the DB is ours-in-theirs, not theirs-to-query.
- If a prospect's actual requirement is relational access to their data, the mirror answers it; if they refuse any non-Postgres runtime, self-hosted Convex loses to nothing we have — that's a product decision, not an engineering one.

## Recommended sequence

1. **Prove it:** ✅ **Done (2026-09-18).** Full `convex/` tree deployed unmodified to the official OSS backend on Postgres+S3; crons fired; file-storage round trip passed; WorkOS/HS256 auth path verified; real AI chat persisted. See the proof table above.
2. **Package it:** ✅ **Done (2026-09-18).** Reference stack in `examples/customer-deployment/` (`docker-compose.convex.yml` + `convex.env.example` + `bin/convex-bootstrap.sh`); operations runbook at `docs/deploy-operate/self-hosted-convex.mdx`. Helm packaging for the backend remains open if a customer needs k8s.
3. **Delete the Postgres path:** repositories → Drizzle schema/migrations → parity harness → DB-selector config → collapse now-single-impl repository interfaces.
4. **Mirror sidecar:** the SQL-access answer; small, high enterprise value.
5. **Big brain:** only if/when we host many tenants; re-read FSL before any managed-hosting shape.

## Open questions

- ~~Confirm the Data Sync API is ungated on the OSS binary~~ **Resolved (2026-09-18 proof):** ungated. The route is `GET /api/data/sync?format=json` — a **WebSocket upgrade** endpoint (not the documented cloud `POST /data/sync`). With `Authorization: Convex <admin-key>` + `Convex-Client: npm-1.41.0` + a valid `Upgrade: websocket`/`Sec-WebSocket-Key` handshake the backend returns `101 Switching Protocols` and streams. No plan/feature gate observed on `convex-backend:latest`.
- Fivetran's connector is hosted SaaS calling the deployment URL — confirm reachability story for locked-down enterprise networks (Airbyte self-hosted fallback). Note the OSS sync endpoint is WebSocket, which may affect connector compatibility — the `fivetran_source` crate in-tree suggests a supported path, but verify against the published connector.
- Any existing Postgres-path consumers besides the hypothetical enterprise install — **partially answered:** activation is opt-in via `OVERLAY_PROVIDER_DATABASE=postgres` + `OVERLAY_DATABASE_URL`; the default is `convex`. Deletion surface is bounded: ~53 Postgres* source files + 37 tests under `src/server/`, 81 migrations in `migrations/app-data/`, ~15 call sites branching on `capabilities.provider === 'postgres'`, plus `parity-matrix`/contracts harness. Nothing outside that tree consumes the Postgres path.

## Phase 1 proof results (2026-09-18, local docker compose)

| Check | Result |
| --- | --- |
| Official `convex-backend` + `convex-dashboard` images pull & start | Pass |
| `GET /version` health on `:3210` | Pass |
| Admin key generation (`generate_admin_key.sh`) | Pass |
| `npx convex deploy` of full `convex/` tree (150+ tables, indexes, `stripe` component) | Pass — compiles & pushes unmodified |
| `npx convex env set INTERNAL_API_SECRET` / `INTERNAL_SERVICE_AUTH_SECRET` | Pass |
| Contract tests vs self-hosted | 33/38 pass — all 5 failures are a strict subset of failures the same suite produces against the **dev cloud** deployment (pre-existing broken assertions, not OSS divergence) |
| Next.js dev boot with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210` | Pass — HTTP 200 |
| Function execution vs local backend (`/api/query`, `/api/mutation`) | Pass — observed 200s in backend logs |
| Data Sync API on OSS | Pass — `GET /api/data/sync` WebSocket, admin-key auth, `101` upgrade confirmed |
| Dashboard on `:6791` | **Fail** — `convex-dashboard:latest` 500s on missing vendored `@radix-ui/react-icons` module (upstream image defect, unrelated to backend; try pinning an older tag) |

### Extended proof (Postgres + S3 + auth + chat, 2026-09-18)

Stack: added `postgres:16-alpine` + an S3-compatible object store  to the compose. `POSTGRES_URL` takes the **cluster URL without a db name** (backend derives the db from the instance name). The object store needs `AWS_S3_FORCE_PATH_STYLE=true`, `AWS_S3_DISABLE_CHECKSUMS=true`, and **`AWS_S3_DISABLE_SSE=true`** — otherwise pushes fail with `NotImplemented: KMS is not configured`.

| Check | Result |
| --- | --- |
| Postgres persistence | Pass — lease acquired, internal schema (`documents`/`indexes`/`leases`/`persistence_globals`/`read_only`) created, 3,313→5,482 docs after traffic |
| S3 object storage (S3-compatible) | Pass — module source packages uploaded on deploy; `ctx.storage.generateUploadUrl` → POST → object in `convex-files` → `getUrl` serves bytes back |
| Crons/scheduler | Pass — 18 cron jobs registered; `agents/settlementReconciliation:runReconciliationTick` observed firing on schedule |
| Browser→Convex auth (HS256 `INTERNAL_API_SECRET` token) | Pass — valid token creates/lists conversations; garbage token and wrong-user both rejected `Unauthorized` |
| WorkOS env on deployment | Pass — `DEV_WORKOS_CLIENT_ID`/`DEV_WORKOS_API_KEY` set; JWKS/API egress to `api.workos.com` confirmed; app generates valid AuthKit URLs and gets real API responses (`sso_required` on password attempt) |
| v1 API key auth | Pass — `ovl_sk_…` key created via `auth/apiKeys:createByServer`, accepted as `Authorization: Bearer` on `/api/v1/conversations/act` |
| Real chat turn (`POST /api/v1/conversations/act`, model `inclusionai/ling-3.0-flash-fin-free` via Vercel AI Gateway) | Pass — streamed `PROOF_OK`, messages/runs persisted to Postgres |

Notes for the runbook: a fresh deployment has **no roles/entitlements** — `models.use` is denied until a subscription + the `system:member` role (with `isSystem: true`) exist, i.e. normal signup/onboarding is required; `OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED=1` is required for the AI Gateway; `OVERLAY_BFF_URL` should be set on the deployment for crons that call back into the app. Interactive WorkOS sign-in (AuthKit redirect) was not driven end-to-end — it needs a registered redirect URI and interactive credentials, but every Convex-dependent part of auth is proven.
