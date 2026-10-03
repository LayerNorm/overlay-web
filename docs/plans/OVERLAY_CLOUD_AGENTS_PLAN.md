# Other agents on Overlay Cloud

Status: plan, 2026-10-01. Nothing here is built yet. "On your machine" agents (Agent Host + ACP) are mostly done; this plan covers the second subcategory: Claude Code and Codex running on a machine Overlay hosts. They are what nearly everyone uses with their own subscriptions, and most other agents are derivatives of them. Hermes and others come later.

## Goal

Pick "Other agent → Overlay Cloud" in the new-agent dialog, choose Claude Code, sign in with your own subscription, and within a minute you have a teammate that:

1. runs on its own Overlay Computer (Box), always reachable, paused when idle;
2. can start from your local agent config (CLAUDE.md, skills, commands, subagents, MCP servers);
3. can use every Overlay resource you can (files, notes, automations, connectors, MCP servers, skills, memory) through Overlay's MCP server;
4. bills only for compute when it uses your subscription or API key;
5. can talk to other agents in the workspace, Overlay agents and other agents alike.

## Principles

- **One host, everywhere.** An Overlay Cloud agent is the same Agent Host + ACP adapter that runs on a laptop, started inside a Box machine Overlay provisions. No second runtime. (This is already the design in `bring-your-own-agents-architecture.md`: the `overlay_cloud` environment kind.)
- **The machine is the agent's computer.** One Box machine per agent. Computer tools, the desktop viewer, and the harness all see the same disk (`environment-machine.ts` already treats them as one).
- **Overlay is the control plane and the record.** Runs, transcripts, approvals, billing, and lifecycle live in Overlay. The machine is cattle with a persistent disk.
- **Credentials are personal and never on the image.** Images are credential-free. Subscription tokens are delivered per run, in memory.
- **Overlay resources arrive through one door: MCP.** Every harness gets the same per-run Overlay MCP server native agents' tools come from.

## What Zuse does (and what we take)

Zuse (github.com/swarajbachu/zuse, open source) is a desktop app wrapping Claude Code, Codex, Grok, Gemini, Cursor, OpenCode, and Pi, with a cloud beta on **Box and E2B**, the same providers we chose. Relevant findings:

| Zuse | Take / skip |
| --- | --- |
| **Account image → project → workspace.** One private, prebuilt image per account (runtime, toolchains, repos, agent auth). New workspaces fork it; no launch-time installs. | **Take, adapted.** One credential-free Overlay base image (Agent Host + pinned harness CLIs + common toolchains). Agent machines boot from it. Per-agent customization (imported config) is applied on top, not baked into images. |
| **Desired-state lifecycle with a leased reconciler.** States `queued → provisioning → setup → ready ↔ paused → archived → deleted`, compare-and-set revisions, idempotent commands. | **Take.** Our leases (`AgentSandboxLease`) become a revisioned desired-state machine reconciled by one worker, not imperative route code. |
| **Startup phases shown to the user**: allocating, booting, authenticating, syncing, starting the agent, running. | **Take** for the agent's first boot and every wake. |
| **View ≠ wake.** Reading a transcript never resumes compute; sending a message does. | **Take.** Transcripts live in Overlay already, so only a new turn wakes the machine. |
| **One-time boot token → scoped runtime credential.** The sandbox never holds a reusable account credential. | **Take.** Replaces the human verification phrase for managed environments (auto-enrollment). |
| **`CloudAuthAuthority`: account-level provider credentials.** Claude: paste a `claude setup-token` token (or API key). Codex/Grok: device-code login run inside a dedicated auth machine that owns the only refresh-token copy, serializes refresh, and seals short-lived grants to each workspace's key. | **Take in two steps.** Step 1: Claude setup-token + API keys, injected per run. Step 2: a credential broker for providers with rotating refresh tokens (Codex). |
| **"Subscription \| API key" tabs per provider** in settings; auth errors classified as recoverable ("reconnect"), rate limits shown with reset time. | **Take** the UI pattern. |
| **Agent-to-agent as control-plane MCP tools**: `list_threads`, `create_thread`, `send_to_thread`, `read_thread`, `whoami`, gated by an autonomy level. Cross-provider delegation through an MCP bridge because the SDKs don't know each other. | **Take the shape**, scoped to workspace agents and conversations instead of git threads, with hop limits and budgets. |
| **Git worktrees per task, repo-centric UX, PR review.** | **Skip for now.** Overlay agents are workspace teammates, not repo task runners. Repos can come later as an imported resource. |
| **Encrypted transcript checkpoints in R2, mailbox Durable Object.** | **Skip.** Overlay's Convex run store and the bridge protocol's durable commands already give us this. |

## What we already have

| Piece | Where | Reuse |
| --- | --- | --- |
| Agent Host (CLI/daemon), ACP adapters for Codex, Claude Code, Hermes | `packages/overlay-agent-host` | Runs inside the machine; its ACP layer is replaced by `acpx/runtime` (see below). |
| Agent Bridge Protocol: enrollment, signed polling, durable commands, events | `packages/overlay-agent-bridge-protocol`, `ConnectedAgentControlPlaneService` | Unchanged; add a managed enrollment path. |
| `overlay_cloud` environment kind, sandbox leases, lease billing | `connected-agents.ts`, `ManagedAgentSandboxBilling`, `environment-machine.ts` | Leases + compute billing exist; `modelUsageBilling` already skips model charges for cloud runs. |
| Box sandbox runtime: create from image, snapshot, restore, fork, pause/resume, exec, writeFiles, ports | `packages/overlay-sandbox-runtime/src/box.ts` | Machine provisioning and lifecycle. |
| Computers on Box (sizes, desktop viewer, lifecycle UI) | `src/server/computers/*`, Settings → Computers | The agent's machine is a Computer row owned by the agent. |
| Overlay MCP server with per-run `ovmcp_` tokens | `/api/agent-mcp`, `agent-mcp-tools.ts` | Already serves the native agent pipeline's tools to harnesses. |
| New-agent dialog with "Other agent" disabled | `NewAgentDialog.tsx` | Enable the Overlay Cloud path. |

What is missing: a base image, managed enrollment, the lifecycle reconciler, provider accounts, config import, agent-to-agent tools, and the agent page around a cloud agent.

## Adopt, don't build: acpx + the ACP Registry

Researched 2026-10-01. Two open-source pieces cover most of the agent-session layer we would otherwise write:

| Candidate | What it is | Verdict |
| --- | --- | --- |
| **acpx** (`openclaw/acpx`, MIT, ★3.3k, v0.19.4, releases near-daily) | Headless ACP client with a programmatic runtime (`acpx/runtime`): persistent and resumable sessions, prompt queueing, cancel/steer, permission and elicitation callbacks, model inspection, usage reporting, 25 built-in agent definitions (Claude Code, Codex, Gemini, Copilot, Cursor, OpenCode, Pi, Grok Build, Kiro, Qwen, Droid, Devin, …). | **Adopt as the Agent Host's session engine.** |
| **ACP Registry** (`agentclientprotocol/registry`, Apache-2.0, maintained by the ACP project) | Machine-readable catalog of 41 ACP agents with install/launch commands (22 npx, 19 binaries, 2 uvx) at `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`. | **Adopt as the agent catalog** for "which agents can I bring" and for installing them on a machine. |
| Claw Orchestrator (★587, MIT) | Wraps CLIs as sessions plus councils, planner/coder/reviewer loops, 78 tools, OpenAI-compatible endpoint. | **Skip.** Its orchestration layer is what Overlay itself is; it wraps CLIs rather than being ACP-first. |
| coder/agentapi | HTTP API over agent CLIs via terminal emulation. | **Skip.** Archived 2026-09-13; screen-scraping. |
| Jockey, AgentConnect, kodizm/acp | Desktop apps or small single-author bridges. | **Skip.** |

**Why acpx fits our host specifically.** Its runtime options map one-to-one onto what the bridge needs, all supplied by the embedding host:

- `sessionStore` is pluggable (`load`/`save`), so session records can live where the host keeps state today (or be mirrored to Overlay).
- `mcpServers` accepts a resolver called per session connection and never persisted: the per-run Overlay MCP server (`ovmcp_` token) plugs in here.
- `agentProcessEnv` is a child-only environment, snapshotted and never persisted: the per-run provider grant (`CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`) goes here. One machine per agent means one runtime per credential set.
- `onPermissionRequest` / `onElicitation` callbacks become Overlay approval cards and questions in the conversation.
- `agentRegistry` is replaceable, so we can merge acpx's built-ins with ACP Registry entries and pin versions ourselves.

**What changes in our code.** The Agent Host keeps everything Overlay-specific: enrollment, the Agent Bridge Protocol transport, signed polling, command claiming, event normalization to Overlay's run events, filesystem grants, launchd/daemon. It replaces its own ACP layer (`acp-adapter.ts`, `adapter-manifests.ts`, the session parts of `runtime.ts`, about 550 lines) with `acpx/runtime`. The on-your-machine host gets the same upgrade for free, so both subcategories support every acpx/registry agent at once.

**What it does not remove.** Each agent's own sign-in (subscriptions, keys) still differs per vendor, so "supported" at launch still means Claude Code and Codex with first-class accounts. Other registry agents can be offered as experimental "bring your own key" agents once the engine is in.

**Risks and mitigations.**

- Pre-1.0 API: pin an exact version, wrap it behind the host's existing `adapter.ts` interface, and run our host tests plus acpx's conformance suite on every bump.
- Node ≥ 22.13: matches the base image and the host's Node requirement.
- Upstream direction: acpx's stated vision is "the smallest useful ACP client" and "a reusable backend for tools", which is our use; we can fork if that changes (MIT).

**Spike before Phase 0 (1–2 days):** put `acpx/runtime` behind `adapter.ts` in a branch; run a Claude Code and a Codex turn through the bridge locally with the Overlay MCP server injected via `mcpServers` and credentials via `agentProcessEnv`; then the same inside a Box machine. Go if session resume, cancel, permission round trip, and MCP tool calls all work.

## Architecture

```text
Overlay (Next.js + Convex)                         Box machine (one per agent)
┌──────────────────────────────────┐               ┌──────────────────────────────────┐
│ New-agent dialog / agent page    │               │ Overlay base image (no secrets)  │
│ Lifecycle reconciler ────────────┼─ Box API ───▶ │  Agent Host (daemon)             │
│   desired state, revisions       │               │   acpx runtime → claude-agent-acp│
│ Bridge control plane ◀───────────┼── outbound ── │                → codex-acp       │
│   runs, commands, events         │   HTTPS only  │ Provider accounts vault ─────────┼─ per-run ───▶ │  ~/.claude, ~/.codex (profile)   │
│   (setup-token, API keys, broker)│   grant       │  /workspace (persistent disk)    │
│ Agent profiles (imported config) ┼─ apply ─────▶ │                                  │
│ Overlay MCP /api/agent-mcp ◀─────┼── MCP ─────── │  harness calls Overlay tools     │
└──────────────────────────────────┘               └──────────────────────────────────┘
```

### Machine and lifecycle

- **One machine per agent**, created on agent creation, stored as a Computer row with `ownerType: 'agent'` and an `overlay_cloud` environment bound to the agent. Sizes reuse Computer sizes.
- **Desired states**: `ready`, `paused`, `deleted`. Observed: `queued → provisioning → setup → ready ↔ pausing/paused/resuming`, `failed`, `deleting → deleted`. One leased reconciler (Convex scheduled action or workflow) moves observed toward desired with compare-and-set on a revision. Routes only record intent.
- **Wake on work, pause on idle.** A turn for a paused agent sets desired `ready`; the reconciler resumes the same sandbox and waits for the host to reconnect, then the queued command is claimed. Idle 15 minutes (existing `MANAGED_SANDBOX_IDLE_TIMEOUT_MS`) → pause. Opening the transcript never wakes it.
- **Startup phases** reported by reconciler and host: Allocating → Booting → Connecting → Signing in → Ready. Shown in the dialog after Create and on the agent page.

### Base image: one definition, two targets

Boat (Box's new name) machines already ship a system layer: Ubuntu 24.04, Node 24, Python/uv, Go, Rust, Java, Docker, Chrome, ffmpeg, `gh`, and the Claude Code, Codex, OpenCode, Hermes, Cursor, Pi, OpenClaw, Kimi, and Prime CLIs (docs.boat.dev/machines). That layer is free in snapshots. We use it, and add a small pinned **Overlay layer** on top:

- **Use from Boat's system layer:** toolchains, and agent CLIs that are their own ACP server or needed for sign-in (`hermes acp`, `opencode acp`, `openclaw acp`, Cursor, Kimi, and the `codex` CLI for device-code login later).
- **Add in the Overlay layer (pinned exact versions):** the Agent Host, `acpx`, and the ACP adapters for the launch agents (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`). These bundle their own engines, so the preinstalled `claude`/`codex` binaries are not what runs a session, and Boat's unpinned system versions can change under us. Anything an agent needs that the system layer lacks is installed here too.
- **Drift guard:** the host's `doctor` checks system CLI versions against a supported range and falls back to the Overlay layer's pinned copy when a system CLI drifts out of range.

One script, `infra/agent-image/provision.sh`, defines the Overlay layer and writes `/etc/overlay/image.json` (image version, pinned versions). Two publishers run it:

| Target | How | Result |
| --- | --- | --- |
| Boat (Overlay Cloud) | Boat has no custom-image API, so `publish-boat.ts` provisions a fresh machine, runs `provision.sh`, verifies, and freezes it as a named snapshot `overlay-agent-v<N>` (Zuse does the same with `box-publish.sh`). Agent machines are created `from` that snapshot; the adapter already supports this. | Named snapshot per version |
| E2B (self-hosted) | `build.e2b.ts` uses E2B's template builder (`Template().fromImage(...)` or a Dockerfile, then `runCmd('bash provision.sh')`), built with `Template.build(template, 'overlay-agent', { tags: ['v<N>'] })` against the operator's E2B API. | Template `overlay-agent:v<N>` |

Rules for both:

- **Credential-free**, enforced in CI (no `~/.claude/.credentials.json`, `~/.codex/auth.json`, tokens).
- **The host is not running in the image.** No start command bakes a host into the snapshot; the reconciler starts it at machine creation with the boot token, so a snapshot never contains an enrolled identity.
- **Mandatory, not optional.** The sandbox adapters take the image from server config only (`providers.sandbox.agentImage`: snapshot name for Boat, template name and tag for E2B), never from a request. At boot the host reads `/etc/overlay/image.json` and refuses to enroll if the image version is outside the control plane's supported window, so an unprepared sandbox cannot become an agent machine.
- **Versioned rollout.** The environment records its image version; new agents get the current one, existing agents keep theirs until Update.
- **CI publishes both** on release and runs one conformance check per target: boot, `overlay-agent-host doctor`, one fake ACP turn.

For self-hosters, setup is one documented step: run `npx tsx infra/agent-image/build.e2b.ts` against their E2B, then set `providers.sandbox.agentImage`. Overlay's startup check fails clearly if the template is missing or its `image.json` version is unsupported.

### Managed enrollment

- The reconciler mints a one-time, 10-minute **boot token** bound to workspace, environment, and image version, and passes it to the machine at create (env or `writeFiles`).
- The host's first start exchanges it (with its Ed25519 key) for the normal short-lived environment credential. No verification phrase: Overlay created the machine, so there is no human to confirm. The token is deleted after use.
- Filesystem grant is fixed to `/workspace` and the harness home.

## Workstream 1: Subscriptions and API keys (requirement 3)

**Provider accounts** are personal, stored per user, and selected per agent.

| Provider | Subscription | API key |
| --- | --- | --- |
| Claude Code | Paste a token from `claude setup-token` (run on your own computer). Delivered as `CLAUDE_CODE_OAUTH_TOKEN`. Long-lived, no refresh. | `ANTHROPIC_API_KEY` |
| Codex | ChatGPT sign-in via device-code flow. Refresh tokens rotate, so one holder must own refresh (step 2: broker). | `OPENAI_API_KEY` |

- **Vault**: secrets encrypted at rest (envelope encryption with a dedicated key, like `SESSION_COOKIE_ENCRYPTION_KEY`), never returned to the browser after save, never written to the image or disk.
- **Delivery**: per run, the control plane attaches a short-lived grant to the start command; the host passes it to the adapter process environment only. Same path the `overlayMcp` metadata uses today.
- **Codex subscription (later)**: Zuse's design. The device-code login runs once inside a small per-user auth machine (or in the control plane if Codex supports an exportable token exchange). That holder refreshes serially and issues short-lived access grants to agent machines. At launch, Codex on Overlay Cloud uses an API key; Codex subscriptions are added after launch (they already work for Codex on your own machine).
- **Who pays**: a cloud agent runs on its **creator's** account. Model usage on a subscription or own key is not charged by Overlay; compute (the lease) is.
- **Sharing is the creator's call.** Making a subscription-backed agent "Everyone in this workspace" means teammates use the creator's subscription; "Only me" keeps it private. The Access control's info tip says this plainly; no extra gate.
- **Errors**: auth failures and expiry are a distinct, recoverable state ("Claude sign-in expired — reconnect") on the agent and in chat, not a generic run failure. Rate limits show the reset time.

## Workstream 2: Every Overlay resource through MCP (requirement 2)

The Overlay MCP server already exposes the native agent's tool pipeline to connected agents. For cloud agents:

1. **Always attached.** Every cloud run's start command carries an `ovmcp_` token; the host registers the server with the harness (`claude mcp add --transport http`, Codex `config.toml` `[mcp_servers]`). Already true for connected agents.
2. **Coverage audit** against tool groups: memory, knowledge, files (read/write/move), notes (patch-style), automations, connectors (`integrations`), user MCP servers (`mcp`), skills, web search, image/video. Computer tools stay withheld over MCP because the harness is already on the machine. Fill the gaps found; add a contract test that every agent tool group has an MCP path or an explicit withhold reason.
3. **Skills natively, too.** Overlay skills are also materialized into the harness's own skill directory (`~/.claude/skills/<name>/SKILL.md`) at run start, so Claude Code uses them natively. MCP prompts remain the cross-harness path.
4. **Approvals.** Tools that need approval today return `MCP_APPROVAL_REFUSAL`. Replace with a real round trip: the MCP call parks, Overlay shows an approval card in the conversation, and the result returns when the person decides (timeout → refusal).
5. **Scope.** Token = invoking human's permissions ∩ the agent's tool grant, valid for the run only. Unchanged.

Files: MCP-first. A mirrored `./overlay` folder (built once and removed with Vercel Sandbox) can return later as an option if agents need bulk local file access.

## Workstream 3: Import agent config (requirement 1)

An **agent profile** is a versioned bundle of harness config, stored in object storage and applied to the machine.

**What is imported (allowlist), per harness:**

| Claude Code | Codex | Never |
| --- | --- | --- |
| `CLAUDE.md`, `settings.json` (sanitized), `agents/`, `commands/`, `skills/`, `output-styles/`, MCP servers from `~/.claude.json` | `config.toml` (sanitized), `AGENTS.md`, `prompts/` | `.credentials.json`, `auth.json`, keychain, shell history, project transcripts, caches |

**Two ways in:**

1. **From your machine** (preferred). `npx @layernorm/overlay-agent-host export-config claude` (or a button that copies that command) collects the allowlist, strips secrets, and uploads it to the agent with a one-time code. Reuses the host package people already install for on-your-machine agents.
2. **Upload** a folder or zip in the dialog/agent page for people without the host.

**Safety:**

- Sanitize: drop `env` keys, `apiKeyHelper`, `awsAuthRefresh`, and anything matching secret patterns. MCP server headers/env values that look like secrets become **prompts**: "This MCP server needs `GITHUB_TOKEN` — add it to the agent's secrets" (stored in the vault, injected per run).
- Hooks are code; imported hooks are listed and off until the person turns them on.
- Preview before apply: a file list with what was dropped and why.
- Apply at provision and on change (writes `~/.claude/...` via `writeFiles`), and re-apply on image update. Profiles are versioned so a bad import can be rolled back.

Stdio MCP servers in an imported config run inside the machine (egress is open), so `npx`-based servers work as on a laptop.

## Workstream 4: Agents talk to each other (requirement 4)

Today only human messages trigger agents (`mention-policy.ts`). Agent-to-agent becomes an Overlay feature, so it works the same for native agents (as tools) and other agents (via MCP):

**Tools** (native tool group `agents` + Overlay MCP):

- `list_agents()`: agents the invoking human can see, with a one-line description and kind.
- `ask_agent(agent, message, { wait })`: start or continue a thread with another agent; with `wait`, return its reply; without, return a handle.
- `read_agent_thread(handle)`: read the latest reply.
- `post_message(conversation, text, mentions?)`: post into a channel/DM the human can access; mentions of agents trigger them under the rules below.

**Rules:**

- **On behalf of the root human.** Every agent-triggered turn carries the original human principal; the target runs with that person's permissions ∩ its own grant, bills to the same place, and appears in that person's audit.
- **Hop limit** 3 per root human message, **no self-calls**, cycle detection (agent A → B → A stops), and a per-root budget (turns and spend). Exceeding any returns a clear tool error.
- **Visibility.** An agent can only address agents and conversations the root human can.
- **Lineage in the UI.** Agent-triggered messages show "asked by Scout" with a link to the parent turn.
- **Agent-authored mentions** in channels trigger agents only through `post_message` (so the rules apply), never by an agent typing `@name` in its reply text.

## Workstream 5: Interface

**New-agent dialog**: enable "Other agent". With "Runs on: Overlay Cloud":

1. Agent: Claude Code / Codex.
2. Account: the person's connected account for that provider, or inline "Connect" (Zuse's Subscription | API key tabs; Codex shows API key only at launch). Required before Create.
3. Computer: size (the machine is required for cloud agents, so no toggle).
4. Config (optional): "Import from your machine" (copy command, waits for upload, shows the preview) or upload.
5. Access: defaults to Only me. Choosing Everyone shares the creator's account usage with the workspace (stated in the info tip).

After Create the dialog shows startup phases until Ready, then opens the agent's conversation.

**Agent page** for a cloud agent adds:

- Status: Ready / Paused / Starting (phase) / Needs sign-in / Failed, with Pause, Resume, and Restart.
- **Machine**: size, image version (Update available), Open desktop (existing Computer viewer), disk usage.
- **Config**: the active profile, editable `CLAUDE.md`, re-import, version history.
- **Account**: which account it runs on, reconnect.
- **Activity**: recent runs, compute minutes, agent-to-agent lineage.

**Conversation**: the existing ACP event rendering (tool calls collapsed and sequential), plus permission requests as inline approval cards, auth-expired and rate-limit bubbles with actions, and the bottom loading dots while the machine wakes.

**Settings → Accounts**: personal provider accounts (Claude Code subscription or key, Codex key), status, last used, remove. **Settings → Computers** keeps listing agent machines.

## Billing

- Compute: existing lease meter (`ManagedAgentSandboxBilling`) at Box rates per running minute; paused machines cost storage only. Shown on the agent page.
- Model usage: free when on the person's subscription or key (`modelUsageBilling: false` for `overlay_cloud`, already in place). An Overlay-billed model option (our gateway key) can come later.
- **Free tier**, by agent kind:

  | | Free | Paid |
  | --- | --- | --- |
  | Overlay agents | Yes, with free models and free tools only. Paid tools (and the Computer) are shown but blocked with an upgrade hint. | All models and tools |
  | Other agents on your machine | Yes (the machine is yours) | Yes |
  | Other agents on Overlay Cloud | No: a computer is a paid resource | Yes |

  In the new-agent dialog, a free-tier user sees "Overlay Cloud" disabled with an upgrade hint, the Computer toggle disabled, and paid tools locked in the tool list. The server enforces the same rules (tool grant filtering and computer provisioning), not only the UI.

## Security

- Images credential-free (CI-tested). Boot token single-use. Provider grants per run, in process memory only.
- The machine holds no Overlay secrets other than the run-scoped `ovmcp_` token and its environment credential, both short-lived and revocable.
- Egress is open (decided earlier for Box). Mitigation is that nothing durable worth stealing lives on the machine.
- Deleting an agent deletes its machine, profile, and per-agent secrets; revoking an account invalidates future grants immediately.

## Phases

**Prerequisite (done 2026-10-01): Boat API migration.** Box renamed itself Boat; the legacy Box endpoints advertise a 2026-10-31 sunset. The adapter now targets `https://boat.dev/api/v1`, so Phase 0's image work targets Boat only.

**Phase 0 status (2026-10-02): done and verified end to end.**

Completed:

- [x] acpx engine in the Agent Host (`AcpxAgentAdapter`, `--engine acpx`, acpx 0.19.2), with `image-check` gating managed enrollment. On-your-machine hosts unchanged.
- [x] Overlay agent image: `infra/agent-image/provision.sh` + `publish-boat.mts`, published as Boat snapshot `overlay-agent-v1` (host 0.3.7, claude-agent-acp 0.81.1, codex-acp 1.13.1). E2B template script not written yet (no E2B adapter; part of Phase 6).
- [x] Managed enrollment: single-use code redeemed by the host on boot, environment auto-approved with the fixed `/home/user/workspace` grant, lease created, agent bound (`CloudAgentMachineService`, `POST /api/v1/agent-environments/cloud`).
- [x] Lifecycle: idle-stop via the lease meter (turns hold `activeUntil`), wake on every Overlay Cloud turn (resume + restart host), delete via revoke + reaper.
- [x] Startup phases: surfaced in Phase 2 (provisioning is now asynchronous with a durable phase record).

Verified live (local dev server on dev Convex, exposed with a cloudflared tunnel, real Boat machines):

- Provisioning end to end in 12–15 s: machine from `overlay-agent-v1`, host enrolled, credential issued, environment approved, agent bound.
- An @mention in the agent's thread answered by Claude Code on the machine ("cloud-ok"), through the remote-run path, acpx, and the Overlay MCP server URL.
- Wake: machine stopped, next message sent, server woke it (`outcome: resumed`), host restarted, reply "wake-path-ok" ~25 s after the message, with no manual help.
- Idle-stop: the reconcile job's lease meter stopped the idle machine on its own (15-minute idle window; the machine read `stopped` afterwards and the lease stayed `running` for the next wake).
- Model credentials were injected into the host config by the test (Phase 1 delivers them per run).

Fixes found by the live run:

- The machine's server URL came from the request origin, which behind a proxy or tunnel is an internal host. It now uses the configured app URL (`getBaseUrl()`), like the MCP URL.
- Wake only fired when the environment read offline, but a just-stopped machine still reads online for a heartbeat window. Every Overlay Cloud turn now checks its machine (a no-op when running with a live host).
- Boat's `~/.claude` and `~/.codex` are provider mounts that error without Boat-linked credentials, so agent config lives under `~/.overlay` (Phase 4 imports go there). The Boat adapter dropped a command's own `environment` (fixed).
- Remote runs also need `OVERLAY_FEATURE_REMOTE_AGENT_RUNS` (with the connected-agent control plane flag and rollout stage); provisioning should become asynchronous with visible startup phases in Phase 2 (Cloudflare and some proxies cut requests at 100 s).

**Phase 1 status (2026-10-02): done and verified end to end.**

- [x] Settings → Agent accounts (connect, reconnect, rename, remove; "Needs reconnecting" state), Claude Code via `claude setup-token` or API key, Codex via API key.
- [x] Credential vault: secrets in `ByokCredentialStore` (WorkOS Vault live-tested for create, update, delete); Convex `agentProviderAccounts` holds metadata and the opaque reference only; no response, log line, command, or event carries a secret.
- [x] Per-run delivery: `agent:run-credentials` host method (Overlay Cloud environments only), `POST …/run-credentials`, host fetch per run, one acpx runtime per run, in-memory only.
- [x] Binding records the account and its chooser; the cloud route requires `providerAccountId` and validates it before booting a machine.
- [x] Auth-error state: `auth_required` failure code, account flagged, nothing released until reconnected.
- [x] Image v2 published (the protocol change made v1 hosts unable to parse Overlay Cloud credentials; v1 deleted).

Verified live (local server on dev Convex, tunnel, real Boat machine, real WorkOS Vault): connect an account (secret never echoed), refusal of an API key pasted as a subscription token, provision a machine on the account in 12 s, the credential present in the Claude Code process environment during the run, Claude Code rejecting a deliberately fake token with a 401, the account flagged `needs_reauth`, reconnect clearing it, and cleanup (account deleted from the vault, environment revoked, machine deleted). Not verified: a run on a real working subscription token or API key, because none was available; the delivery path is the same one the fake token used.

Known gaps:

- The chat shows Claude Code's own text for the failure ("Failed to authenticate…"). The agent page now shows "Needs sign-in" with a Reconnect button (Phase 2); a reconnect prompt inside the conversation itself is still open.
- ~~Account deletion removed rows but not their vault secrets.~~ Fixed: `AccountDeletionService` now deletes every stored credential (agent accounts and model-provider keys) from the vault before the rows go, and stops if one cannot be deleted so a secret is never orphaned.
- Codex subscriptions need the credential broker (after launch).

**Phase 2 status (2026-10-02): built and verified through the API; the UI is checked structurally only (see below).**

- [x] Provisioning is asynchronous: `POST /api/v1/agent-environments/cloud` returns 202 at once and provisions after the response (`after()`); progress is a durable Convex record (`cloudAgentProvisions`: queued → allocating → booting → connecting → ready, or failed with a safe message), so any server instance can answer the poll. A second create while one is starting reports the current phase instead of booting another machine; a failed or lost (10 minutes without moving) start can be retried.
- [x] Paid plans only: the create route returns `paid_plan_required` (403) for free plans. Free plans keep Overlay agents and their own machine.
- [x] `GET/POST/DELETE /api/v1/agents/{agentId}/machine`: status (one provider read), pause / resume / restart, and delete (revokes the environment, deletes the machine at once, clears the record).
- [x] New-agent dialog: "Other agent" is enabled where the deployment supports it (new `cloudAgents` capability = control plane + Overlay Cloud + remote runs). Fields: Agent (Claude Code / Codex), Runs on (Overlay Cloud / Your machine), Account (with inline "Connect an account…"), Machine size, Access. Creating shows the startup steps and opens the conversation when the agent is ready; closing mid-start keeps the agent starting. "Your machine" opens the existing full editor, where the connect command and approval live. A failed first start archives the just-created agent so none is left without a machine.
- [x] Agent page: a Machine section replaces the behavior fields for cloud agents: state (Ready, Paused, Starting, Needs sign-in, Failed, Unavailable), startup steps, size, account, Pause / Resume / Restart / Try again, and a Reconnect button when the account needs it. Saving a cloud agent no longer rewrites its binding (that would drop the account); archiving deletes the machine first.

Verified live (local server on dev Convex, tunnel, real Boat machine): create returns 202 in the request, phases advance to ready in 36 s, a second create reports the current phase, pause reads `paused` with the machine stopped, resume and restart return to `ready`, a bad action is a 400, delete leaves no machine on Boat and reads `unavailable`. 8 service tests, 4 Convex tests, and dialog tests cover the rest.

Known gaps:

- ~~The dialog does not hide Overlay Cloud for free plans.~~ Fixed: on a free plan the "Other agent" option reads "Paid plans" and is disabled (the server still enforces).
- The create and agent-page UI was rendered only in a signed-out browser session, so the full click-through (including a visual pass) is still to do by hand: create → progress → conversation, then Pause / Resume / delete on the agent page.
- ~~No reconnect prompt inside the conversation.~~ Fixed: a sign-in failure shows the reconnect message with a link to Agent accounts instead of the agent's raw error. Conversation cards for runs are still open (to land with Phase 3's approval round trip).

**Phase 3 status (2026-10-02): done and verified on production (getoverlay.io), with a real Claude Code subscription.**

- [x] **Overlay MCP for other AI apps** (added to the scope at the owner's request): `/api/mcp` with OAuth 2.1 (dynamic registration, PKCE, rotating refresh), a consent page, personal tokens, `mcpGrants`, and Settings → Connected apps. Three access levels (read, write, everything) that only narrow what the workspace allows. See `docs/develop/mcp-access.md`.
- [x] **Coverage audit**: every tool an outside app or connected agent can hold was called against the dev backend; the audit found and fixed `list_notes` (broke on the notes API's page envelope) and `update_automation` / `pause_automation` / `delete_automation` (the tool's own id was erased by an empty one). Not executed because they spend money or need a third party: web search/fetch, image/video, the browser, `call_mcp_tool` (the one configured server's catalog is stale; a "test connection" refreshes it), Composio execution. Contract test `mcp-coverage.test.ts` fails when a tool group is added without an MCP decision.
- [x] **Skills**: offered as MCP prompts to every client that shows prompts (verified with the official SDK). Writing into the harness's own skill folder was not needed and was left out.
- [x] **Approvals**: a connected agent's MCP call that needs approval shows an approval card in the conversation and gets the answer (short wait, then "call again"); denial and run end refuse. Verified by Convex tests (card, authorization, option check, no host command, run end closes it) and gate unit tests, not by a live run.
- [x] **Scope**: unchanged: token = invoking person ∩ the agent's grant, for the run only.

**Production verification (2026-10-02, owner's signed-in browser, real Boat machines, real subscription):**

- The official MCP SDK client signed in through the real consent page (discovery, registration, PKCE, tokens) and made note, file, memory, and prompt calls; personal tokens and OAuth connections were disconnected from Settings and stopped working at once; DCR accepts the real Claude web and ChatGPT callback URLs; automation tools and `call_mcp_tool` (DeepWiki) work.
- A cloud Claude Code agent created from the dialog reached Ready, answered a real message, listed 54 notes, created, read back, and deleted a note through Overlay's MCP tools, and ran a user MCP server tool through `call_mcp_tool`. Overlay's own approval card (gate on a tool with an approval-required policy) was shown, approved after 19 s, and the call ran. Pause and resume, the sign-in failure with its reconnect link, and the agent page's Machine section were checked too.

Bugs found by that run, all fixed and deployed:

- The machine's host enrolled but got 401 on every signed request: prod's app URL (`getoverlay.io`) redirects to `www`, and a cross-origin redirect drops `Authorization`. Machine-facing URLs now come from `OVERLAY_AGENT_PUBLIC_URL` (prod: `https://www.getoverlay.io`). MCP/OAuth metadata is built from the host the client called.
- The create dialog stopped polling when provisioning finished (before the host was online) and hung on "Starting".
- A machine started with credit under the meter's low-balance floor was deleted within a minute; creation now refuses up front (402 `insufficient_credit`), and the agent page explains a stopped machine.
- An agent created from the dialog had an empty tool grant, so its MCP server exposed no tools. Cloud agents now default to Everything and the agent page has an **Overlay access** control (None, Read only, Read and write, Everything); Save no longer rewrites the grant.
- Consent defaults to Read and write when an app asks for every scope.

Known gaps:

- ~~Budget holds stuck in `reconcile_required` made remaining credit read far below allowance minus spend.~~ Fixed 2026-10-02: an hourly sweep settles holds older than 6 hours (overruns charged what was held, failed calls released); see `docs/develop/billing-holds-and-machine-metering.md`. The failures that create holds (memory-profile schema errors, billing write conflicts, a provider path) are tracked in a separate task.
- An approval is remembered per run: if the person answers after the agent has given up waiting (25 s), the next turn asks again.
- Strict OAuth clients must use the `www` address (the apex redirects).
- No "run now" automation tool: agents can create, update, pause, and delete automations (verified), but an automation runs on its schedule.
- Hosted ChatGPT and Claude web were not connected by me (only their callback URLs were registered); everything else in the flow ran with the official SDK client and Claude Code.

| Phase | Ships | Exit criteria |
| --- | --- | --- |
| **0. Machine** | acpx spike and adoption in the Agent Host, Overlay layer (`provision.sh`) published as a Boat snapshot (E2B template build script alongside), managed enrollment, lifecycle reconciler (create, wake, pause, delete), startup phases | A Claude Code agent created behind a flag boots on Box, answers an @mention, pauses after idle, wakes on the next mention. |
| **1. Accounts** | Settings → Accounts, vault, per-run grants, Claude Code setup-token or API key, Codex API key, auth-error states | Runs on a Claude Max setup-token with no model charge; expired token shows "reconnect" and recovers. |
| **2. Dialog + agent page** | "Other agent → Overlay Cloud" enabled, agent page tabs, conversation cards | A teammate can create, use, pause, and delete a cloud agent without docs. |
| **3. Overlay resources** | MCP coverage audit + contract test, native skills sync, real approval round trip | The cloud agent can read/write files and notes, run an automation, use a connector and a user MCP server, and ask for approval. |
| **4. Config import** | `export-config` in the host, upload path, sanitizer, preview, versioned profiles | Importing a real `~/.claude` reproduces skills, commands, subagents, and MCP servers in the cloud agent with no secrets copied. |
| **5. Agent-to-agent** | `agents` tool group + MCP tools, root-principal propagation, hop/budget limits, lineage UI | An Overlay agent asks the cloud Claude Code agent to do something and gets the answer; a cycle is stopped. |
| **6. After launch** | Codex subscription via a credential broker; Hermes and other agents; E2B adapter for self-hosting | Two Codex cloud agents on one ChatGPT account run without breaking each other's refresh. |

Phases 3 and 5 don't depend on 0–2 for native agents and can start in parallel.

**Phase 4 status (2026-10-02): done and verified on production, except Codex.**

- [x] Shared sanitizer in `@layernorm/overlay-agent-bridge-protocol` (allowlist, secret placeholders, hooks held back), run on the computer, on upload, and when a stored bundle is read.
- [x] `export-config <claude-code|codex> --server --code [--dry-run] [--home]` in `@layernorm/overlay-agent-host`; folder upload in the agent page (Config section); one-time `ovprof_` codes; staged preview with counts, left-out items with reasons, needed values, and hooks.
- [x] Apply writes `~/.claude` (or `~/.codex`), merges MCP servers into `~/.claude.json`, tracks what it owns, and rolls back to any of the last 10 versions. Needed values live in the credential vault and reach the agent per run.
- [x] Exit criterion met on production: a real `~/.claude` imported and its skill invoked on the cloud agent, no secrets copied. Details in `docs/develop/agent-profiles.md`.

Found by the live run: acpx ignores `~/.claude` unless `ACPX_CLAUDE_INCLUDE_USER_SETTINGS=1` (now set where the host starts; the earlier assumption that config lives under `~/.overlay` was wrong for Claude Code); a run cut off by a pause or restart blocked the machine until the sweep learned to fail abandoned cloud runs after 15 minutes; the export command needs Node 24 (the copied command pins it).

Also found and fixed: machines idle longer than 15 minutes could not wake (expired host credential could not refresh), and a hole in the host's command numbers rejected every later command. Verified: wake after idle, a stdio MCP server from a profile, rollback removing the later version's files.

Known gaps: Codex import untested live (needs a Codex API key). Restarting a host mid-run still fails that run, now immediately and with a message.

**Phase 5 status (2026-10-03): built and verified on production.**

- [x] `agent_chat` tool group (`list_agents`, `ask_agent`, `read_agent_reply`) for native agents and, over MCP, for Claude Code / Codex cloud agents; withheld from outside apps.
- [x] The asked agent runs for the same person (their access, their billing, their audit), in a visible group conversation; the question carries a lineage read back from the database.
- [x] Hop limit 3, no self-asks, cycle refusal, 3 asks per turn, 12 per root message; refusals are plain tool errors.
- [x] UI: "Agent question · step N of 3" in the room view.
- [x] Exit criterion met: an Overlay agent asked the cloud Claude Code agent and got the answer; the reverse worked over MCP; a cycle was stopped.

- [x] `post_message` (post into a room the agent is in, mention agents there), a per-chain token budget, "see where it came from" links, outside apps asking agents as the person, and agent conversations opening in the room view from a plain link.

Details and what the live runs found: `docs/develop/agent-to-agent.md`. Not built: a spend limit in money (tokens only), and posting into a room the agent is not already in.

## Decisions (2026-10-01)

1. **Sharing subscription-backed agents is the creator's choice.** "Everyone in this workspace" shares their usage; "Only me" keeps it private. No extra restriction.
2. **Free tier:** Overlay agents with free models and free tools only (paid tools blocked); bring-your-own agents on your own machine allowed; no Overlay Cloud agents and no Computer, since a computer is paid.
3. **Launch scope:** Claude Code and Codex only. Claude Code with a subscription (setup-token) or API key; Codex with an API key, Codex subscriptions after launch.
4. **Hermes and other agents** come after launch.
