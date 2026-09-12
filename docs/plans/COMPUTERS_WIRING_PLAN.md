# Computers web wiring plan

Status: ready to implement. Companion to [`COMPUTERS_PLAN.md`](./COMPUTERS_PLAN.md)
(design, access model, provider rationale). This document is the file-by-file
implementation sequence for wiring the landed Phase 0 logic layer
(`BoxSandboxRuntime` + `ComputerService`, commits `2aa0b7345` / `839353df4`)
into the web app. It expands the plan doc's "Phase 1: Foundation" and the
start of "Phase 2: Agent binding" into six phases.

Every claim below was re-verified against the repo on 2026-09-11. Corrections
baked in from auditing the first draft:

1. Routes are **Next.js App Router BFF**, not Hono: a shell in
   `src/app/api/v1/**` calls `handleBffRoute(request, context, domainService.X)`
   which authenticates, rate-limits, resolves workspace context, and delegates
   to a domain handler in `src/server/app-api/v1/**` receiving
   `AppApiRouteContext`.
2. There is **no central server-env module**: services read `process.env`
   directly (precedent: `managedSandboxRuntimeFromEnv` in
   `src/server/agents/ManagedAgentSandboxService.ts:134`).
3. Settings sections register in
   `packages/overlay-app-core/src/app-shell.ts` and render from
   `src/app/app/settings/page.tsx`; components live in
   `src/features/settings/components/`.

## Verified conventions this plan follows

| Concern | Pattern | Reference |
| --- | --- | --- |
| Route shell | `handleBffRoute(request, context, domainService.GET as BffDomainService)`; 4th arg `{ sensitiveResponse: true }` skips idempotency-body persistence for secrets | `src/app/api/v1/agent-environments/route.ts`, `src/app/api/v1/_utils/bff.ts` |
| Domain handler | `(request: Request, context: AppApiRouteContext)`; auth via `context.auth.userId`, workspace via `context.workspace.workspace.id`, member role via `context.workspace.membership.role`, body via `context.parsedJson`, params via `await context.params` | `src/server/app-api/v1/agent-environments/route.ts`, `src/server/app-api/bff-context.ts` |
| Repository trio | `XRepository.ts` interface + `PostgresXRepository` + `ConvexXRepository` per domain under `src/server/<domain>/` | `src/server/projects/` |
| Repo registration | `AppDataRepositories` interface + both branches of `createAppDataContext` | `src/server/app-data/repositories.ts` |
| Contract suite | `AppDataRepositoryContractBackend` + `runAppDataRepositoryContractSuite`; run by `postgres-contract.test.ts` / `convex-contract.test.ts` | `src/server/app-data/contracts/` |
| Postgres table | `migrations/app-data/NNNN_x.sql` (`--> statement-breakpoint` separators) + `pgTable` in `src/server/database/postgres/schema.ts` | `migrations/app-data/0070_byok_provider_connections.sql`, `0074_agent_avatar_shape.sql` |
| Convex table+handlers | `defineTable` in `convex/schema.ts`; handlers in `convex/<domain>/<domain>.ts` reached as `'<domain>/<domain>:<fn>'`; server-secret gate via `validateServerSecret`; no `index.ts` barrels | `convex/projects/projects.ts`, `convex/lib/auth.ts` |
| Convex repo calls | `lazyConvex` + `getInternalApiSecret()` + `serverSecret` arg | `src/server/projects/ConvexProjectRepository.ts` |
| Route capability gate | `getRequiredCapabilityForRoute` prefix map; labels in `CAPABILITY_LABELS`; flag in `CapabilityCheck` | `src/server/capabilities-core.ts`, `packages/overlay-app-core/src/capabilities.ts` |
| Capability derivation | feature flag from `OverlayFeatureFlagsSchema` + `defaultOverlayRuntimeConfig.ts`; computed in `withObservabilityProviderCapabilities` | `src/server/capabilities.ts:69` (`connectedAgents` precedent) |
| Postgres route support | `POSTGRES_APP_DATA_ROUTE_SUPPORT_RULES`; every rule id must be owned by `ON_PREM_PARITY_MATRIX[].routeRuleIds` (enforced by `parity-matrix.test.ts`) | `src/server/app-data/route-support.ts`, `parity-matrix.ts` |
| API client | `<domain>/client.ts` class over `HttpContext`; `x-overlay-workspace-id` header via `workspaceInit`; export in `index.ts`; instantiate in `create-overlay-app-client.ts` | `packages/overlay-api-client/src/agent-environments/client.ts` |
| Service registration | field on `OverlayServerContext` + construct + return in `createOverlayServerContext`; handlers reach it via `getOverlayServerContext()` | `src/server/bootstrap.ts:131-162, 298, 469` |
| Per-backend tests | Postgres: `tsx --test` gated on `OVERLAY_DATABASE_URL`; Convex: gated on `*_CONVEX=1` + Convex URL + `INTERNAL_API_SECRET` | `src/server/agents/{postgres,convex}-workspace-agents.test.ts` |

Open decision points are marked **[decide]** with a recommended default.

---

## Phase 1 — `computers` entity + storage parity

**Status: done.** Verified live on both backends: the Postgres contract suite
ran against the remote Neon `overlay_app_data_staging` DB (22/22, incl. the
computers block + all four `computers_*` constraints), and the Convex contract
suite ran against a real local Convex deployment
(`npx convex dev --dev-deployment local`, isolated — 15/15, incl. the computers
block over the wire through `ConvexComputerRepository` → `lazyConvex` →
handlers). Local-deploy note: `convex dev` generates `convex/tsconfig.json`
without `paths` — the `@/shared/*` imports then fail to bundle; add the root
tsconfig `paths` block (scoped to `convex/`, `../src/*`) to push locally.
Types live in `packages/overlay-workspace-contracts/src/computers.ts`;
`ComputerRepository` is extracted to `src/server/computers/ComputerRepository.ts`;
Postgres (migration `0075_computers` + `PostgresComputerRepository`) and Convex
(`convex/computers/computers.ts` + `ConvexComputerRepository`) both implement it
and are registered in `AppDataRepositories`. The shared contract suite's
`computers` block passes on the remote Neon DB (22/22) and handlers verify under
`convex-test`; route rule + `computers` parity domain (P7) are wired. One
pre-existing bug fixed en route: migration `0072` re-added
`projects.archived_at` unguarded even though `0022` already adds it with
`IF NOT EXISTS` — it now carries the guard so journal replay converges on
drifted DBs. Remaining caveat: the live dev Convex deployment tracks
`origin/staging`, so `convex:push:dev` (and the live Convex contract run) must
happen from the staging worktree once this lands there.

Goal: the `computers` row persists identically on Postgres and Convex, behind
one `ComputerRepository` port, registered in the app-data context and covered
by the shared contract suite.

### 1.1 Contract types — move to a package **[decide]**

`ComputerService.ts` currently defines `Computer`, `ComputerSize`,
`ComputerStatus`, `ComputerOwnerType` locally. The Phase 2 API client cannot
import `@/server` or `@/shared` (package→src ban), so the entity types need a
package home.

Recommended: new `packages/overlay-workspace-contracts/src/computers.ts`
(`Computer`, `ComputerSize`, `ComputerStatus`, `ComputerOwnerType`), re-exported
from that package's `index.ts`. `ComputerService` imports them from
`@overlay/workspace-contracts` and drops its local definitions. The package
stays dependency-free — types and literals only.

### 1.2 Repository port

Extract the `ComputerRepository` interface from `ComputerService.ts` into
`src/server/computers/ComputerRepository.ts` (project convention: interface
file per domain). Surface stays as defined: `create`, `get`, `findByOwner`,
`listByWorkspace`, `update`, `delete`. Add `import 'server-only'`.

`ComputerService` then imports `ComputerRepository` + the entity types — no
behavior change; its 10 unit tests keep passing unchanged.

### 1.3 Postgres

- `migrations/app-data/0075_computers.sql` (next free number; latest is
  `0074`):

```sql
CREATE TABLE "computers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"size" text NOT NULL,
	"status" text NOT NULL,
	"name" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "computers" ADD CONSTRAINT "computers_created_by_users_id_fk"
	FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "computers" ADD CONSTRAINT "computers_owner_type_check"
	CHECK ("owner_type" IN ('agent', 'user'));
--> statement-breakpoint
ALTER TABLE "computers" ADD CONSTRAINT "computers_size_check"
	CHECK ("size" IN ('small', 'default', 'large'));
--> statement-breakpoint
ALTER TABLE "computers" ADD CONSTRAINT "computers_status_check"
	CHECK ("status" IN ('provisioning', 'ready', 'stopped', 'error'));
--> statement-breakpoint
CREATE UNIQUE INDEX "computers_workspace_owner_idx"
	ON "computers" ("workspace_id", "owner_type", "owner_id");
--> statement-breakpoint
CREATE INDEX "computers_workspace_id_idx" ON "computers" ("workspace_id");
```

  Notes: `workspace_id` gets no FK (projects precedent — workspace ids span
  providers); `owner_id` gets no FK (polymorphic: `users.id` or
  `workspace_agent_definitions.id`); the unique index enforces the
  owner-keyed binding invariant from COMPUTERS_PLAN.md at the storage layer.

- `src/server/database/postgres/schema.ts`: add `computers` `pgTable`
  mirroring the migration (`uniqueIndex` + `check` are already imported and
  used by `projects`/`0074`).
- `src/server/computers/PostgresComputerRepository.ts`: drizzle CRUD;
  `create` relies on the unique index surfacing a conflict — catch the
  unique-violation and return the existing row (extra safety under the
  service's idempotent provision); `update` sets `updated_at` server-side.
- `src/server/computers/postgres-computers.test.ts`: `tsx --test` file gated
  on `OVERLAY_DATABASE_URL` (workspace-agents precedent). Asserts CRUD +
  duplicate-owner rejection. Also add the new constraint names to the
  expected-constraints list in
  `src/server/app-data/contracts/postgres-contract.test.ts` (it enumerates
  FK/check names — see the `projects_parent_*` entries at ~line 62).

### 1.4 Convex

- `convex/schema.ts`:

```ts
computers: defineTable({
  id: v.string(),                       // caller-generated; _id stays internal
  workspaceId: v.string(),
  ownerType: v.union(v.literal('agent'), v.literal('user')),
  ownerId: v.string(),
  provider: v.string(),
  providerRef: v.optional(v.string()),
  size: v.union(v.literal('small'), v.literal('default'), v.literal('large')),
  status: v.union(
    v.literal('provisioning'), v.literal('ready'),
    v.literal('stopped'), v.literal('error'),
  ),
  name: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastActiveAt: v.optional(v.number()),
})
  .index('by_id', ['id'])
  .index('by_workspaceId', ['workspaceId'])
  .index('by_workspaceId_owner', ['workspaceId', 'ownerType', 'ownerId']),
```

  **`[decide]`** — Convex `_id` can't be caller-set, and
  `repository.create(row)` already receives a generated `id`, so store it as a
  field + `by_id` index (keeps the port backend-neutral). Alternative:
  overload `create` to return the Convex `_id` — rejected, it leaks provider
  id-shape into the entity.

- `convex/computers/computers.ts`: `create`, `get`, `findByOwner`,
  `listByWorkspace`, `update`, `remove`. All take `serverSecret` and call
  `validateServerSecret` — only the BFF repository reaches them (no
  accessToken path needed; the service is the authz layer). `create` checks
  `by_workspaceId_owner` first and returns the existing doc on hit —
  mutations are transactional, so check-then-insert is atomic. `null` ↔
  `undefined` mapping at the boundary (`providerRef`, `name`, `lastActiveAt`),
  same as projects' `normalizeOptional`.
- `src/server/computers/ConvexComputerRepository.ts`: `lazyConvex` +
  `getInternalApiSecret()`; calls `'computers/computers:<fn>'` (typed
  `api.computers.computers` / `internal` paths regenerate after
  `convex dev`/`push` — string paths work immediately).
- `src/server/computers/convex-computers.test.ts`: gated on
  `COMPUTERS_CONTRACT_CONVEX=1` + Convex URL + `INTERNAL_API_SECRET`
  (workspace-agents precedent).

### 1.5 Registry + contract suite

- `src/server/app-data/repositories.ts`: add `computers: ComputerRepository`
  to `AppDataRepositories`; `new PostgresComputerRepository(db)` in the
  Postgres branch; `new ConvexComputerRepository()` in the Convex branch.
- `src/server/app-data/contracts/app-data-repository-contract.ts`: add
  `computers: ComputerRepository` to `AppDataRepositoryContractBackend`; add a
  computers block to `runAppDataRepositoryContractSuite` (create → get →
  findByOwner → duplicate-owner idempotency → update → list scoping →
  delete). Both `postgres-contract.test.ts` and `convex-contract.test.ts`
  then exercise it — this is the real parity check, wire it before the
  per-backend test files.
- `src/server/app-data/route-support.ts` + `parity-matrix.ts`: add a
  `computers` rule — `methods: '*'`, `prefixes: ['/api/v1/computers']`,
  `status: 'supported'` (both backends ship in this phase) — and a new
  `ON_PREM_PARITY_MATRIX` domain (e.g. `id: 'computers'`, `capabilities: []`,
  `routeRuleIds: ['computers']`). The parity-matrix test fails if the rule id
  is unowned. No new `AppDataCapabilities` key is needed — the repo exists on
  both providers, so there is no parity gap to model.

### 1.6 `ComputerService` dependencies

- `agentOwner` resolver: `workspaceAgentRepository.get({ agentId, workspaceId })`
  already exists and returns `WorkspaceAgentDirectoryItem` with `visibility`.
  Map to `{ visibility, createdBy }`. **[verify during impl]** that
  `createdBy` is on the directory item; if not, extend the workspace-agent
  repository's get projection rather than adding a second lookup.
- `limits` **[decide]**: v1 ships a static
  `{ maxPerWorkspace: 25, maxPersonalPerUser: 1, allowedSizes: ['small','default','large'] }`.
  Entitlement-derived quotas belong to the plan doc's Phase 3 (quota +
  metering) — do not wire `chatUsagePolicy` here yet.

### Verify

- `npx tsc --noEmit`
- `npx eslint src/server/computers src/server/app-data convex/computers`
- `npm run app-db:up && npm run app-db:migrate` then
  `NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs tsx --test src/server/computers/postgres-computers.test.ts src/server/computers/ComputerService.test.ts`
- `npm run test:app-data-contracts:postgres` (full suite incl. new computers block)
- `npm run check:on-prem-parity` (parity-matrix + route-support ownership)
- `npm run convex:push:dev` **only from the dedicated staging worktree** — the
  schema change must reach the shared dev deployment before the Convex
  contract test runs locally (per `docs/develop/convex-workflow.mdx`).

Exit: both backends pass the contract-suite computers block; unique owner
binding holds on both; `repositories.computers` resolves in both branches.

---

## Phase 2 — API surface

**Status: done.** All seven routes exist (shells + domain handlers),
`computerService` is on `OverlayServerContext` with the `agentOwner` resolver
backed by `workspaceAgentRepository.get` and static v1 limits (25/workspace,
1/user, all sizes). `CapabilityCheck.computers` + label + route mapping landed
here (pulled forward from Phase 3 — `CAPABILITY_LABELS` is exhaustive, so the
label cannot compile without the union member); default `false` means every
route answers `capability_disabled` until Phase 3's feature-flag + `BOX_API_KEY`
derivation. `runtimeFor` is a stub returning `undefined`, so provision fails
closed as `provider_unavailable` (503) — correct per this phase's goal. Two
deviations from the draft: the actor snippet now carries `principalId`
(`context.workspace.principal.id`), required by the creator-only agent access
check; and `ComputerDesktopTicket` is redeclared in the api-client because the
package does not depend on `@overlay/sandbox-runtime`. API-key scope for
computer routes falls through to `admin` — revisit if scoped keys should reach
computers. `OWNER_FUNDED_OPERATIONS` intentionally untouched until metering.

Goal: authenticated, capability-gated `/api/v1/computers` routes plus the
typed client. Ships returning `provider_unavailable` (503) until Phase 3 lands
— that is the correct behavior.

### 2.1 Routes

| Method + path | Behavior | Service call |
| --- | --- | --- |
| `GET /api/v1/computers` | List caller-visible workspace computers | `listForWorkspace` |
| `POST /api/v1/computers` | Provision (idempotent per owner) | `provision` |
| `GET /api/v1/computers/:computerId` | One computer | `getForActor` (new, §2.4) |
| `DELETE /api/v1/computers/:computerId` | Destroy machine + row | `destroy` |
| `POST /api/v1/computers/:computerId/desktop` | Issue stream ticket | `openDesktop` |
| `POST /api/v1/computers/:computerId/stop` | Stop | `stop` |
| `POST /api/v1/computers/:computerId/start` | Resume | `start` |

### 2.2 Shells — `src/app/api/v1/computers/`

- `route.ts` — `GET`, `POST`
- `[computerId]/route.ts` — `GET`, `DELETE`
- `[computerId]/desktop/route.ts` — `POST` with
  `handleBffRoute(request, context, domainService.POST as BffDomainService, { sensitiveResponse: true })`
  — the ticket URL is a bearer secret and must not be persisted in the
  idempotency store.
- `[computerId]/stop/route.ts`, `[computerId]/start/route.ts` — `POST`

Each shell mirrors `agent-environments/route.ts`: import `handleBffRoute` +
`BffDomainService`/`BffRouteContext` from `../_utils/bff` (adjust depth for
nested paths), `import * as domainService from '@/server/app-api/v1/computers/...'`.

### 2.3 Domain handlers — `src/server/app-api/v1/computers/`

- `shared.ts` — `computerErrorResponse(error)`: `ComputerServiceError` →
  `NextResponse.json({ error: message, code }, { status: error.status })`,
  else 500 (precedent: `agentEnvironmentErrorResponse`). All list/get
  responses `Cache-Control: no-store`.
- `route.ts` — `GET`: `listForWorkspace({ actor, workspaceId })` →
  `{ computers }`. `POST`: read `ownerType`, `ownerId`, `size`, `name` from
  `context.parsedJson`; `provision(...)` → `201 { computer }`.
- `[computerId]/route.ts` — `GET`: `getForActor` → `{ computer }`.
  `DELETE`: `destroy` → `204`.
- `[computerId]/desktop/route.ts` — `POST`: `openDesktop({ actor, computerId, mode })`
  → `{ url, mode, expiresAt }`, `no-store`. Never log the URL.
- `[computerId]/stop/route.ts`, `[computerId]/start/route.ts` — `POST` →
  `{ computer }`.

`actor` construction in every handler:

```ts
const actor = {
  userId: context.auth.userId,
  principalId: context.workspace.principal.id,
  workspaceRole: context.workspace.membership.role === 'owner' ? 'owner' as const : 'member' as const,
}
```

(`principalId` is required — the creator-only agent access check compares it
against the agent's `createdByPrincipalId`.)

(membership roles include `guest` — anything non-owner maps to `member`.)

### 2.4 Service addition — `getForActor`

`accessibleInstance` reconnects to the provider — too heavy for a read. Add:

```ts
async getForActor(args: { actor: ComputerActor; computerId: string }): Promise<Computer>
```

row fetch + `canAccess` check only (no `runtimeFor`, no reconnect). Cover the
404/403 paths in `ComputerService.test.ts`.

### 2.5 Bootstrap

`src/server/bootstrap.ts`: add `computerService: ComputerService` to
`OverlayServerContext`; construct after `workspaceAgentRepository` exists:

```ts
const computerService = new ComputerService({
  repository: appData.repositories.computers,
  runtimeFor: computerRuntimeForProvider,   // Phase 3; returns undefined until then
  agentOwner: async (workspaceId, agentId) => { /* §1.6 */ },
  limits: /* §1.6 static v1 */,
})
```

and add `computerService` to the returned context object.

### 2.6 BFF policy tables

- `src/server/capabilities-core.ts`: add
  `if (startsWithRoute(normalizedPath, '/api/v1/computers')) return 'computers'`
  and `computers: 'Computers'` in `CAPABILITY_LABELS`.
- `src/server/app-data/route-support.ts`: the `computers` rule from §1.5.
- Rate limits: no entry needed — default authenticated limits apply
  (`rate-limit-specs.ts` has no per-route entries for comparable domains).
- `src/server/billing/owner-funded-operations.ts` **[decide]**: provisioning
  creates a billable machine, so `POST /api/v1/computers` belongs in
  `OWNER_FUNDED_OPERATIONS` once machine-time metering lands (plan doc Phase
  3). Deferring is safe — `provision` is idempotent per owner, so a missing
  Idempotency-Key can't double-bill. Note it in the PR description.

### 2.7 API client

- `packages/overlay-api-client/src/computers/client.ts` — `ComputersClient`
  over `HttpContext`, `workspaceInit` header pattern:
  `list(workspaceId)`, `provision(workspaceId, { ownerType, ownerId, size?, name? })`,
  `get(workspaceId, computerId)`, `openDesktop(workspaceId, computerId, mode?)`,
  `stop(workspaceId, computerId)`, `start(workspaceId, computerId)`,
  `destroy(workspaceId, computerId)`. Entity types from
  `@overlay/workspace-contracts` (§1.1); `DesktopStreamTicket` from
  `@overlay/sandbox-runtime` if that package is already a client dep —
  otherwise redeclare the three-field ticket shape locally **[verify dep]**.
- `packages/overlay-api-client/src/index.ts`: export the client + types.
- `packages/overlay-api-client/src/create-overlay-app-client.ts`:
  `computers: new ComputersClient(http)` next to `agentEnvironments`.

### 2.8 Docs (same commit — required by AGENTS.md)

- `docs/develop/api-route-catalog.mdx`: add the seven route entries in the
  established `METHOD path — behavior. Files: ...` format.
- `docs/plans/COMPUTERS_PLAN.md`: mark Phase 1 items as they land.
- `CHANGELOG.md`: user-visible entry when Phase 4 makes it reachable.

### Verify

- `npx tsc --noEmit` + targeted `npx eslint` on touched dirs
- `node --test`/`tsx --test` on `ComputerService.test.ts` (incl. new
  `getForActor` cases)
- `curl` smoke against `npm run dev`: unauthenticated → 401; capability off →
  403 `capability_disabled`; on + no `BOX_API_KEY` → 503
  `provider_unavailable` on provision (proves the full gate chain before any
  real machine exists).

Exit: all seven routes authenticate, workspace-scope, capability-gate, and
map `ComputerServiceError` statuses; `overlayAppClient.computers` compiles.

---

## Phase 3 — provider registry + `computers` capability

**Status: done.** `src/server/computers/computer-runtimes.ts` ships
`computerProviderFromEnv` (`OVERLAY_COMPUTER_PROVIDER`, default `box`),
`computerRuntimeFromEnv`, and a cached `createComputerRuntimeResolver` — the
`computerRuntimeForProvider` singleton is wired as `runtimeFor` in bootstrap.
The capability is `features.computers === true && resolver resolves` (the
registry check replaces the draft's raw `BOX_API_KEY` test — same gate for
`box`, correct for future providers). `computers` added to
`OverlayFeatureFlagsSchema` (strict — required for the flag to survive
parsing), `defaultOverlayRuntimeConfig` (`false`), `env-overrides`
(`OVERLAY_FEATURE_COMPUTERS`), and `.env.example`. `capabilities.test.ts`
needed no change — partial `capabilities` inputs and the `DEFAULT` spread
already cover the new key. Pre-existing package-level `tsc` failures in
`overlay-app-core/src/automations.test.ts` are unrelated (reproduced with
changes stashed).

Goal: `runtimeFor('box')` resolves a real `BoxSandboxRuntime` when configured;
deployments without box credentials report the capability absent.

- `src/server/computers/computer-runtimes.ts`:

```ts
export function computerRuntimeFromEnv(providerOverride?: string): SandboxRuntime | undefined {
  const provider = providerOverride?.trim().toLowerCase()
    ?? process.env.OVERLAY_COMPUTER_PROVIDER?.trim().toLowerCase()
    ?? 'box'
  if (provider === 'box') {
    const apiKey = process.env.BOX_API_KEY?.trim()
    return apiKey ? new BoxSandboxRuntime({ apiKey }) : undefined
  }
  return undefined
}
```

  plus a cached `computerRuntimeForProvider(provider)` map so bootstrap's
  `runtimeFor` closure is stable across calls. **`[decide]`** env name —
  COMPUTERS_PLAN.md wrote `COMPUTER_PROVIDER`; use `OVERLAY_COMPUTER_PROVIDER`
  for consistency (`OVERLAY_MANAGED_SANDBOX_PROVIDER`, `OVERLAY_*` prefix
  convention) and fix the plan doc.
- Capability plumbing:
  - `packages/overlay-app-core/src/capabilities.ts`: `computers: boolean` on
    `CapabilityCheck`; `DEFAULT_OVERLAY_CAPABILITIES.computers = false`.
  - `src/shared/config/overlayConfigSchema.ts`: `computers: z.boolean().optional()`
    on `OverlayFeatureFlagsSchema`; `defaultOverlayRuntimeConfig.ts` default
    `false`; set `true` in the hosted runtime config.
  - `src/server/capabilities.ts` (`withObservabilityProviderCapabilities` or a
    sibling derive step):
    `computers: runtimeConfig.features?.computers === true && Boolean(process.env.BOX_API_KEY?.trim())`.
    Flag = hosted rollout control; key = self-host absence. Both required.
  - Check `deriveOverlayCapabilities`/app-config paths that enumerate
    capability keys — `packages/overlay-app-core/src/capabilities.test.ts`
    asserts section visibility per capability and will need the new key.
- `.env.example`: in the sandbox block (~line 138-165, after
  `DAYTONA_*`/`OVERLAY_MANAGED_SANDBOX_*`) add `BOX_API_KEY` and
  `OVERLAY_COMPUTER_PROVIDER=box` with a comment: the key needs an
  admin-scope preset (`box.create/resume/fork/delete`); the `full-box`
  preset lacks them (learned in Phase 0 live testing).
- `docs/develop/convex-workflow.mdx`/`COMPUTERS_PLAN.md`: env var note.

Exit: with flag on + key set, `GET /api/v1/capabilities` reports
`computers: true` and `provision` reaches box; without the key, capability is
absent and every route 403s — the self-host story from the plan doc.

---

## Phase 4 — Settings → Computers UI

**Status: done.** `computers` settings section + panel registered in
`DEFAULT_OVERLAY_SETTINGS_SECTIONS`/`PANELS` (order 66, between Environments
and Contact, `requiredCapabilities: ['computers']` — no `featureFlagId`, the
capability already encodes flag+key). `ComputerSettings.tsx` lists
caller-visible computers with owner labels (agent names resolved via
`agents.list`), status chips, size, relative last-active; actions: Open
(ticket → `window.open` top-level), Stop/Start, Delete (confirm notes disk
loss), New computer (personal provision, hidden once one exists). Polls at
3s while any row is `provisioning`, else 15s. Wired into
`IMPLEMENTED_SECTION_IDS` + the settings page render. Capability-gating test
added to `capabilities.test.ts`. Visual check: nav entry + breadcrumb render
confirmed; authenticated panel content pending a signed-in browser pass.

Goal: members can see and manage workspace computers.

- `packages/overlay-app-core/src/app-shell.ts`:
  - `DEFAULT_OVERLAY_SETTINGS_SECTIONS`: `{ id: 'computers', label: 'Computers', requiredCapabilities: ['computers'] }` (before `contact`).
  - `DEFAULT_OVERLAY_SETTINGS_PANELS`: `{ id: 'computers', sectionId: 'computers', label: 'Computers', componentKey: 'overlay.settings.computers', requiredCapabilities: ['computers'], order: 66 }` (Environments is 65, Contact 70).
  - Update `app-shell.test.ts` / `capabilities.test.ts` assertions.
- `src/features/settings/components/ComputerSettings.tsx` — follow
  `AgentEnvironmentSettings.tsx` conventions: `useWorkspace()` for
  `activeWorkspaceId`, `useAuth()` for the current user id, poll only while a
  row is `provisioning` (3s, else 15s — same cadence), theme via
  `var(--surface-*)`/`--border`/`--muted`, Lucide icons (`Laptop`/`Monitor`),
  no emoji. Rows: name/owner label, status chip, size, relative
  `lastActiveAt`. Actions: **Open** (`computers.openDesktop` →
  `window.open(ticket.url)` — v1 opens top-level per the plan doc's Moonlight
  iframe question), **Stop/Start**, **Delete** (`window.confirm`, matching
  the agent-archive precedent). Header action: **New computer** →
  `provision({ ownerType: 'user', ownerId: currentUserId })`. Empty state
  copy follows the existing settings voice.
- `src/app/app/settings/page.tsx`: add `'computers'` to
  `IMPLEMENTED_SECTION_IDS` + `{section === 'computers' && <ComputerSettings />}`.

Design bar (from AGENTS.md, non-negotiable): simplest possible structure,
existing settings primitives (`SettingsGroup`, `SettingRow`,
`SettingsActionRow` from `@overlay/modules-react/settings`), dark-mode =
dark gray surfaces + light text, Lucide only, and **visual verification in a
browser before calling it done**.

Exit: `/app/settings?section=computers` lists, opens (new tab), stops/starts,
deletes; section hidden when `capabilities.computers` is false.

---

## Phase 5 — Agent editor → Computer section

**Status: done.** `AgentComputerSection` lives in `AgentEditorForm.tsx` beside
`AccessSelector`; `AgentEditorPage.tsx` renders it between `AccessSelector` and
`DangerZone` only when `agentType === 'overlay'` and `capabilities.computers`.
Edit mode loads the existing binding via `computers.list` filtered to
`ownerType: 'agent', ownerId: agent.id`. Create flow provisions after
`agents.create` with the BYO post-create partial-failure pattern (agent durable,
lands on the edit page, computer retryable). Edit flow: enable → `provision`,
disable → `destroy` behind `window.confirm` with disk-destruction copy, plus an
inline "saving deletes" hint while the toggle is off. Open desktop allowed for
`ready` and `stopped` (the service resumes stopped machines), matching the
Settings surface. Known edge: switching an Overlay agent with a computer to BYO
keeps the computer (orphaned binding stays manageable under Settings →
Computers); revisit if that proves confusing.

Goal: an Overlay agent can own a computer, managed from its editor.

- `src/features/agents/components/AgentEditorPage.tsx`: render
  `<AgentComputerSection />` between `AccessSelector` and `DangerZone`, only
  when `agentType === 'overlay'` **and** `capabilities.computers`
  (`useOverlayCapabilities()`). New state: `computerEnabled`, `computerSize`,
  and in edit mode the existing computer row (`computers.list` filtered to
  `ownerType: 'agent', ownerId: agent.id`).
- New `AgentComputerSection` (in `AgentEditorForm.tsx` beside
  `AccessSelector`, or its own file if it grows past ~100 lines): enable
  toggle, `ListboxSelect` size picker (locked once provisioned — resize needs
  rebuild, out of scope for v1), and **Open desktop** when status is `ready`.
- New-agent flow: provisioning needs `agent.id`, so it runs **after**
  `agents.create` — exactly like the BYO `upsertBinding` post-create call at
  `AgentEditorPage.tsx:213-225`, including the same partial-failure handling
  (agent durable, computer retryable).
- Edit flow: enable → `provision`; disable → `destroy` behind
  `window.confirm` (disk state is destroyed — say so in the copy).

Exit: create an Overlay agent with a computer → row appears in Settings →
Computers; open-desktop issues a ticket; disable destroys it.

---

## Phase 5.5 — `computer_*` agent tools + editor lifecycle controls

**Status: done.** New `computer` group in `AGENT_TOOL_GROUPS`
(`src/shared/agents/tool-groups.ts`) — opt-in, excluded from
`DEFAULT_AGENT_TOOL_GROUP_IDS`, and withheld by `applyRuntimeToolGates` when the
deployment's `computers` capability is off. Five tools ship:

- `computer_exec` — shell command on the bound machine (60s default, 5m max,
  ~40k-char output truncation)
- `computer_read_file` / `computer_write_file` / `computer_list_files`
- `computer_open_url` — `xdg-open` on the machine's real desktop with
  `DISPLAY=:0` (`runCommand` executes outside the desktop session — without it
  xdg-open exits 4). The desktop stream ticket is deliberately **not** returned
  in tool output (bearer secrets must not persist in transcripts); the model is
  told the user can watch via Open desktop.

`computer_desktop` / `computer_screenshot` are not yet tractable — the runtime's
desktop surface is stream-ticket issuance only; GUI automation needs the in-box
driver (plan Phase 3+).

Wiring notes:

- `ComputerService.instanceForOwner` resolves the *owner's* bound computer —
  never a model-supplied id — applies the existing owner/agent-creator access
  rules, resumes a stopped machine, and stamps last-active.
- `computerInstanceFor` in `overlay-executes.ts` builds the `ComputerActor`
  from the acting user's workspace membership (`workspaceService.listForUser`)
  so creator-only agent computers resolve correctly under the delegate model.
- `withAgentGrantToolIds` in `act/tooling.ts`: on an agent turn the grant
  unions into the intent-gated base set — keyword gating exists for personal
  chat; an agent's grant is its whole surface. The account-policy intersect
  still narrows back to the grant, and deployment/project gates apply on top.
- Editor: `AgentComputerSection` gained Stop/Start + Delete (confirm) on the
  provisioned row; `OverlayAgentFields` hides the `computer` toggle when the
  capability is off.

## Phase 6 — automation wiring (optional, defer)

Scheduled agent runs could wake the agent's computer and attach a desktop at
run start (`convex/automations/automationRunner.ts` → service call). Deliberately
underspecified: needs a decision on whether automation time counts against the
workspace computer quota and how stream access is audited. Revisit after
Phase 5 ships and real usage exists.

---

## Standing rules while implementing

- Work happens in a `codex/<slug>` worktree per
  `docs/develop/agentic-development.mdx`; Builder opens a focused PR against
  `staging` (or the owner-authorized direct-push path) and stops.
- Every `src/server/**` file starts with `import 'server-only'`; `convex/`
  imports `@/shared/*` only; packages never import `src/`; no `index.ts`
  barrels under `convex/`.
- `src/shared/` stays isomorphic — nothing in this plan should need to touch
  it except the feature-flag schema (already isomorphic).
- Stream tickets are bearer secrets: `sensitiveResponse`, `no-store`, never
  logged, never persisted.
- Deploys stay held: staging worktree + `convex:push:dev` only when the
  schema lands; no Vercel/production deploys without explicit authorization.
