# Sandbox provider consolidation: Box now, E2B later

_Revised 2026-10-01. Steps 1–3 landed on `main` the same day (not yet deployed); follow-ups are listed under "Release and follow-ups"._ Direction from the sub-processor and self-hosting audit: Overlay Cloud is **Box** only; self-hosted deployments use **E2B**. Daytona is dropped (AGPL-3.0, frozen upstream). Vercel Sandbox adds nothing._

## Product shape (for context)

1. **Overlay agents**: our own harness, the product. This is the focus until the steps below are done.
2. **Other agents on Overlay Cloud** (Claude Code, Codex, …): to be rebuilt from the ground up on Box, and on E2B for self-hosting.
3. **Other agents on your machine**: the connected/BYO path, already good enough; unchanged.

## Scope of this plan: three steps, in order

### Step 1: disable creating agents on Overlay Cloud (done)

- `managedHarnessAvailability` (the creation gate) always returns disabled, independent of flags and rollout stage, so the editor's runtime picker disappears and the control plane refuses new harness bindings.
- `POST /api/v1/agent-environments/managed` returns 410 for both modes (managed harness and the older Agent-Host-on-Box mode). Nothing provisions a sandbox for an agent.
- Existing bindings are untouched until step 2 (all production environments are already revoked). Computers (Box) are unaffected.

### Step 2: remove Vercel Sandbox (done)

- Delete the AI SDK harness turn path: `managed-harness-steps`, `managedHarnessAgentTurnWorkflow`, `harness-bridge`, harness registry loaders, `managed-harness-tools` (host-tool adapter), the sandbox file sync built for harness sandboxes, and the dependencies `@ai-sdk/harness*`, `@ai-sdk/workflow-harness`, `@ai-sdk/sandbox-vercel`, `@vercel/sandbox`.
- Delete `packages/overlay-sandbox-runtime/src/vercel.ts`, `POST /api/v1/sandbox/run` and its sweeper, Vercel sandbox pricing/billing, Vercel branches in the managed-sandbox services and provider selection, `OVERLAY_VERCEL_SANDBOX_*` and `OVERLAY_MANAGED_SANDBOX_PROVIDER`, plus route-policy, API-boundary, catalog and docs entries.
- The Overlay MCP server for connected agents (`/api/agent-mcp`) stays; its tool builder moves out of the harness adapter.
- Remove the production env vars after deploy and update the subprocessors page.

### Step 3: remove Daytona (done, schema tables pending)

- Delete `run_daytona_sandbox` (tool, groups, exposure policy, buckets, labels, free-tier stubs, instructions), `/api/v1/daytona/run`, `daytona.ts`, `@daytona/sdk` and its override, Daytona pricing/billing, the reconcile cron, QA scripts and npm scripts.
- Convex: empty `daytonaWorkspaces` and `daytonaUsageLedger` with a one-off migration, then drop both tables in a following deploy.
- Saved grants that reference the `sandbox` tool group are ignored. Config schema drops `daytona`; `e2b` stays declared-but-rejected. Remove `DAYTONA_*` env vars from production after deploy.
- Code execution for agents is via Computer tools (Box); there is no replacement one-shot exec tool or public sandbox API.

## Release and follow-ups

1. Deployed web, then Convex (`convex:push:prod`), on 2026-10-01.
2. Took an export, then ran `migrations/removeDaytonaData:run` on production until `done` was true: 161 rows (158 usage-ledger rows, about $2.02 total, and 3 workspaces). The backup is `artifacts/backups/prod-pre-daytona-cleanup-2026-10-01.zip` (local, gitignored).
3. Follow-up commit dropped `daytonaWorkspaces` and `daytonaUsageLedger` from the schema along with their cleanup code, count fields and tenancy rows, and deleted the migration. Then deploy Convex again.
   - **Shared dev Convex still has Daytona rows.** A schema without the tables fails validation there. Before the first `convex:push:dev` from `staging`, check out `35724c913`, push it to dev, run `npx convex run migrations/removeDaytonaData:run '{}'` until `done`, then push the newer code.
4. Unset in production on 2026-10-01: `OVERLAY_VERCEL_SANDBOX_*`, `OVERLAY_MANAGED_SANDBOX_PROVIDER`, `OVERLAY_FEATURE_MANAGED_HARNESS_AGENTS`, `DAYTONA_*` (Production only; Preview still has them). `OVERLAY_PROVIDER_SANDBOX` is sensitive and unreadable, so it was left; the config still accepts `vercel`/`daytona` as inert values. Removed variables take effect on the next web deploy.
5. Revoked harness environments and their leases (provider `vercel`) remain as inert rows.

## After this

- Overlay agents are the focus.
- Then design agent creation (a much simpler flow, permissions collapsed by default) and build other-agent support from the ground up, for both Overlay Cloud (Box, E2B) and on-your-machine.
- E2B adapter for self-hosting is a separate project (`SandboxProviderId` → `box | e2b`).

## What exists today (2026-10-01)

- Production: Box key set, `OVERLAY_COMPUTER_PROVIDER=box`, Computers on; `OVERLAY_MANAGED_SANDBOX_PROVIDER=vercel`; Daytona key set. 8 Box computers. 4 Vercel harness leases ever, all released (last 2026-09-17). All 12 agent environments revoked. 3 Daytona workspaces (last 2026-07-11).

## Boat rename (2026-10-01)

Box renamed itself Boat. The adapter (`packages/overlay-sandbox-runtime/src/box.ts`) now calls `https://boat.dev/api/v1` and prefers `BOAT_API_KEY` over `BOX_API_KEY`; the internal provider id stays `box`. Production still has `BOX_API_KEY`, which keeps working.
