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
| Agent Host (CLI/daemon), ACP adapters for Codex, Claude Code, Hermes | `packages/overlay-agent-host` | Runs unchanged inside the machine. |
| Agent Bridge Protocol: enrollment, signed polling, durable commands, events | `packages/overlay-agent-bridge-protocol`, `ConnectedAgentControlPlaneService` | Unchanged; add a managed enrollment path. |
| `overlay_cloud` environment kind, sandbox leases, lease billing | `connected-agents.ts`, `ManagedAgentSandboxBilling`, `environment-machine.ts` | Leases + compute billing exist; `modelUsageBilling` already skips model charges for cloud runs. |
| Box sandbox runtime: create from image, snapshot, restore, fork, pause/resume, exec, writeFiles, ports | `packages/overlay-sandbox-runtime/src/box.ts` | Machine provisioning and lifecycle. |
| Computers on Box (sizes, desktop viewer, lifecycle UI) | `src/server/computers/*`, Settings → Computers | The agent's machine is a Computer row owned by the agent. |
| Overlay MCP server with per-run `ovmcp_` tokens | `/api/agent-mcp`, `agent-mcp-tools.ts` | Already serves the native agent pipeline's tools to harnesses. |
| New-agent dialog with "Other agent" disabled | `NewAgentDialog.tsx` | Enable the Overlay Cloud path. |

What is missing: a base image, managed enrollment, the lifecycle reconciler, provider accounts, config import, agent-to-agent tools, and the agent page around a cloud agent.

## Architecture

```text
Overlay (Next.js + Convex)                         Box machine (one per agent)
┌──────────────────────────────────┐               ┌──────────────────────────────────┐
│ New-agent dialog / agent page    │               │ Overlay base image (no secrets)  │
│ Lifecycle reconciler ────────────┼─ Box API ───▶ │  Agent Host (daemon)             │
│   desired state, revisions       │               │   ├─ ACP: claude-agent-acp       │
│ Bridge control plane ◀───────────┼── outbound ── │   └─ ACP: codex-acp              │
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

### Base image

- Built from a pinned `Dockerfile` in the repo (`infra/agent-image/`), published as a Box image by CI on release: Ubuntu, Node 22, Python 3, git, ripgrep, the Agent Host at the current version, and the two launch adapters pre-installed at the versions the host pins in `adapter-manifests.ts` (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`), so a cold start never runs `npx -y` downloads.
- Credential-free by test (CI fails if `~/.claude/.credentials.json`, `~/.codex/auth.json`, or any token file exists in the image).
- Image version is recorded on the environment; existing agents keep theirs until "Update" (no silent replacement), new agents get the current one.

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

| Phase | Ships | Exit criteria |
| --- | --- | --- |
| **0. Machine** | Base image + CI publish, managed enrollment, lifecycle reconciler (create, wake, pause, delete), startup phases | A Claude Code agent created behind a flag boots on Box, answers an @mention, pauses after idle, wakes on the next mention. |
| **1. Accounts** | Settings → Accounts, vault, per-run grants, Claude Code setup-token or API key, Codex API key, auth-error states | Runs on a Claude Max setup-token with no model charge; expired token shows "reconnect" and recovers. |
| **2. Dialog + agent page** | "Other agent → Overlay Cloud" enabled, agent page tabs, conversation cards | A teammate can create, use, pause, and delete a cloud agent without docs. |
| **3. Overlay resources** | MCP coverage audit + contract test, native skills sync, real approval round trip | The cloud agent can read/write files and notes, run an automation, use a connector and a user MCP server, and ask for approval. |
| **4. Config import** | `export-config` in the host, upload path, sanitizer, preview, versioned profiles | Importing a real `~/.claude` reproduces skills, commands, subagents, and MCP servers in the cloud agent with no secrets copied. |
| **5. Agent-to-agent** | `agents` tool group + MCP tools, root-principal propagation, hop/budget limits, lineage UI | An Overlay agent asks the cloud Claude Code agent to do something and gets the answer; a cycle is stopped. |
| **6. After launch** | Codex subscription via a credential broker; Hermes and other agents; E2B adapter for self-hosting | Two Codex cloud agents on one ChatGPT account run without breaking each other's refresh. |

Phases 3 and 5 don't depend on 0–2 for native agents and can start in parallel.

## Decisions (2026-10-01)

1. **Sharing subscription-backed agents is the creator's choice.** "Everyone in this workspace" shares their usage; "Only me" keeps it private. No extra restriction.
2. **Free tier:** Overlay agents with free models and free tools only (paid tools blocked); bring-your-own agents on your own machine allowed; no Overlay Cloud agents and no Computer, since a computer is paid.
3. **Launch scope:** Claude Code and Codex only. Claude Code with a subscription (setup-token) or API key; Codex with an API key, Codex subscriptions after launch.
4. **Hermes and other agents** come after launch.
