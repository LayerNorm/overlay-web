# Managed harness agents: AI SDK HarnessAgent on Overlay Cloud

> Status: approved direction, not yet implemented.
>
> Last reviewed: 2026-09-15.
>
> Completion legend: ✅ landed; everything else is open work governed by each
> phase's exit gate.

## Context

Overlay agents today come in two execution modes:

- **Overlay agents** (`harness: 'overlay'`) — `streamText` tool loops running
  inside `workspaceAgentTurnWorkflow`, with managed models, tool grants, and
  memory. No sandbox.
- **Connected agents** (`remoteTarget`) — a workspace `AgentBinding` points at
  an `AgentEnvironment` (a computer, VPS, or sandbox running
  `overlay-agent-host`), and turns dispatch through the control-plane command
  queue over ACP.

This plan adds a third mode: **managed harness agents** — established agent
runtimes (Claude Code, Codex, OpenCode, Pi, Hermes) hosted on Overlay Cloud,
driven server-side by the Vercel AI SDK `HarnessAgent` against a
provider-managed sandbox.

It **replaces** the agent-host-inside-a-sandbox design for Overlay Cloud
(`ManagedAgentSandboxService` booting `OVERLAY_AGENT_HOST_IMAGE` and enrolling
as `overlay_cloud` through the normal host ceremony). That path required
publishing the host image and running enrollment, Ed25519 credentials, and
command polling inside our own infrastructure. HarnessAgent removes all of it:
the adapter bootstraps the harness inside the sandbox and bridges to it over a
sandbox-exposed port. The agent host remains the answer for **user-owned**
machines only — the BYO path is unchanged.

## Decision and boundary

- Execution for managed harnesses is `HarnessAgent` (`@ai-sdk/harness`) plus
  per-harness adapters (`@ai-sdk/harness-claude-code`, `-codex`, `-opencode`,
  `-pi`) and the generic ACP adapter (`@ai-sdk/harness-acp`) for Hermes.
- Durable turns run inside the Workflow SDK via `@ai-sdk/workflow-harness`
  (`runHarnessAgentTimeSlice`), the same durability model as
  `workspaceAgentTurnWorkflow`.
- **Default and v1-only sandbox provider: Vercel Sandbox** via
  `@ai-sdk/sandbox-vercel`. Vercel is the only provider we operate that has
  network-policy enforcement *and* credential brokering (request
  transformations inject model API keys at the network boundary — keys never
  exist inside the sandbox) *and* usage metering *and* an implemented rate
  card. Daytona and Box remain selectable later behind our own
  `HarnessV1SandboxProvider` bridge (Phase 4); Box stays the Computers
  provider — desktop streaming is irrelevant to headless CLI harnesses.
- v1 model access is **Overlay-funded only** (`modelBilling: 'overlay'`):
  adapters receive credentials through sandbox request transformations or an
  Overlay gateway endpoint + run-scoped token. BYOK on managed sandboxes is a
  later phase, through the same brokering seam with vault-resolved keys.
- v1 catalog: `overlay` (existing native agent), `claude-code`, `codex`,
  `opencode`, `pi`, `hermes` (via `createACP`). No OpenClaw. Cline, Cursor,
  Deep Agents, fx, GitHub Copilot, and Grok Build exist as published adapters
  and are picker additions later, not v1 scope.

## Architectural invariants

1. Overlay owns the canonical workspace identity, `AgentRun`, transcript,
   approval, budget, policy, and audit records. The harness owns only its
   private session state (opaque `resumeFrom`) and the sandbox filesystem.
2. Agent identity, harness adapter, sandbox provider, and execution mode stay
   separate. `WorkspaceAgentDefinition.harness` remains a display/policy hint;
   execution truth is the binding's `protocolAdapter === 'harness'`. This
   extends the existing BYO invariant against overloading `harness`.
3. Harness output projects into the existing assistant message and agent run;
   no second transcript. The projection path is the same one hosted turns use
   (`AgentMessageStream` / `collaboration.startAgentTurn` family).
4. The `AgentRun` state machine stays the lifecycle authority. A harness turn
   is a workflow run like any other; reclaim/retry semantics are unchanged.
5. The environment is durable identity; the sandbox is a renewable resource.
   An `overlay_cloud` environment outlives any single sandbox. A turn that
   finds its sandbox gone recreates it (snapshot/`identity` reuse) and updates
   the lease's `providerReference` — this is also how Vercel's sandbox maximum
   lifetime is absorbed.
6. Secrets never enter transcripts, prompts, or sandbox-visible state that the
   agent could exfiltrate. Model credentials arrive via request
   transformations or a scoped gateway token — never a user's raw BYOK key as a
   readable env var. On providers without brokering, BYOK keys are not
   offered at all.
7. Every repository, route, deletion path, billing path, and test ships for
   Convex and PostgreSQL in the same phase — the dual-provider parity rule
   from BYO agents still applies.
8. All AI SDK harness imports live behind `src/server/agents/harnesses/` and
   are `await import()`-ed inside `'use step'` bodies only. Nothing
   harness-related enters the workflow VM bundle — the same rule that fixed
   the Chat SDK `AbortController` incident.
9. The harness packages are experimental `1.0.x`. Pin versions at least 7 days
   old, keep every import behind the registry, and treat adapter upgrades as a
   deliberate, tested change.
10. A managed sandbox is an execution boundary with an explicit filesystem
    scope (`/workspace`), not a user machine. No home-directory assumptions,
    no inbound product features beyond the bridge port the adapter needs.

## Harness catalog

| id | Adapter package | Runtime location | Port needed | Notes |
| --- | --- | --- | --- | --- |
| `overlay` | — (existing `streamText` path) | n/a | n/a | Native agent; unchanged |
| `claude-code` | `@ai-sdk/harness-claude-code` | sandbox bridge | yes | `ANTHROPIC_*` env / request transforms |
| `codex` | `@ai-sdk/harness-codex` | sandbox bridge | yes | `OPENAI_*` env / request transforms |
| `opencode` | `@ai-sdk/harness-opencode` | sandbox bridge | yes | provider config env |
| `pi` | `@ai-sdk/harness-pi` | host process | no | Model calls stay server-side — best credential posture; sandbox is workspace only |
| `hermes` | `@ai-sdk/harness-acp` + `createACP` | sandbox (ACP stdio) | yes | `source: install-command`, `executable: hermes`, `args: ['acp']`; verify 1.0.50 API hasn't drifted before shipping |

Shared, isomorphic catalog for directory/editor/mobile rendering lives in
`src/shared/agents/harness-catalog.ts`: `{id, label, description, kind:
'native' | 'bridge' | 'acp' | 'host', defaultModelId, capability notes}`.
Server-only adapter construction lives in
`src/server/agents/harnesses/registry.ts` — the *only* module that touches
`@ai-sdk/harness-*` packages.

## Data model

No new entity tables except harness session state. Everything else reuses
existing records:

- `WORKSPACE_AGENT_HARNESSES` extends to
  `['overlay', 'claude-code', 'codex', 'opencode', 'pi', 'hermes']`
  (`packages/overlay-workspace-contracts/src/types.ts`). `allowedAgentHarnesses`
  workspace policy already gates the set.
- `AGENT_PROTOCOL_ADAPTERS` extends to `['acp', 'eve', 'native', 'harness']`
  (`connected-agents.ts`).
- `AgentEnvironment` — `kind: 'overlay_cloud'`, created directly by the server
  (no enrollment session, no host credential, `status: 'online'` once the
  first sandbox exists).
- `AgentSandboxLease` — unchanged shape; `provider: 'vercel'`,
  `providerReference` = Vercel sandbox id. Lease continues to drive billing,
  idle-stop sweeps, and revocation cleanup.
- `AgentBinding` — `protocolAdapter: 'harness'`; `adapterConfig` carries
  `{ adapterId, provider: 'vercel', workingDirectory: '/workspace',
  modelBilling: 'overlay' }`.
- **New `agentHarnessSessions` (Convex + Postgres)**: one row per
  `(bindingId, conversationId)` holding `{ sandboxSessionId, resumeFrom
  (opaque JSON string), status, lastTurnRunId, updatedAt }`. This is the
  multi-turn seam: `createSession({ sessionId: sandboxSessionId, resumeFrom })`
  reattaches the native harness conversation.

## Target execution flow

```text
human @mentions a managed-harness agent
              |
              v
resolveWorkspaceAgentInvocations
  remoteTarget.protocolAdapter === 'harness'
              |
              v
startManagedHarnessTurn
  - buildAgentTurnContext + buildRemoteAgentPrompt (same bounded envelope)
  - model reservation (overlay-funded) + ManagedAgentSandboxBilling.reserve
  - collaboration.startAgentTurn -> AgentRun + placeholder message
  - start(managedHarnessAgentTurnWorkflow)
              |
              v
workflow (use workflow)
  step attachWorkspaceAgentRun          (existing)
  step harnessTurnSlice (loops while state.status === 'ready_for_next_step'):
    await import harness registry       (keeps Node deps out of VM bundle)
    ensure sandbox live: lease.providerReference -> runtime.reconnect,
      else runtime.create + update lease
    agent = registry.buildHarnessAgent(binding, lease)
    session = agent.createSession({ sessionId, resumeFrom })
    runHarnessAgentTimeSlice({
      agent, state, timeSliceSeconds: 600,
      writable: transcriptWritable(getWritable(), messageRow),
    })
  step finalize:
    finalizeHarnessWorkflow -> turn result
    persist resumeFrom on agentHarnessSessions
    completeWorkspaceAgentRun + sandboxBilling.settle + audit
              |
              v
assistant message row streams text/tool parts live,
run record settles, reservation finalizes — identical
settlement contract as hosted and connected turns
```

`transcriptWritable` is a `WritableStream<UIMessageChunk>` that maps harness
stream parts (text-delta, tool-input/output, provider-executed data parts such
as file changes and compaction) into `pushText`/`pushParts` on the assistant
row, and forwards every chunk to the workflow output stream for live SSE.

## Phases

### Phase 0 — foundations

**Status: implemented.** Smoke findings (2026-09-15): a `claude-code`
HarnessAgent session created and bootstrapped inside a live Vercel Sandbox —
bridge bound on port 4000, harness stderr and stream parts flowed back to the
host. `@vercel/sandbox` resolved auth from the local Vercel CLI/plugin session
even without `VERCEL_*` envs (env vars remain the production path). The model
turn failed closed with `ENOTFOUND` — no `ANTHROPIC_API_KEY` was configured —
which also confirmed the egress allowlist enforces DNS-level blocking. Vercel
sandbox lifetime is plan-bound (`timeout` + `extendTimeout` up to the plan
max; `update()` supports `persistent` + snapshot restore), so the
recreate-on-resume design is confirmed necessary rather than optional.
Default `permissionMode` for managed harnesses must be chosen explicitly in
Phase 2 — `bypassPermissions` auto-approves before the `canUseTool` callback
is consulted.

- Bump `ai` to `7.0.93` (harness's exact dependency; the `@ai-sdk/*` packages
  exact-pin their deps, so `react@4.0.96`, `workflow@2.0.24`, and
  `otel@1.0.93` were pinned to the same 2026-09-04 lockstep batch to keep one
  deduped `ai`/`provider-utils` tree) and add pinned packages:
  `@ai-sdk/harness`, `@ai-sdk/workflow-harness`, `@ai-sdk/sandbox-vercel`,
  `@ai-sdk/harness-claude-code`, `@ai-sdk/harness-codex`,
  `@ai-sdk/harness-opencode`, `@ai-sdk/harness-pi`, `@ai-sdk/harness-acp`.
  Pin each to the latest version at least 7 days old.
- `src/shared/agents/harness-catalog.ts` + `MANAGED_HARNESS_IDS` in
  `overlay-workspace-contracts` (kept deliberately separate from
  `BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS` and `OVERLAY_MANAGED_ACP_ADAPTER_IDS` —
  the same separation-of-allowlists rule).
- `src/server/agents/harnesses/registry.ts`: harnessId → adapter factory,
  model mapping, port, credential-env/transform mapping, bootstrap config.
- Verify with a scratch script (not committed): `HarnessAgent` + `claudeCode`
  + `createVercelSandbox` runs one real turn end-to-end. **Exit gate:** one
  streamed turn against a live Vercel sandbox; record findings on Vercel
  sandbox max lifetime vs the 24h `hardTimeoutMs` assumption.

### Phase 1 — data model + provisioning

**Status: implemented.** Harness-mode provisioning now skips the enrollment
ceremony entirely: `provision({mode:'harness'})` creates the sandbox (bridge
port 4000 exposed for `bridge`/`acp` adapters, allowlist egress + denied
private/metadata CIDRs), writes an already-approved `overlay_cloud`
environment with a fixed `/workspace` grant, and records the lease. Binding
upserts pick `protocolAdapter: 'harness'` off the environment's advertised
adapters and stamp `provider` from the active lease. `agentHarnessSessions`
persists per-binding+conversation `resumeState` in both Convex and Postgres
(migration 0076); workspace deletion sweeps it. The live API exit gate is
pending `VERCEL_*` env credentials (see `todos.md`) — provider selection fails
closed without them.

- Extend `AGENT_PROTOCOL_ADAPTERS`, `WORKSPACE_AGENT_HARNESSES`, and the
  binding `adapterConfig` schema; `agentHarnessSessions` in
  `convex/schema` + Postgres migration + both repository implementations.
- `ManagedAgentSandboxService.provision` gains
  `{ mode: 'harness', harnessId, provider: 'vercel' }`: creates the sandbox via
  `VercelSandboxRuntime` (network allowlist + denied private CIDRs as today),
  writes the `overlay_cloud` environment directly (no enrollment, no host
  image), lease, and returns `{environment, lease}` — the response shape the
  editor already consumes. `POST /api/v1/agent-environments/managed` accepts
  the new body; `overlayCloudEnvironments` feature flag covers it.
- Binding upsert accepts `protocolAdapter: 'harness'`.
- **Exit gate:** provision a `claude-code` managed environment via the API;
  environment, lease, and binding rows correct in both Convex and Postgres;
  audit event recorded.

### Phase 2 — dispatch + durable turn

- `resolveWorkspaceAgentInvocations` carries `protocolAdapter` on
  `remoteTarget`; `conversations/message/route.ts` branches to
  `startManagedHarnessTurn` for `harness` bindings (mirrors
  `startRemoteWorkspaceAgentTurn` minus command/session-queue writes — the run
  row comes from `collaboration.startAgentTurn`).
- `src/server/workflows/managed-harness-agent-turn.ts` +
  `managed-harness-steps.ts`: acquire-session step (sandbox ensure + provider
  wrap via `createVercelSandbox({ sandbox })` on the reconnected native
  handle), slice loop, finalize. `transcriptWritable` mapper.
- `agentHarnessSessions` read/write of `resumeFrom`; sandbox recreate path
  updates `lease.providerReference`.
- Run cancellation maps to `session.destroy()`; failure path mirrors
  `failWorkspaceAgentRun` + reservation release + billing reconcile.
- Harness built-in tool approvals: v1 policy is adapter-configured safe
  defaults inside the sandbox boundary (no interactive approval UI yet);
  elicitation/`askUserQuestions` disabled. Interactive approvals via
  `suspendTurn` + `AgentApprovalRequest` are a follow-up.
- **Exit gate:** DM a managed `claude-code` agent; turn is durable (survives
  redeploy of the workflow run boundary), streams live into the row, settles
  billing, second turn resumes native history via `resumeFrom`.

### Phase 3 — creation UX

- `AgentTypeSelector` becomes two options: **"Hosted on Overlay Cloud"** and
  **"Bring your own agent"**. The hosted branch shows a runtime list — Overlay
  first ("Models, tools, and memory managed by Overlay"), then Claude Code,
  Codex, OpenCode, Pi, Hermes ("Runs in an isolated Overlay Cloud sandbox").
- Selecting a sandboxed runtime swaps the Overlay-only section (model picker,
  tool groups) for harness config: model select (per-harness list, Overlay
  funded), provider row fixed to "Vercel Sandbox" in v1, working directory
  fixed to `/workspace`.
- Save flow: `agents.create` → `agentEnvironments.createManaged({mode:
  'harness', harnessId})` → `upsertBinding({protocolAdapter: 'harness'})` —
  same durable-identity-then-binding ordering and retry-safety as BYO.
- Edit page shows harness + provider badges, sandbox status, and a "reset
  session" action (clears `agentHarnessSessions` row / destroys sandbox).
- Gating: `managedHarnessAgents` runtime feature + rollout stage +
  `allowedAgentHarnesses` policy; hidden when disabled.
- **Exit gate:** create each catalog harness through the UI, screenshot QA
  both themes, agent renders in directory/mentions, chat works.

### Phase 4 — providers, approvals, hardening

- `packages/overlay-sandbox-runtime/src/harness-bridge.ts`:
  `createOverlaySandboxProvider(runtime) → HarnessV1SandboxProvider` mapping
  `SandboxInstance` to `HarnessV1NetworkSandboxSession` (spawn/run/files/ports/
  policy/lifecycle/`restricted()`), then Daytona as a selectable provider.
  Box explicitly documents keys-in-sandbox + no-egress-policy limits before it
  is offered for harnesses.
- Interactive approvals/elicitation: `suspendTurn`/`continueFrom` mapped onto
  `AgentApprovalRequest` records and the existing room approval UI.
- BYOK for managed harnesses via request transformations on Vercel only.
- Box rate card (`computeBoxRuntimeCost`) if Box is ever selectable for
  harnesses; `usage:false` means wall-time billing.
- Mobile: bootstrap capability + harness/provider labels in the agents roster
  and editor parity.
- Live conformance per provider behind `OVERLAY_SANDBOX_LIVE_CONFORMANCE=1`.

## Security notes

- v1 posture: Overlay-funded model credentials only, injected via Vercel
  request transformations or a run-scoped gateway token; sandbox egress
  allowlist = model endpoints + npm/github + Overlay origin, with private
  CIDRs and `169.254.0.0/16` denied.
- Pi runs host-side: its model calls never enter the sandbox at all — safest
  harness in the catalog.
- `session.destroy()` on revocation/archive; lease sweeps kill idle sandboxes;
  `cleanupAfter` and hard timeout still apply.
- Nothing from the harness stream is trusted: parts project as data, and
  provider-executed dynamic parts (file diffs, compaction) render as summaries
  only.

## Docs and bookkeeping

- Update `docs/develop/bring-your-own-agents.md` and
  `bring-your-own-agents-architecture.md`: managed-sandbox section now reads
  "HarnessAgent-driven; agent host path is user-owned only."
- `docs/develop/architecture.mdx` (new server module + shared catalog),
  `docs/develop/api-route-catalog.mdx` (managed route body), root
  `CHANGELOG.md` per phase.
- This plan supersedes the managed-sandbox provisioning paragraphs of the BYO
  plan; the user-owned host/enrollment/ACP phases remain authoritative.

## Open questions

- ~~Vercel Sandbox max lifetime vs the 24h `hardTimeoutMs` assumption~~ —
  resolved in Phase 0: lifetime is plan-bound, not a fixed constant
  (`timeout` + `extendTimeout` up to the plan max; `update()` exposes
  `persistent` and snapshot restore). The recreate-on-resume path is required.
- ~~`@ai-sdk/harness-acp` API drift vs the lockstep adapters~~ — partially
  resolved in Phase 0: `harness-acp@1.0.40` deps on `harness@1.0.102` and
  `createACP` constructs a conformant `harness-v1` adapter (registry test
  verifies `specificationVersion`/`harnessId`). Still pending: a live Hermes
  turn before it appears in the picker.
- Whether `runHarnessAgentTimeSlice`'s `writable` replacement still forwards
  to `getWritable()` automatically — if not, `transcriptWritable` must tee to
  both (planned either way).
- Idle-cost policy for warm sandboxes: `destroyOnFinish:false` keeps the
  sandbox parked between turns; pick the idle-stop window against Vercel's
  billing granularity.
