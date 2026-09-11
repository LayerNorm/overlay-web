# Computers: persistent cloud desktops for agents and members

Status: in progress — provider adapter + domain service landed and tested;
web wiring pending live smoke verification. Decisions marked **[decided]**
are settled; the rest are implementation defaults open to revision.

## Context

Overlay has sandboxed code execution (Daytona via `@overlay/sandbox-runtime`) and
browser-use tooling, but neither is a real OS: no display, no persistent GUI
state, no signed-in apps. "Computers" adds persistent cloud desktops — the unit
of knowledge work an agent can actually see and drive.

Provider of record for v1: [box](https://docs.ascii.dev/box/quickstart)
(Linux VMs, Moonlight/WebRTC + VNC desktop streams, browser-only streams,
stop/resume/fork snapshots, Lux GUI automation, claude/codex/hermes/openclaw
preinstalled).

## Model

`computers` is a new first-class entity:

```
computers
  id
  workspaceId
  ownerType: 'agent' | 'user'
  ownerId                      -- agentId or userId; unique (ownerType, ownerId)
  provider: 'box'              -- more providers later
  providerRef                  -- box id (bx_...)
  size: 'small' | 'default' | 'large'
  status: 'provisioning' | 'ready' | 'stopped' | 'error'
  createdBy / createdAt / lastActiveAt / lastSnapshotAt
```

- **[decided]** One computer per Overlay agent (`ownerType 'agent'`), one per
  member (`ownerType 'user'`). No shared workspace computer: persistence is the
  point — signed-in Chrome profiles, installed tools, and files live in the
  box's snapshots, and sharing destroys the per-identity model.
- **[decided]** Owner-keyed binding (`ownerType, ownerId` unique) rather than a
  `computerId` column on the agent row — no agents-table migration, symmetric
  for user computers, cascade-delete from the owner path.
- Computers are persistent-by-default and lifecycle-managed: resumed on demand
  (agent run starts, stream opened), auto-stopped on idle. Stopped ≈ $0
  (snapshot storage only); always-on `default` ≈ $26/mo/box is not the default.

## Access model **[decided]**

- Workspace agents (`visibility: 'workspace'`): any workspace member may open
  the computer's stream.
- Creator-only agents (`visibility: 'creator'`): creator + workspace owner
  (same safety-valve precedent as archive).
- Personal computers: owner only.

Stream URLs (`desktop()`, `browser()`, `host --private` tokens) are bearer
secrets: issued on demand by a POST endpoint, short-lived, never logged, never
persisted.

## Provider design **[decided]**

Clean separation at the *entity/service* layer; a capability-flagged union at
the *provider* layer. The existing `SandboxRuntime` port already models
per-provider variance through `SandboxCapabilities` (`persistence`, `idleStop`,
`snapshots`, ...), so the GUI/headless matrix the design must absorb —
non-GUI sandbox providers, GUI-capable VM providers, providers that do both —
is one more capability, not a second interface hierarchy.

- `@overlay/sandbox-runtime` keeps `SandboxRuntime` unchanged for headless
  providers; `capabilities.desktop: boolean` marks GUI-capable machines, and
  the GUI verbs live on `DesktopSandboxInstance` (`desktop()`, `fork()`) —
  implemented by instances, narrowed via `isDesktopSandboxInstance`.
- `BoxSandboxRuntime` (`src/box.ts`) implements `SandboxRuntime`; its
  instances implement `DesktopSandboxInstance` — one adapter, both surfaces.
  The box HTTP API is wrapped in a thin fetch client inside the adapter, so
  vendor shapes never cross the port.
- Adapter mapping notes: `hardTimeoutMs` → `ttlSeconds` (box's auto-archive
  ceiling; idle stop stays ours via `enforceSandboxIdleStop`), commands always
  run detached and poll `/commands/{processId}` (sync cap is 600s), `cancel()`
  kills the OS `pid`, `updateEnvironment` is emulated as an `env` prefix on
  subsequent commands, `listFiles` is emulated via `find`, `snapshot()` saves a
  named snapshot and `restore()` creates `from:` it, `port()` uses `/host`.
- Every box is created `noEnv: true` unconditionally; machines are tagged via
  `env` (`OVERLAY_WORKSPACE_ID`, `OVERLAY_COMPUTER_ID`, `OVERLAY_OWNER_*`).
- `ComputerService` (new `src/server/computers/`) owns the computer domain:
  ownership, quota, template-fork provisioning, lifecycle policy, stream-token
  issuance. It requires a runtime whose `capabilities.desktop` is true — a
  type guard at provider selection, not a parallel port.
- The `computers` entity and its API are the separation; provider
  exec/files/lifecycle semantics are not re-declared.

Why not a fully separate `ComputerProvider` port: it would re-declare ~70% of
`SandboxRuntime` (create/command/files/stop/resume/usage) and force every
GUI-capable provider to implement two parallel contracts for the same machine.

### Adding a second computer provider

The `computers.provider` column is load-bearing from day one: the adapter that
operates on an existing computer is resolved from the row's provider, not from
global config — retrofitting per-row routing after a second provider exists is
the painful version.

Adding provider "acme" is then:

1. `packages/overlay-sandbox-runtime/src/acme.ts` implementing `SandboxRuntime`
   + `DesktopSandbox` (vendor SDK wrapped in a thin `@overlay/<vendor>` client
   package — the vendor API never leaks past the adapter).
2. Register in `computerRuntimeFromEnv()` (`COMPUTER_PROVIDER=box|acme` selects
   the default for *new* computers).
3. Pass the shared conformance suite (`conformance.ts`) plus its desktop
   extension — desktop URL issuance, fork producing a new reference,
   stop→resume preserving files.
4. Nothing above the port changes: entity, API routes, settings UI, tool group.

Seams where providers genuinely differ — normalize these in the port/service,
never let vendor shapes reach the entity:

- **Stream auth**: `desktop()` returns `{ url, mode: 'webrtc' | 'vnc' |
  'other', expiresAt }`; `ComputerService` is the only issuer, so lifetime,
  embedding, and no-logging rules live in one place.
- **Fork/templates**: optional (`capabilities.templates`); providers without
  it fall back to create + bootstrap script in `ComputerService`.
- **Size tiers**: the entity owns `small | default | large`; each adapter maps
  to vendor shapes.
- **Lifecycle semantics**: `ttlSeconds` vs `idleTimeoutMs` vs vendor-specific —
  the service owns idle policy, the adapter translates.
- **Security config**: ZDR/retention requirements are adapter-level — each
  adapter validates its required config at construction and fails loudly at
  boot (the `OVERLAY_AGENT_HOST_IMAGE` missing-throws pattern), never a port
  concern.
- **GUI driver**: the default screenshot+input driver runs over `commands`,
  so it is provider-neutral; Lux remains a box-only enhancement.

## Box-specific requirements

- Every box created with `noEnv: true` under a safe-for-third-parties
  environment; per-box env tags: `OVERLAY_WORKSPACE_ID`, `OVERLAY_COMPUTER_ID`,
  `OVERLAY_AGENT_ID` when bound.
- **[decided]** Zero data retention ON — account-level dashboard toggle on the
  Overlay box account (operator step, browser sign-in required, cannot be
  API-driven). Launch prerequisite; verify it covers platform-managed
  (`no-env`) boxes.
- Provision via a template box (golden image: agent-host daemon, Chrome profile
  dirs, our in-box daemon) → `fork` per computer; fork/resume also resize, so
  `type` isn't paid at create time.
- Credentials reach a box by the member signing into sites over the desktop
  stream once; the Chrome profile persists across snapshots. No secret
  injection, no credential vaulting in v1.
- Lux is capped at 20 sessions/day/account shared across all boxes — too small
  for per-agent daily use. Default GUI driver is our own
  (screenshot + input via `commands`); Lux reserved for demo recording, or
  negotiate a platform quota with ascii.
- Treat refused `stop` as retryable (meter already paused provider-side);
  `force` only behind an explicit destructive confirm.

## Surfaces

- **Settings → Computers** (new registered settings section beside
  Environments): all workspace computers — owner, status, size, last active;
  open/stop/delete/rebuild.
- **Agent editor → Computer section** (`agentType === 'overlay'` only):
  enable/disable, size, Open desktop, reset-to-template.
- **Agent DM**: status chip + Watch affordance. v1 opens the stream in a new
  tab; v2 embeds in the right panel via `externalRightPanel` (check whether the
  Moonlight viewer permits iframing — VNC is top-level only by design).
- **Chat**: the member's personal computer attachable to a conversation.

## Agent tools

New `computer` group in `AGENT_TOOL_GROUPS` (grant-filter pattern, opt-in,
cannot exceed workspace policy):

- `computer_exec`, `computer_read_file`, `computer_write_file` — headless
  subset; can ship before GUI.
- `computer_desktop` — GUI automation via the in-box driver.
- `computer_screenshot`, `computer_open_url` — return live stream links.

## Self-host parity

`managedSandboxRuntimeFromEnv()` selects the runtime by env; a self-hosted
deploy never configures `BOX_API_KEY` → `computers` capability absent →
settings section unregistered, tool group unavailable, editor section hidden.
The port documents the contract; a community adapter (Firecracker/QEMU
computer-host) can come later without touching the entity or the UI.

## Phasing

0. **Logic layer (done)**: `DesktopSandboxInstance` port + `desktop`
   capability in `contracts.ts`; `BoxSandboxRuntime` in
   `packages/overlay-sandbox-runtime/src/box.ts` with 17 unit tests over a
   stubbed transport; `ComputerService` in `src/server/computers/` (ownership,
   access rules, quota, per-row provider routing, stream issuance) with 10
   unit tests over fakes. Live smoke coverage:
   `box.live.test.ts` + a `box` row in `live-conformance.test.ts`, gated on
   `OVERLAY_SANDBOX_LIVE_CONFORMANCE=1` + `BOX_API_KEY`. **Blocker:** the
   current `BOX_API_KEY` is scoped without `box.create` — a full-scope
   service key (`box api-key create`, or the dashboard) is required to run
   the live suite end to end.
1. **Foundation**: `computers` entity (repository, Postgres/Convex parity),
   `BoxSandboxRuntime`, capability gate, `/api/v1/computers` routes, Settings
   page — personal computers only (create/open/stop/delete).
2. **Agent binding**: `computer` editor section (Overlay agents), DM status
   chip + Watch, headless `computer_*` tools.
3. **GUI + lifecycle policy**: desktop driver tools, idle auto-stop,
   workspace quota + size caps, machine-time metering into usage/billing.
4. **Cloud harnesses**: `agentType: 'cloud'` — claude/codex/hermes/openclaw
   are preinstalled on every box; enroll via the existing agent-host
   enrollment (`ManagedAgentSandboxService` does the Daytona/Vercel version
   today). The BYO↔cloud bridge.
5. **Self-host adapter**: document the port; community adapter later.

## Open questions

- Whether the Moonlight viewer URL can be embedded (iframe) or must open
  top-level; determines whether "Watch" is a side panel or a new tab.
- Per-workspace quota defaults and which plan tier unlocks computers.
- Whether a computer doubles as the agent's `overlay_cloud` *environment*
  (same machine runs agent-host) or stays parallel to environments — leaning
  toward: a computer CAN enroll an agent-host, which is what makes Phase 4
  a configuration rather than a new substrate.
