# Overlay agent platform: one agent, any computer

> Status: approved direction, phased implementation.
>
> Last reviewed: 2026-09-19.
>
> Completion legend: ✅ landed; everything else is open work governed by each
> phase's exit gate.

## Context

Overlay today runs three sandbox-backed surfaces on two paid providers, plus
one provider-specific product surface:

- **Ephemeral code exec** (`run_daytona_sandbox` tool → `POST /api/v1/sandbox/run`,
  automations share the same tool surface via `describePersonalChatWorkTools`):
  a fresh non-persistent Vercel sandbox per request, 300s cap, `deny_all`
  egress, `stop()` in `finally` — but never `delete()`, and nothing sweeps
  sandboxes orphaned by an aborted request.
- **Managed agent hosts** (`overlay-agent-host` on `overlay_cloud`
  environments): Vercel default, Daytona via `OVERLAY_MANAGED_SANDBOX_PROVIDER`.
- **Managed HarnessAgents** (claude-code/codex/opencode/pi/hermes as peer
  runtimes): Vercel default, Daytona optional; Box hard-rejected
  (`sandbox-providers.ts`) because it has no egress allowlist and no
  credential brokering.
- **Computers** (persistent desktops): Box only.
- **BYO agents**: the user's own machine — zero Overlay compute cost.

Provider economics (per in-repo rate cards and boat.dev/billing):

| Provider | Always-on 4GB-class cost | Ephemeral 300s run | Persistence |
|---|---|---|---|
| Vercel | ~$62/mo memory floor + active CPU | ~2.8¢ worst-case | Ephemeral |
| Daytona | ~$119/mo running (auto-stop helps) | delegated route | Ephemeral-ish |
| Box (boat) | ~$13/mo small / ~$26/mo default | not the fit — persistent VMs | Real persistence + snapshots + desktop |

## Strategy

**One runtime, any computer.** The overlay agent is the product. Foreign agent
runtimes are not peers — they are tools already installed on every boat
(`claude`, `codex`, `pi`, `opencode`, `hermes`, `openclaw`, `cursor-agent`,
`prime-agent`, `kimi`, `lux`, `host`). The overlay agent is a **metaharness**:
it orchestrates models, context, tools, and — when useful — other agents
running on its own computer.

**Boat is the default cloud computer.** Persistent `overlay_cloud`
environments run on Box: ~5x cheaper always-on, real persistence, snapshots,
desktop streaming, per-sandbox usage API. Vercel stays in the seam.

**Vercel stays the ephemeral exec provider.** Chat and automations keep
per-request sandboxes on Vercel — microVM cold-start fits the 300s request
shape, `deny_all` egress is native, and its usage counters finalize at stop.
Box's persistent-VM model is the wrong shape for per-request isolation.

**The credential problem mostly evaporates.** The overlay agent's brain is
server-side — model calls flow through our gateway, no provider keys enter
the box. Sub-agent CLIs invoked inside a box authenticate via
`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`-style overrides pointed at the Overlay
gateway with a per-agent scoped token: no real keys in the VM, all sub-agent
spend flows through existing metering, revocation is token expiry. This is
strictly better than the Vercel-transform model — provider-neutral, and it
unblocks BYOK off-Vercel since the box only ever holds our scoped token.

**Product surface collapses to two creation paths:** Overlay agent (on
Overlay Cloud boat | on your machine via BYO host). "Computers" becomes the
desktop view of an agent's environment, not a separate product.

## Non-negotiable lifecycle invariant

**Ephemeral exec sandboxes must not linger.** A `sandbox/run` sandbox is
born, executes, and dies inside the request — `stop()` → usage capture →
`delete()` in `finally`, provider `timeout` as the hard ceiling, plus an
orphan sweeper for crash paths. Ephemeral sandboxes are never leased, never
`persistent`, never resumable. The sweeper is defense in depth, not the
primary mechanism.

## Phase 0 — Box billing

Goal: `sandboxCostUsd` and the metering pipeline understand `box`, so every
later phase bills correctly.

- Implement `usage()` on `BoxSandboxInstance` via
  `GET /api/box/v1/sandboxes/{id}/usage?since&until` → `{seconds, dollars,
  running}`. Map `seconds`→`wallTimeMs`, `dollars`→`providerMetrics.reportedUsd`,
  `running`→lifecycle hint. The API applies the size multiplier and returns
  list-price dollars — **no Overlay rate card required**; bill on deltas per
  metering pass, never absolute reads (stale responses must not double-bill).
- `sandboxCostUsd` gains a `box` branch: prefer provider-reported `dollars`;
  fall back to a list-price rate card (`$0.036/hr` default = `$0.00001/s`,
  `small` 0.5x, `large` 2x) only when the API is unreachable.
- Reservation estimate for box: `seconds-rate × maxRunTime` with the existing
  buffer — box has no creation fee or egress metering.
- Fleet alerting: `GET /limits` poll on the existing provider-spend-alert
  path (`OVERLAY_SANDBOX_PROVIDER_SPEND_ALERT_USD`) for `canStart` /
  credit-balance exhaustion.
- Keep `usage: false` → `usage: true` in `CAPABILITIES` once implemented.

Exit gate: unit tests for delta billing and the rate-card fallback; a real
box created, run for minutes, `usage()` returns dollars matching the CLI.

## Phase 1 — Overlay agent on boat

Goal: `overlay_cloud` environments default to Box; the agent host runs
there exactly as it does on user machines.

- `managedSandboxRuntimeFromEnv` accepts `box` (`BOX_API_KEY`); provider
  resolution order becomes `box` default, `vercel`/`daytona` retained.
- `OVERLAY_AGENT_HOST_IMAGE` bootstrap on box: `noEnv: true` create (already
  the runtime's behavior), `overlay-agent-host connect --kind overlay_cloud`
  detached, enrollment ceremony unchanged.
- Idle-stop: Box has no native idle timer — `enforceSandboxIdleStop` already
  owns this; `box stop` snapshots the disk and pauses billing, so idle-stop
  IS the cost control. Wire last-activity tracking to turn boundaries.
- Egress: nothing sensitive inside the box means `allow_all` is acceptable
  for v1 (agent host needs Overlay server + bootstrap domains; model calls
  stay server-side). An Overlay egress CONNECT proxy is a hardening
  follow-up, not a blocker.
- Metering: lease-based wall-clock + `usage()` deltas from Phase 0.

Exit gate: create an `overlay_cloud` env on box, DM an overlay agent,
turn completes end-to-end, sandbox `stop`s on idle, usage deltas bill.

## Phase 2 — Ephemeral exec hardening (chat + automations)

Goal: the `sandbox/run` surface is airtight on Vercel and provably leaves
nothing running.

- Keep provider pinned to `vercel` for this surface regardless of the
  managed default — exec shape is per-request isolation, not persistence.
- `finally`: `stop()` → usage capture → **`delete()`** (add the missing
  delete; stopped non-persistent sandboxes still hold records and snapshots).
- Orphan sweeper: scheduled job lists Vercel sandboxes tagged
  `overlay.operation: 'sandbox.run'` older than `SANDBOX_MAX_DURATION_SECONDS`
  + grace and force-deletes them; alerts on any found (a live orphan means a
  bug elsewhere). Defense in depth on top of the provider's 300s `timeout`
  ceiling.
- Automations: verify `run_daytona_sandbox` exposure through
  `describePersonalChatWorkTools` + `exposure-policy.ts` for automation
  turns; the tool id is contract-stable — consider a display rename to
  "run sandbox" without changing the id.
- Chat: already wired — no surface change, just inherits the hardened
  lifecycle.

Exit gate: run exec via chat and an automation; confirm `stop`+`delete` in
logs, zero sandboxes visible in the sweeper's scope afterward, billing
finalizes with real Vercel usage counters.

## Phase 3 — Metaharness v1

Goal: an overlay agent can invoke other agents and tools on its own computer.

- **Exec tool**: a sandbox-exec tool for overlay agents bound to an
  `overlay_cloud` environment — run a command on the agent's box, capture
  stdout/files, fold into the turn. Uses the existing `SandboxRuntime` seam
  and the lease's `providerReference`.
- **Sub-agent invocation**: `claude`/`codex`/etc. as exec calls. Scoped
  credentials: mint a per-agent gateway token, inject
  `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`→Overlay gateway + token into the
  exec environment — real provider keys never enter the box, sub-agent model
  spend meters through the existing gateway path.
- **Transcript**: sub-agent invocations render as normal tool calls —
  collapsed, sequential, minimal (per existing UI conventions); output folds
  into the agent's context for orchestration.
- **Approvals**: the overlay agent's own approval flow gates the exec —
  no per-harness approval plumbing.
- **Out of scope for v1**: parallel sub-agent orchestration, sub-agent
  streaming transcripts, `boat prompt` integration (their agent-credential
  model — evaluate later).

Exit gate: an overlay agent asked to "fix this bug with claude code"
provisions/locates its box, runs `claude`, reports the diff — billed
correctly, keys never in the box, transcript clean.

## Phase 4 — Grandfather managed HarnessAgents

Goal: stop selling foreign runtimes without breaking existing ones.

- Rollout stage → none for **new** creation
  (`OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE` + `managedHarnessAgents` gate —
  both already exist); picker hides the runtime row for new agents.
- **Keep alive**: `ManagedHarnessAgentTurnWorkflow`, `agentHarnessSessions`,
  approvals, BYOK-vault path — until every existing binding is removed.
- Editor: hosted runtime collapses to Overlay agent (cloud boat | BYO).
  Existing managed agents keep rendering their runtime read-only.
- **Later** (zero live bindings): delete `harnesses/`, the catalog, session
  table, per-harness billing quirks.
- **Never delete**: the `SandboxRuntime` seam and the `vercel`/`daytona`
  code paths — provider neutrality is the hedge against boat repricing,
  capacity ceilings, or deprecation.

Exit gate: new agents can only be overlay|BYO; existing harness agents still
turn; no user-facing breakage.

## Phase 5 — Computers consolidation

Goal: one primitive, one surface.

- A computer row and an `overlay_cloud` environment converge on the same
  box-backed primitive; the "Computers" UI becomes the desktop/live view of
  an agent's environment rather than a separate creation flow.
- Desktop streaming (`DesktopSandboxInstance.desktop()`) hangs off the
  agent's environment for support/debug/live-view.

## Open questions

- **Brain placement**: agent brain stays server-side now. If enterprise
  self-host later wants the whole agent inside the customer perimeter,
  in-box brain becomes a roadmap item and moves the gateway boundary —
  revisit then, not now.
- **Boat capacity**: plan ceilings are shared-pool (concurrency, starts/min,
  starts/day). At real fleet scale we need the right org/plan shape; `limits`
  monitoring from Phase 0 gives the early signal.
- **Egress proxy**: deferred hardening — becomes load-bearing again only if
  we ever put real credentials back inside customer-visible boxes.
- **Per-user warm exec boxes**: deliberately rejected for now — user asked
  for Vercel ephemeral; revisit only if per-request cost or file-persistence
  UX demands it.
