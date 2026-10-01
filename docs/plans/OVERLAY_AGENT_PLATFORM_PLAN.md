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

## Phase 0 — Box billing ✅

Goal: `sandboxCostUsd` and the metering pipeline understand `box`, so every
later phase bills correctly. **Landed** — implementation notes:

- `usage()` on `BoxSandboxInstance` calls `GET /boxes/{id}/usage` on our
  existing `ascii.dev/api/box/v1` base (the docs' `boat.dev/api/v1` +
  `/sandboxes/*` paths are the same API post-rebrand — both verified live).
  Response `{seconds, dollars, secondsPerDollar, billingMultiplier, running}`:
  `seconds` is already size-multiplier-adjusted → mapped to `wallTimeMs`;
  `dollars` → `providerMetrics.reportedUsd`. Metered as deltas via the new
  `providerMetricsDelta` — only `reportedUsd` diffs; rate fields pass through.
- `sandboxCostUsd` `box` branch: provider-reported `dollars` is authoritative;
  `OVERLAY_BOX_SECONDS_PER_DOLLAR` (default 100,000 = list price) rate card
  engages only when the response omits `dollars`.
- Fleet alerting: `probeBoxLimits` runs once per meter sweep when any box
  lease is active; warns on `canStart === false` or `remainingSeconds` under
  `OVERLAY_BOX_LOW_REMAINING_SECONDS` (2h default).
- `CAPABILITIES.usage` flipped to `true`.

Exit gate: unit tests for delta billing and the rate-card fallback — done;
live-API half verified via real `usage`/`limits` responses against the
account (a billed e2e meter pass is still the remaining proof).

## Phase 1 — Overlay agent on boat ✅

Goal: `overlay_cloud` environments default to Box; the agent host runs
there exactly as it does on user machines. **Landed:**

- `managedSandboxRuntimeFromEnv` accepts `box` (`BOX_API_KEY`); default is
  `box` when the key is set, `vercel` otherwise. `OVERLAY_MANAGED_SANDBOX_PROVIDER`
  pins either; `daytona` retained.
- Bootstrap: boxes have no custom-image concept, so the host installs via
  `npx -y @layernorm/overlay-agent-host` (`OVERLAY_AGENT_HOST_PACKAGE`)
  instead of `OVERLAY_AGENT_HOST_IMAGE`; enrollment ceremony unchanged.
- Idle-stop: the meter's provider-agnostic idle pass (`probe.instance.stop`)
  covers box — `box stop` snapshots the disk and pauses billing.
- Egress: `allow_all` on box with the justification documented in code —
  nothing sensitive inside (single-use enrollment code; model keys stay
  server-side). Harness-mode provisioning still rejects `box`.
- Metering: Phase-0 `usage()` deltas.

Exit gate: create an `overlay_cloud` env on box, DM an overlay agent,
turn completes end-to-end, sandbox `stop`s on idle, usage deltas bill —
**not yet run end-to-end**; needs a live provision against a real backend.

## Phase 2 — Ephemeral exec hardening (chat + automations) ✅

Goal: the `sandbox/run` surface is airtight on Vercel and provably leaves
nothing running. **Landed:**

- Provider pinned via `OVERLAY_EXEC_SANDBOX_PROVIDER` (default `vercel`),
  resolved independently of `OVERLAY_MANAGED_SANDBOX_PROVIDER`; a non-vercel/
  daytona value fails fast with `sandbox_provider_unsupported` before the
  budget reservation.
- `finally`: `stop()` → usage capture → billing finalize → **`delete()`**;
  delete failures log and fall through to the sweeper rather than masking
  the run result.
- Orphan sweeper (`src/server/ai/sandbox/ephemeral-sweeper.ts`): lists
  `overlay-sandbox-*` non-persistent Vercel sandboxes older than
  `OVERLAY_EPHEMERAL_SANDBOX_STALE_MS` (15m default) and deletes them — wired
  into the cron-driven reconcile route, reported as `ephemeralSweep` in its
  response. Name prefix + `persistent === false` are disjoint guards against
  ever touching `overlay-cloud-*`/`overlay-harness-*`/`computer-*` sandboxes.
- Automations/chat: unchanged — both already share the tool surface that
  reaches `sandbox/run`; they inherit the hardened lifecycle.

Exit gate: run exec via chat and an automation; confirm `stop`+`delete` in
logs, zero sandboxes visible in the sweeper's scope afterward, billing
finalizes with real Vercel usage counters — **not yet run e2e**.

## Phase 3 — Metaharness v1 ✅

Goal: an overlay agent can invoke other agents and tools on its own computer.

Landed:

- **Exec tool**: the existing `computer_exec`/`computer_read_file`/
  `computer_write_file`/`computer_list_files`/`computer_open_url` family —
  for env-bound agents the tools resolve the agent's own Overlay Cloud box
  (no second machine); for native agents they use the bound computer row.
- **Scoped credentials** (`src/server/ai/agent-gateway/`): `computer_exec`
  mints a 15-minute HMAC token (`OVERLAY_AGENT_GATEWAY_SECRET` or
  `INTERNAL_API_SECRET`) and injects `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`
  pointed at `POST /api/agent-gateway/{provider}/{v1/*}` plus the token —
  `claude`/`codex`/etc. inside a box authenticate through Overlay and never
  see a real provider key.
- **Metered proxy**: the route allowlists model endpoints, injects the real
  server key (WorkOS Vault `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` → env
  fallback), reserves budget before forwarding, taps SSE streams for
  provider-reported usage, and finalizes through the existing
  reserve/finalize pipeline billed to `agent:<id>`. Unpriced models bill a
  conservative fallback (`OVERLAY_AGENT_GATEWAY_FALLBACK_USD`) instead of
  going unmetered.
- **Transcript**: sub-agent invocations render as normal tool calls —
  collapsed, sequential, minimal (existing tool-call UI).
- **Approvals**: the overlay agent's own tool-grant/approval flow gates the
  exec — no per-harness approval plumbing.
- **Out of scope for v1**: parallel sub-agent orchestration, sub-agent
  streaming transcripts, `boat prompt` integration (their agent-credential
  model — evaluate later).

Remaining to verify end-to-end: a real `claude` invocation inside a box
through the gateway (needs a deployed backend + box).

## Phase 4 — Grandfather managed HarnessAgents ✅

Goal: stop selling foreign runtimes without breaking existing ones.

Landed:

- **Creation vs run gate split**: `managedHarnessAvailability` (creation)
  keeps the rollout stage; new `managedHarnessRunAvailability` (turn
  dispatch in `workspace-agent-invocation`) drops the rollout check —
  `OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE=off` now stops new creation while
  existing bindings keep running. The `managedHarnessAgents` feature flag
  remains the emergency kill switch for both.
- **Picker**: `GET /agent-environments/managed` returns bound harnesses as
  `legacy: true` entries when creation is gated (404 only when the workspace
  has none), so the editor renders the bound runtime read-only without
  offering it.
- **Binding gate**: `upsertBinding` refuses a *new* (agent, environment)
  harness pair when creation is gated (`harness_creation_disabled`);
  re-saving an existing pair always passes.
- **Editor**: legacy entries are filtered out of the create-mode selector;
  `saveEdit` rebinds a grandfathered agent on its existing environment
  instead of silently disabling the binding when the picker can't resolve
  the entry.
- **Later** (zero live bindings): delete `harnesses/`, the catalog, session
  table, per-harness billing quirks.
- **Never delete**: the `SandboxRuntime` seam and the `vercel`/`daytona`
  code paths — provider neutrality is the hedge against boat repricing,
  capacity ceilings, or deprecation.

## Phase 5 — Computers consolidation ✅

Goal: one primitive, one surface.

Landed:

- `machineForAgent`/`machineForEnvironment` (`environment-machine.ts`)
  resolve an `overlay_cloud` environment's sandbox lease to a live instance
  — the environment's box doubles as the bound agent's computer, so
  computer tools work without provisioning a second machine.
- `POST /api/v1/agent-environments/{id}/desktop` issues a desktop stream
  ticket on the environment's box (resume-if-stopped, poll until ready,
  bearer ticket never persisted).
- Settings → Computers lists Overlay Cloud environment machines alongside
  computer rows with an "Open" desktop action; the meter owns their
  lifecycle (no manual start/stop/delete controls).
- Agent create flow skips provisioning a separate computer when the agent
  is bound to a managed environment.

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
