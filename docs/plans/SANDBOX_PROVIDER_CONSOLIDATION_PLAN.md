# Sandbox provider consolidation: Box now, E2B later

_Decided 2026-10-01. Source of direction: the sub-processor and self-hosting audit ("Computers subsume sandboxes": exactly two providers, Box for cloud and E2B for self-host; Daytona dropped)._

## Decisions

| Question | Decision |
|---|---|
| Providers | **Box** only, for computers and hosted agents. **E2B** is the future self-host provider (separate project). **Daytona and Vercel Sandbox are removed from the codebase.** |
| Hosted agents (Claude Code, Codex, OpenCode, Hermes) | **Agent Host on Box.** A hosted agent is a connected agent whose machine is an Overlay-owned Box running `@layernorm/overlay-agent-host`. One agent runtime for hosted and connected agents; the AI SDK `HarnessAgent` path is deleted. |
| Box egress | `allow_all` is accepted, with **no secrets in the box**: only short-lived, run-scoped agent-gateway and Overlay MCP tokens; never provider keys or BYOK. Revisit when Box ships network policy or E2B lands. |
| Pi | Dropped from the picker until an ACP adapter exists. |
| One-shot code execution | **Computer tools only.** `run_daytona_sandbox` and `POST /api/v1/sandbox/run` are removed. |

## What exists today (2026-10-01)

- **Production:** Box key set and `OVERLAY_COMPUTER_PROVIDER=box`; `OVERLAY_MANAGED_SANDBOX_PROVIDER=vercel`; Daytona key set. 8 Box computers (7 `ready`). 4 Vercel harness leases ever, all released (last 2026-09-17). All 12 agent environments revoked. 3 Daytona workspaces (last 2026-07-11).
- **Box Agent Host path already exists** (`ManagedAgentSandboxService.provisionAgentHost`): creates a Box, installs the host with `npx`, enrolls it. It has never run in production, and its ACP agents have **no model credentials** (nothing passes the agent gateway into the host).
- **Vercel Sandbox** backs every hosted harness (`@ai-sdk/harness*`, `@ai-sdk/sandbox-vercel`, `managed-harness-steps`, `managedHarnessAgentTurnWorkflow`, `harness-bridge`), plus `/api/v1/sandbox/run`, its ephemeral sweeper, and Vercel sandbox pricing/billing.
- **Daytona** spans about 112 files: `run_daytona_sandbox`, `/api/v1/daytona/run`, `packages/overlay-sandbox-runtime/src/daytona.ts`, `@daytona/sdk`, pricing and billing, the reconcile cron, and the Convex tables `daytonaWorkspaces` and `daytonaUsageLedger`.

## Phases

Phase 1 must be live and verified before Phase 2 ships, or production loses hosted agents. Phase 3 is independent.

### Phase 1: hosted agents on Box via the Agent Host

1. **Model credentials through the agent gateway.** For `overlay_cloud` environments, the remote-turn start command's metadata carries `modelGateway: { anthropicBaseUrl, openaiBaseUrl, token }`. The token is the scoped agent-gateway token, minted per turn with the run's TTL and billed to `agent:<id>`. The Agent Host passes these to the ACP child process as `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`, `OPENAI_BASE_URL`/`OPENAI_API_KEY`, and so on, per session. Real keys never enter the box. BYOK bindings resolve server-side in the gateway, not in the box.
2. **Host bootstrap on Box.** Launch under Node 24 (`npx --package node@24 --package @layernorm/overlay-agent-host@<pin>`), install adapter CLIs on first boot, and keep a supervisor so the host restarts with the box. Enrollment stays single-use.
3. **Adapters.** Claude Code and Codex (existing), Hermes (verify it runs in a box), and OpenCode via `opencode acp` (new manifest). Remove Pi from the catalog.
4. **Workspace files.** Move the `./overlay` mirror from the harness workflow to the remote-turn lifecycle (pull at turn start, push at turn end, server-side over the existing `SandboxInstance` for the environment's Box lease). Same grant gating and limits.
5. **Product surface.** "Hosted on Overlay" in the agent editor provisions Agent-Host-on-Box. Idle-stop and billing use the existing sandbox lease meter for Box. Bump the Agent Host release (gateway support).
6. **Verify live:** a Claude Code turn and a Codex turn on a production Box that use Overlay MCP tools, edit `./overlay`, and bill correctly.

### Phase 2: remove Vercel Sandbox

- Delete the AI SDK harness turn path (`managed-harness-steps`, `managedHarnessAgentTurnWorkflow`, `harness-bridge`, `managed-harness-tools` host-tool adapter (fold its tool-building into the MCP server), `registry.ts` harness loaders) and the dependencies `@ai-sdk/harness*`, `@ai-sdk/workflow-harness`, `@ai-sdk/sandbox-vercel`, `@vercel/sandbox`.
- Delete `packages/overlay-sandbox-runtime/src/vercel.ts`, `POST /api/v1/sandbox/run` and its sweeper, `vercel-pricing`, Vercel branches in `ManagedAgentSandboxBilling`/`ManagedAgentSandboxService`/`sandbox-providers`, `OVERLAY_VERCEL_SANDBOX_*` and `OVERLAY_MANAGED_SANDBOX_PROVIDER` handling, and the route-policy, API-boundary, catalog, and docs entries.
- Existing `protocol: 'harness'` bindings (all revoked) are refused with a clear "recreate this agent" message.
- Remove production env vars (`OVERLAY_VERCEL_SANDBOX_*`, `OVERLAY_MANAGED_SANDBOX_PROVIDER`) and update the subprocessors page.

### Phase 3: remove Daytona

- Delete `run_daytona_sandbox` (build, tool groups, exposure policy, buckets, labels, free-tier stubs, instructions), `/api/v1/daytona/run`, `daytona.ts`, `@daytona/sdk` (and its override), Daytona pricing and billing, the reconcile cron, QA scripts, and npm scripts.
- Convex: a one-off migration empties `daytonaWorkspaces` and `daytonaUsageLedger`; then drop both tables and the cron from the schema in a following deploy.
- Grant normalization: the `sandbox` tool group goes away; saved grants that reference it are ignored.
- Config schema: remove `daytona` from sandbox providers; keep `e2b` declared but rejected. Remove `DAYTONA_*` env vars from production after deploy.

### Phase 4: provider contract for E2B

- `SandboxProviderId = 'box' | 'e2b'` with `e2b` rejected at runtime until its adapter exists. One `computerRuntimeFromEnv`/managed-runtime selector.
- Update `docs/configure/providers.mdx`, `bring-your-own-agents.md`, `architecture.mdx`, the on-prem inventory baseline, and the audit report.

## Risks

- **Box egress is open.** Mitigated by keeping only short-lived, run-scoped tokens in the box; documented as accepted.
- **Cold start.** First boot installs Node, the host, and agent CLIs. Use a Box named snapshot as the base image to keep turns fast.
- **Box persistence and cost.** Idle-stop must be enforced by us (Box has no idle timer); the lease meter already does this for Box.
- **No hosted agents between phases** if Phase 2 ships early; keep the order.
