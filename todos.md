# Todos

## Editor

- [ ] **Editor "Agent not found" on expired sessions** — the side-panel editor
  renders "Agent not found" (not a re-auth prompt) when the WorkOS token
  lapses mid-session: `agents.get` 401s → `loadFailed` → not-found copy.
  Consider distinguishing auth failure from genuinely missing agents.

## Harness implementation (archived)

The managed harness agents rollout (Vercel Sandbox) was completed and then the
feature was removed; the rollout history lives in git history.

## Self-hosting roadmap

Context: Convex is the only app-data provider (Phase 3 done). Enterprise
self-hosting runs the official `convex-backend` (`examples/customer-deployment/`),
and the SQL read mirror ships in `docker-compose.mirror.yml` (Phase 4 done).
Architecture + rationale: `internal/develop/convex-only-self-hosting.md`.
Frozen escape hatch: `postgres-self-host` branch pinned at `63cf2edb4` — the
last commit with the full bespoke Postgres provider (deleted on `main`); only
touch it if a customer explicitly requires a Postgres app-data backend.

- [ ] **Confirm FSL scope with Convex before building** — email/Discord:
  orchestrating `convex-backend` instances that exist only to serve Overlay
  deployments (including in customer premises) vs. offering managed Convex as
  a product. Get the answer in writing; enterprise procurement will ask.
- [ ] **Big Brain — per-customer lifecycle manager** (Phase 5, build when a
  concrete enterprise need lands). Scope v1 to single-customer deployments:
  provision (instance name → schema → `INSTANCE_SECRET` → admin key →
  container), health-check via `/version`, image upgrades with pre-upgrade
  `npx convex export`, scheduled export backups, standby promote on lease
  loss. Written against four portable interfaces — containers, Postgres
  provisioner, object store, DNS — so it works on any cloud. The OSS repo's
  `big_brain_client` crate shows the backend is designed for external control.
- [ ] **Big Brain — central fleet plane** — deferred harder: per-tenant
  routing, metering (`/metrics`, off by default), and multi-instance scaling
  only matter if Overlay hosts many tenants itself. Re-read the FSL before
  any managed-hosting shape; this version is closest to the license line.

## Overlay Cloud agents (Phase 6)

- [ ] **Test the E2B adapter against real E2B** — it is only tested against a fake SDK.
  Needs an `E2B_API_KEY`; set `OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b` and
  `OVERLAY_CLOUD_AGENT_IMAGE=overlay-agent:v5`, run `npx tsx infra/agent-image/build-e2b.mts`,
  then create a cloud agent and check: create, wake after idle, pause, delete, `writeFiles`
  (Codex `auth.json`), and the E2B rate card in `ManagedAgentSandboxBilling.ts`.
  See `internal/develop/codex-subscription.md`.
- [x] **Hermes on Overlay Cloud — dropped (2026-10-03).** Boat's lazy Hermes install fails, and pre-installing with `UV_PYTHON_INSTALL_DIR` / `UV_CACHE_DIR` on the real disk did not help: the base layer's filesystem drops files while uv unpacks (`EXTERNALLY-MANAGED`, `_sysconfigdata_`, wheel `.dist-info` errors). Hermes stays hidden from the pickers (`SELECTABLE_AGENT_PROVIDER_IDS`); retry only if Boat's base layer changes.
- [ ] **Cursor agent live test** — needs a `CURSOR_API_KEY`.
- [ ] **Codex live test** — needs an approved ChatGPT device code; then two Codex agents on one account.

## Workspace billing (deferred)

- [ ] **Per-agent spend caps** (deferred 2026-10-06). A workspace with a plan draws every run from one shared pool; per-member limits already exist (`configureSpendLimit`). A cap per agent or automation would stop one runaway resource from draining the pool. Not in the first version of workspace billing: build it when a pool is actually shared by several people. Needs: a limit keyed by resource id beside the member limit, checked in the same reservation path as `reserveWorkspace`, and a row on the workspace billing tab.

## Admin console

- [ ] **Separate WorkOS environment for the admin console** (added 2026-10-14). Today the owner is the only operator, so `apps/admin` signs in through the existing WorkOS environment, gated by `ADMIN_ALLOWED_USER_IDS` and `administrativePrincipals`. Before anyone else gets operator access, move admin sign-in to its own WorkOS environment: SSO through company Google Workspace, MFA required, no password or magic link. Plan: `internal/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md`.
- [ ] **Staff environment for other team members** (added 2026-10-14). When more people join, give them their own staff setup (accounts, roles in `administrativePrincipals`, access to the `overlay-admin` Vercel project) instead of sharing the owner's.

## Agent permission cards

- [ ] **MCP approval gate (Overlay tools called by Claude Code / Codex over MCP) still lets the agent move on.** `mcp-approval-gate.ts` waits 25 s for the answer, then returns "waiting for approval, call again" and the agent keeps responding meanwhile (hosts time MCP calls out in about a minute). The permission cards for the agent's own shell/file/tool requests now stop the transcript at the card (`partsUntilPendingRequest`); this path needs a real pause (progress notifications to extend the host's timeout, or holding the call until answered). Cards stay; improve, do not remove (owner, 2026-10-07).
- [ ] **Hold the agent's own output while a card is pending, on the host.** Today only the view stops at the card; sibling tool calls the agent started in parallel still run and appear after the answer.
