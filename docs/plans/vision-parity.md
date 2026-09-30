# Vision parity: deck vs. codebase delta plan

Audit of main @ aba8cc5e1, 2026-09-29. Last updated 2026-09-30 (production = main @ d8ed391d2, see §13). Living report: append new findings under the matching section. For what can run in parallel with in-flight P0 work, see §14.

Pitch being audited (Investor Deck, slides 7–8, 18): "One place to create, run and manage every agent your company uses: self-hosted, forward-deployed." Bring any model / agent / tool / cloud, deploy anywhere, manage anything. Open source, serverless, sandboxed terminal + browser + computer use, natively multiplayer.

Legend: 🟢 works / shipped · 🟡 partial or fragile · 🔴 missing or broken · ⚠️ risk

## 0. Executive summary

How far away are we? The platform (workspaces, multiplayer chat, the Overlay-native agent, memory, automations, billing ledger, connected BYO agents, self-hosted Convex) is real and fairly deep, roughly 60–70% of the pitch. The parts that make it a "control plane for AI employees" are where the deltas are:

| Pillar (deck) | Readiness | One-line reason |
|---|---|---|
| Create & run Overlay agents | 🟡 ~65% | Solid core. Harness tools are thin and per-vendor (§4). |
| Bring any agent | 🟡 ~45% | Connected path is good. Hosted Claude Code/Codex run with no Overlay tools, files, or memory (§1). Hermes unproven. |
| Subscriptions / config import | 🔴 ~10% | Explicitly disallowed by current design, and blocked on vendor terms. No importer (§2). |
| File system as source of truth | 🔴 ~25% | Five storage locations. No compute mounts the Overlay FS. Agents lack file tools. Files are per-user even in teams (§3). |
| Terminal / browser / computer use | 🔴 ~30% | Browser = black-box Browser Use sub-agent. No GUI computer-use tools. Four sandbox vendors (§4). |
| Secrets / credentialed access | 🔴 ~15% | A good broker primitive exists, unused. No user secrets store (§5). |
| Notes | 🔴 | Two write paths, two formats, whole-document rewrites, no agent revision guard (§6). |
| Deploy anywhere (Slack, Teams…) | 🟡 Slack live in prod (2026-09-30) | Slack surfaces are deployed (web + Convex) with Convex-backed chat state, Markdown replies, and several agents per channel. Post-deploy Slack E2E still pending. Teams, Google Chat, Discord, WhatsApp still missing (§9). |
| Self-hosted / on-prem | 🟡 ~40% | Data plane is proven. Agent execution (sandbox, browser, computers) is cloud-only. Config schema advertises providers that don't exist (§8). |
| Enterprise / compliance | 🟡 ~35% | RBAC and audit exist. No HIPAA posture. Route-policy inventory completed and two real authorization gaps closed on 2026-09-29, deployed 2026-09-30 (§10–11, §13). |

The five things I'd do first: (1) ✅ close the route-authorization gap and get the full test suite into CI, (2) ✅ recover Slack surfaces onto main (both shipped to production 2026-09-30), (3) rebuild notes on one format with patch-style agent tools, (4) give every harness agent an Overlay MCP (files/notes/memory/integrations), (5) make files object-storage-first and mounted into every sandbox. Those five turn the demo into the product. After that: one sandbox substrate with real browser/computer primitives, then the secrets broker, then the self-hostable sandbox for on-prem.

The biggest structural risk isn't any single feature. It's that shipped work gets lost or silently regresses: divergent main/staging trees, most tests outside CI, living docs describing deleted architecture, and prod credentials rotting unnoticed. With one human and many agents, the verification layer (CI, health checks, evals) is the multiplier on everything else.

Method: static read of main @ aba8cc5e1 (schema, tools, harness registry, agent/sandbox services, notes/files stack, config schema, CI, plans and todos), git comparison with origin/staging and feature branches, tsc --noEmit (clean), and a full run of the src/ unit tests. I didn't sign in to the live app, so UI bugs in §6 are code-level diagnoses. Next step there is a live repro session.

## 1. Bring-your-own agents (Claude Code, Codex, Hermes, OpenCode…)

Short answer to "how do we create non-Overlay agents today?" There are two separate paths plus one unrelated product, and they don't share tools, files, or config:

| Path | How it runs | Where | Status |
|---|---|---|---|
| A. Connected (BYO) agent | `npx @layernorm/overlay-agent-host connect <code>` on the user's laptop / VPS / Docker. Host speaks ACP to Claude Code (claude-agent-acp@0.70), Codex (codex-acp@1.7), Hermes (hermes acp), or Eve. Outbound polling only, Ed25519 device keys. | User's own machine | 🟢 Built and conformance-tested (phases 0–8). 🟡 Phase 9 (live browser matrix, prod soak) still open per docs/develop/bring-your-own-agents.md. |
| B. Managed harness agent ("Hosted on Overlay Cloud") | AI SDK HarnessAgent (@ai-sdk/harness-claude-code, -codex, -opencode, -pi, harness-acp for Hermes) running inside a Vercel Sandbox (Daytona optional), driven by managedHarnessAgentTurnWorkflow in 240s time slices. | Overlay Cloud | 🟡 Live in prod since 2026-09-16 (OVERLAY_MANAGED_HARNESS_ROLLOUT_STAGE=general). Only Claude Code was exercised end to end. Codex / OpenCode / Pi creation isn't verified, and Hermes has never run a real turn in-sandbox (todos.md), yet it's in the picker. |
| C. Box "Computers" | Persistent Linux desktop VMs (box / ascii.dev) with VNC streams. Claude/Codex/Hermes/OpenClaw are preinstalled on the image. | Box | 🟡 Wired to Overlay-native agents only (computer_exec, computer_*_file, computer_open_url). The managed-harness path explicitly rejects Box ("lacks egress allowlist and credential forwarding", ManagedAgentSandboxService.ts). |

So the answer to "Box or another provider?" is: today it's Vercel Sandbox for hosted harnesses, Box for Overlay-agent desktops, Daytona for the legacy run_daytona_sandbox tool, and Browser Use Cloud for browsing. That's four compute vendors, each with its own lifecycle, billing, and file semantics (see §4).

### Findings

- 🔴 Managed harness agents run with zero Overlay context. createManagedHarnessAgent in src/server/agents/managed-harness-steps.ts:359 passes instructions + sandbox only. There are no tools, no mcpServers, no skills, and no access to the workspace file system, notes, memory search, knowledge bases, or integrations (Composio/MCP). A hosted Claude Code agent is a bare coding agent in an empty /workspace. That's the biggest gap between the pitch ("give them the right context, tools and permissions", slide 7) and reality for BYO agents. Fix: expose an Overlay MCP server (files, notes, memory, knowledge, integrations) to every harness via its native mcpServers setting. The adapters already accept it (ClaudeCodeHarnessSettings.mcpServers).
- 🔴 Hermes shown but unproven. It's in MANAGED_HARNESS_CATALOG and allowed in prod, but todos.md says it hasn't run a real turn. Either verify it or allowlist it out.
- 🟡 Elicitation disabled. inactiveTools: ['askUserQuestions'] means hosted harnesses can't ask the user anything mid-task. Long-horizon work will stall or guess.
- 🟡 Default permission mode is allow-all (managedHarnessPermissionMode). The sandbox is the only safety boundary, and approvals are opt-in via env var. Fine for code, not fine once agents hold real credentials (§5).
- 🟡 Egress allowlist is narrow: model hosts + npm + GitHub (managedHarnessBootstrapDomains). No PyPI, no general web, no customer APIs. Good default, but no per-agent UI to widen it, so real work (pip install, calling an internal API) will fail silently.
- 🟡 Cost per turn is high and opaque. Staging needed a ~$15.30 reservation per turn (todos.md). OVERLAY_SANDBOX_MAX_PROVIDER_COST_USD_PER_RUN defaults to $15. Users get no pre-turn estimate.
- 🟡 Two orchestration stacks for the same harness. Connected Claude Code goes host → ACP → command queue. Hosted Claude Code goes AI SDK harness → workflow → Vercel bridge. Transcript projection, approvals, resume, and billing are implemented twice (acp vs harness branch in dispatch). Every harness feature ships twice.
- 🟡 Known open bugs (from todos.md): sandbox status shows "offline" while turns work; /workspace resolves to /vercel/workspace; editor shows "Agent not found" on expired auth; managed tool-approval flow never exercised end to end; agentHarnessSessions.resumeState isn't persisted by the Claude Code adapter, so context rides on room history only; no mobile parity.
- 🟡 OpenClaw (named on slide 8) is explicitly ineligible (bring-your-own-agents.md: "OpenClaw and other native adapters remain ineligible unless ACP is unavailable").
- ⚠️ Doc drift: bring-your-own-agents.md still describes Convex and PostgreSQL parity throughout, but the Postgres app-data path was deleted (64b4257ae). Agents reading it will build the wrong thing.

### What "done" looks like

- One harness abstraction (AI SDK harness) for both hosted and connected. Or at least one shared projection/approval/billing layer.
- An Overlay MCP exposed to every harness: files (FS), notes, memory, knowledge, integrations, secrets broker (§5).
- A per-agent network policy UI with sane presets.
- Conformance run per harness in CI against a real sandbox before it appears in the picker.

## 2. Subscriptions, BYOK, and config import

### Using your Claude / ChatGPT subscription

- 🔴 Not supported, by explicit design. bring-your-own-agents.md: "Overlay never copies, mounts, uploads, or imports a user's local Codex, Claude, or equivalent authentication directory into a managed sandbox." Browser/device login is allowed only "when that provider officially supports a remote or headless flow."

What exists today for hosted harnesses: Overlay-funded (default) or BYOK through a Vercel AI Gateway key (Claude Code / Codex / OpenCode / Pi) or an OpenRouter key (Hermes). There's no direct Anthropic / OpenAI key path for harnesses (registry.ts byokAuth) and no subscription path.

The connected path (A) does use the subscription, but only because the harness runs on the user's own machine with their local login. That's the only way to "subsidize with my subscription" today.

- ⚠️ Vendor terms are the real blocker, not code. The harness auth setting accepts an arbitrary env record, so wiring CLAUDE_CODE_OAUTH_TOKEN (from claude setup-token) or a Codex ChatGPT device-auth login is technically small. But Anthropic's consumer terms have restricted using Pro/Max OAuth tokens in third-party products, and OpenAI's position on ChatGPT-plan Codex in hosted third-party sandboxes needs checking. Get a written answer from each vendor before building this. If they say no, the pitch should say "bring your subscription via a connected machine" rather than implying cloud.
- 🟡 BYOK is per user, not per workspace. A binding records the configurer's connection, so every workspace member's turn burns that one person's key. There's no workspace-level key or spend cap per connection.
- 🟡 BYOK requires the Vercel provider (request transformations inject the key at the network edge). Daytona / self-hosted sandboxes can't do BYOK safely today.
- 🔲 todos.md: "Verify a BYOK managed turn" is still unchecked. BYOK has never been proven live.

### Importing local agent configs into cloud agents

- 🔴 Nothing exists. No importer reads ~/.claude/ (CLAUDE.md, settings.json, skills, agents, MCP servers, hooks), ~/.codex/config.toml / AGENTS.md, OpenCode config, or Hermes config. A grep across src/, packages/overlay-agent-host/src/, and convex/ finds no reference to those paths.

The connected host is deliberately forbidden from writing agent config: "Overlay renders only what the protocol advertises and never writes agent configuration outside ACP."

Suggested design: overlay-agent-host export-config --harness claude-code runs locally and reads only non-secret config (instructions, skills, subagents, MCP server definitions minus tokens, permission allowlists). It uploads to a new agentHarnessProfiles record, and the managed harness bootstrap writes those files into the sandbox (HarnessV1Bootstrap supports files). MCP secrets route through the secrets broker (§5), never the profile. Treat Overlay skills ↔ Claude skills ↔ Codex prompts as one canonical format with per-harness renderers.

## 3. File system: object storage as source of truth

Your principle: compute is stateless; every file lives in the user/workspace FS (object storage) and agents read and write it in real time. Reality: there are five places a file can live, and none of the compute surfaces mount the Overlay FS.

| Where | What lives there | Source |
|---|---|---|
| Convex files table | Unified FS: kind: folder \| note \| upload \| output. Text inlined in the content field; binaries in R2 via r2Key. | convex/schema.ts:1491 |
| Convex notes table (legacy) | Old notes. Still in schema, and convex/files/notes.ts still exports CRUD, with no callers. | convex/files/notes.ts |
| Convex outputs table (legacy) | Generated media. Migrated into files via legacyOutputId, but the table and OutputService remain. | convex/schema.ts:1396 |
| Vercel Sandbox disk | Managed harness /workspace, persistent: true, 10 GiB, snapshot per sandbox. | managed-harness-steps.ts:149 |
| Box VM disk + snapshots | "signed-in Chrome profiles, installed tools, and files live in the box's snapshots" (by design). | docs/plans/COMPUTERS_PLAN.md |
| Daytona workspace | "persistent paid Daytona workspace"; files are copied in by id and outputs copied back into Outputs. | run_daytona_sandbox in src/server/tools/tools/build.ts |

### Findings

- 🔴 No compute surface mounts the Overlay FS. Hosted harnesses start with an empty persistent disk. Box stores files in snapshots. Daytona uses copy-in/copy-out. That's the direct opposite of the principle, and it means an agent's work is invisible to the rest of the workspace until someone manually exports it.
- 🔴 Overlay-native agents have no general file tools. The tool set in build.ts has search_in_files, search_knowledge, and note CRUD, but no read_file, write_file, list_dir, move, or mkdir over the Overlay FS. Agents can search files but can't create a file, edit a CSV, or organize folders.
- 🟡 Text files live inside Convex documents. content is a string on the files row. Convex documents cap at 1 MiB, so large notes or text files will fail to save. Text isn't in object storage at all, so it can't be mounted, synced, or streamed.
- 🟡 Files are private per user even inside a team workspace. Every index is workspaceId + userId (by_workspaceId_userId_*). There's no workspace-shared drive, and no visibility field like agents have. For a "natively multiplayer" product (slide 18), the file system is single-player.
- 🟡 Three overlapping storage models (files / notes / outputs) with legacyNoteId / legacyOutputId bridges. Dead code (convex/files/notes.ts) is still deployed.

### Suggested target architecture

- All bytes in object storage (R2/S3/MinIO for self-host), including text and notes. Convex keeps metadata only (path, parent, owner, visibility, hash, version).
- One FS API (fs.read/write/list/stat/move/mkdir/watch) exposed as (a) Overlay tools, (b) an MCP server for harnesses, (c) a FUSE / sync daemon inside every sandbox that mounts /workspace (or /overlay) backed by that API. Options: a thin rclone mount / s3fs against a per-session scoped credential, or a small Overlay FS daemon over HTTP with write-back. Sandboxes become disposable, so drop persistent: true.
- Treat Box/Daytona/Vercel disks as scratch. Anything the agent wants to keep, it writes under the mount.
- Workspace-level folders with ACLs (personal / workspace / shared-with), reusing workspaceResourceGrants.

## 4. Harness quality: terminal, browser, computer use

The deck claims "sandboxed environments for serverful execution (terminal, browser and computer use)" (slide 18). Here's what the Overlay-native agent actually gets (src/server/tools/tools/build.ts):

| Capability | Tool(s) | Backing vendor | Assessment |
|---|---|---|---|
| Terminal | computer_exec (needs a bound Box computer), run_daytona_sandbox (paid, one-shot command + copy files in/out) | Box, Daytona | 🟡 Two terminals with different semantics. No streaming output, no long-running process / PTY, no background jobs, no port preview. |
| Files on the machine | computer_read_file (256 KB cap), computer_write_file, computer_list_files | Box | 🟡 Text only. No binary, no diff/patch edit, no glob/grep. Every coding harness (Claude Code, Codex) ships all of these. |
| Browser | interactive_browser_session → /api/v1/browser-task | Browser Use Cloud (bu-mini / bu-max) | 🔴 A black-box sub-agent: you hand it a natural-language task and get text back. The Overlay agent can't navigate, read the DOM, click, screenshot, or keep state step by step, and it can't hand over credentials safely. The tool description spends most of its words telling the model not to use it. Paid tier only. |
| Browser on the desktop | computer_open_url | Box | 🔴 Opens a URL and stops. The agent can't see or interact with what opened. |
| Computer use (GUI) | none | – | 🔴 No screenshot / click / type / scroll / key tools. Box advertises "Lux GUI automation" and the Anthropic computer_20250124 tool is already in node_modules, but neither is wired in. The only way to "use a computer" today is a hosted Claude Code harness doing shell work. |
| Web research | web_search, deep_search | AI Gateway / Perplexity / Tavily | 🟢 Reasonable. |

### Harness-level gaps (beyond individual tools)

- 🔴 No unified "computer" abstraction. Box, Daytona, Vercel Sandbox, and Browser Use each have their own lifecycle, billing ledger (daytonaUsageLedger, agentSandboxSettlements, box billing), and tool family. One SandboxRuntime contract exists (@overlay/sandbox-runtime) and Box, Daytona, and Vercel adapters implement it, but the tools don't go through it. The Overlay agent's tools are per-vendor.
- 🔴 The Overlay agent and the harness agents don't share tools. The Overlay-native agent has ~45 tools (notes, memory, automations, media). The harness agents have none of them (§1). The pitch is "make the Overlay harness the best on the market", but right now the best in-product coding and computer agent is literally Claude Code in a Vercel sandbox, and it's cut off from Overlay.
- 🟡 No eval harness for the agent. benchmarks/memory exists for memory. There's no task-level benchmark (e.g. a Terminal-Bench / WebArena / OSWorld subset, or your own pharma workflows) to measure "extremely good" and catch regressions.
- 🟡 Tool exposure is huge and flat. ~45 tools are exposed at once, with long prose rules inside descriptions (interactive_browser_session). Consider progressive disclosure: tool search / skills that load tool groups on demand.

### Suggested direction

Pick one sandbox substrate per deployment behind SandboxRuntime (Vercel for cloud, Daytona OSS or Firecracker for self-host) and give every agent the same primitive tool set through it: shell (streaming, background, PTY), fs.* (mounted Overlay FS, §3), browser.* (Playwright/CDP primitives with snapshot/click/type plus live view, running inside the sandbox so credentials and cookies stay local), and computer.* (screenshot/click/type via the sandbox's desktop). Expose the same set to harness agents over MCP. Keep Browser Use as an optional "delegate a whole web task" tool, not the only browser.

## 5. Secrets and credentialed access

Your goal: users store logins and secrets in Overlay, and agents use them without ever seeing the values (passkey-like).

### What exists:

- 🟢 Model keys (BYOK) live in WorkOS Vault (byok-vault.ts) or AWS Secrets Manager (byok-credential-store.ts). They're resolved at execution time, never persisted in workflow state, and for Vercel sandboxes injected at the network edge via request transformations, so the sandbox process never sees the key. That's exactly the right primitive.
- 🟢 MCP credentials are encrypted at rest (encryptedAuthConfig, encryptedOAuthTokens, McpCredentialCipher), with a PKCE OAuth flow.
- 🟢 SaaS app OAuth goes through Composio (vendor-held tokens).
- 🟡 A general credential broker contract exists but nothing uses it. SandboxCredentialBinding / SandboxCredentialBroker in packages/overlay-sandbox-runtime/src/contracts.ts (opaque broker ref + placeholder env var + allowed domains). The Vercel adapter implements placeholder → header injection, but no caller passes a credentialBroker anywhere in src/.

### What's missing:

- 🔴 No user-facing secrets store. Settings has API keys (Overlay's own), provider connections (model keys), webhooks, environments, and computers. There's no "Secrets" or "Logins" page, and no per-agent secret grants.
- 🔴 No website-login handling. Browser Use gets a natural-language task, and any credentials would have to be in the prompt, so the model sees them. There's no password manager integration, no TOTP, no stored cookie/session vault.
- 🔴 No approval step at use time. Nothing like "Agent X wants to use GitHub token on api.github.com: allow once / always."
- 🟡 WorkOS Vault is the default secret store, and it's SaaS. On-prem has only env or AWS SM. vault (HashiCorp) is declared in the config schema with no implementation.
- 🟡 Legacy plaintext mcpServers.authConfig.headerValue is still in the schema next to the encrypted field. Confirm a backfill has encrypted all rows, then drop it.

### Suggested design ("secrets as capabilities")

- secrets table: metadata only (name, type = api_key / basic_login / oauth / cookie_jar / totp_seed, allowed domains, owner scope personal/workspace, grants to agents). Values live in the secrets provider (Vault / AWS SM / WorkOS Vault / sealed with a KMS key for Convex-only self-host).
- API keys → edge injection. The agent sees $GITHUB_TOKEN = ovl_secret_ref_…, and the sandbox egress proxy swaps it for the real value only on requests to allowed domains. This already exists for Vercel; build a small egress proxy for Daytona / self-host.
- Web logins → in-sandbox browser autofill. The browser tool exposes fill_credential(secretRef, field), and the value is typed by the tool runtime, never returned to the model. Screenshots mask password fields.
- Audit log + approvals per use (you already have auditEvents and the approval card UX).

## 6. Notes

I couldn't sign in to reproduce the UI bugs live. These are the code-level causes I found that match what you described.

### Data and API

- 🔴 Two write paths with different semantics. The UI goes /api/v1/notes → NoteService → files:create (kind note, content = HTML). Agents go create_note / update_note → /api/v1/files with textContent = Markdown (notes-executes.ts). The same note is Markdown after an agent writes it and HTML after a human edits it. The loader guesses the format with a regex (normalizeNotebookContent: if htmlTagPattern matches, treat as HTML). So Markdown containing `<something>` renders as broken HTML, and get_note hands agents raw TipTap HTML to rewrite.
- 🔴 Agents can only replace a whole note. update_note takes the full content. There's no append / insert-after-heading / find-and-replace / patch. Agents have to regurgitate the whole document, which is slow, lossy, and truncates long notes.
- 🔴 No concurrency guard for agents. The UI sends expectedUpdatedAt and gets a 409 on conflict, but executeUpdateNote doesn't. An agent edit silently overwrites what the user is typing, and the user's next autosave then hits a conflict banner. That likely explains part of the "I can't edit it" experience.
- 🟡 Tags are accepted and silently discarded. ConvexNoteRepository.createNote/updateNote do void args.tags, and get_note always returns tags: []. The tool schema advertises tags.
- 🟡 Title fallback is inconsistent. Server stores 'Untitled', the tool writes input.title ?? 'Untitled', and the header shows the placeholder "Note title..." when the title is empty. If a note gets created with name: '' through the files route (e.g. the Files "new" flow or an agent passing title: ""), it renders with a blank header. That matches "a note with no header title appears".
- 🟡 Create → navigate race. createNote → openNote → onNavigateNote → router.replace(?id=) → the useNotebookNotes effect re-fetches by id while the lifecycle controller is mid-select. With hydratingEditorRef toggled synchronously around setContent, an autosave can fire against the wrong revision or the editor can hydrate twice. Needs a live repro to confirm, but it's the most likely cause of "new note appears but I can't type into it".
- 🟡 The notes list is capped at 100 and filtered in memory (limit: 100 client, scanLimit over-fetch in Convex). Past 100 notes, older ones disappear from the sidebar.
- 🟡 The editor is a 910-line hook file (packages/overlay-modules-react/src/notes/editor-state.ts) with refs mirroring state (titleRef, activeNoteRef, hydratingEditorRef, flushSaveRef). This class of design produces exactly the stale-state bugs you're seeing.

### Recommendation

Pick one canonical note format (Markdown with a TipTap round-trip, or ProseMirror JSON) and store it in object storage (§3). Add a proper notes tool set (read, append, replace_section, patch with expectedRevision). Consider a CRDT (Yjs via @convex-dev/prosemirror-sync) so humans and agents can edit the same note live. That's also the multiplayer story. Rewrite editor-state.ts as a small state machine with one source of truth.

## 7. Files / notes / agents UX and workspace scoping

- 🟢 Workspace scoping of data landed (all phases ✅ in docs/develop/workspace-scoping-plan.md).
- 🔴 Files and notes have no "personal vs workspace" split. Agents got visibility: 'workspace' | 'creator' plus archive. Files and notes only have workspaceId + userId (always private to the creator) and deletedAt (soft delete). There's no shared-with-workspace, no archive, and no restore UI.
- 🔴 /app/archived is chats only (ChatArchivedView). Archived agents, files, and notes have no home.
- 🟡 Files route and notes route both opt out of Cache Components (instant = false TODOs). That's a known perf debt, and it's in the same code path as the prod hydration stall that forced the singleplayer snapshot (AGENTS.md).
- 🟡 Knowledge surface, Outputs page (/app/outputs), Files page (/app/files), and Notes page (/app/notes) are four entry points over one files table. Outputs should be a filter in Files, not a separate page.

To do: mirror the agent pattern exactly. Add visibility + archivedAt to files, show a Personal / Workspace / Archived segmented control in Files and Notes, and move archived items into one Archive view with tabs (Chats, Agents, Files, Notes).

## 8. Self-hosting and on-prem

- 🟢 The core is genuinely self-hostable. The Convex-only decision is done, the official convex-backend ran the full convex/ tree on Postgres + S3 (proof table in docs/develop/convex-only-self-hosting.md), there's a reference compose in examples/customer-deployment/, a read mirror to customer Postgres, and Better Auth / OIDC runbooks. That's a strong base.

- 🔴 The agent-execution layer isn't self-hostable, and that's the part the pitch is about. Vendor matrix for an on-prem / air-gapped install:

| Concern | Default (cloud) | Self-host option in code | Status |
|---|---|---|---|
| App data / realtime | Convex Cloud | convex-backend OSS | 🟢 proven. ⚠️ FSL scope with Convex still unconfirmed in writing (todos.md). Dashboard image 500s. |
| Auth | WorkOS | Better Auth, OIDC | 🟢 runbook exists. 🟡 interactive SSO not driven end to end in the proof. |
| Secrets | WorkOS Vault | env, AWS Secrets Manager | 🟡 vault (HashiCorp) declared, not implemented. |
| Object storage | R2 | S3-compatible | 🟢 |
| Durable workflows | Vercel Workflow | @workflow/world-postgres | 🟡 wired via WORKFLOW_TARGET_WORLD. Not in the self-host proof, and managed harness turns depend on it. |
| Models | Vercel AI Gateway | OpenAI / Anthropic / Groq / OpenRouter direct, custom OpenAI-compatible (vLLM/Ollama) | 🟡 Chat works. Model catalog and pricing are AI-Gateway-shaped. Embeddings: azure-openai declared, not implemented (and pharma will ask for Azure OpenAI / Bedrock). |
| Sandbox (terminal, hosted harness agents) | Vercel Sandbox | Daytona (SaaS API) | 🔴 e2b and local-firecracker declared, zero implementation. Vercel Sandbox is cloud-only. So on-prem has no hosted harness agents and no sandboxed terminal. |
| Computers (desktop) | Box | – | 🔴 SaaS only. |
| Browser | Browser Use Cloud | self-hosted-playwright declared | 🔴 not implemented. |
| Integrations | Composio | MCP, Executor | 🟡 MCP works self-hosted. Composio is SaaS. |
| Web search | AI Gateway / Perplexity / Tavily | – | 🔴 no self-hosted option (SearxNG etc.). Air-gapped = no web search, which is acceptable if disclosed. |
| Media gen / transcription | AI Gateway | – | 🔴 cloud only |
| Email / analytics / errors / billing | Resend, PostHog, Sentry, Stripe | SES/SMTP, none | 🟢 |
| Packaging | Vercel | Docker compose, EC2 compose, overlayctl installer | 🟡 Helm is a values.yaml with no chart. No Terraform. "Bring any cloud: AWS, GCP, Azure, Hetzner…" (slide 8) is really "any Docker host". |

### Key takeaways:

- ⚠️ Config schema over-promises. overlayConfigSchema.ts accepts providers with no implementation: self-hosted-playwright, e2b, local-firecracker, pgvector, pinecone, vault, azure-openai. A customer, or an eager SE, can set these and get silent failure. Either implement them or remove them from the enum until they exist.
- 🟢 The connected-agent path is the on-prem story today. The Agent Host needs only outbound HTTPS to the Overlay origin, which in self-host is the customer's own origin. A customer can run Claude Code / Codex / Hermes on their own VMs with their own model endpoints. Lead with this for Elo.ad and pharma, and make sure it's tested against a self-hosted backend (Phase 9 evidence was against staging cloud).
- 🔴 On "vendors that don't support self-hosting": the blockers are Vercel Sandbox, Box, Browser Use Cloud, Composio, WorkOS Vault, plus Vercel AI Gateway for media. (Your note was cut off after "like better". If you meant Better Auth, it is self-hostable and already has an on-prem runbook here.)

Plan: self-host profile = Convex OSS + Postgres + MinIO + Better Auth/OIDC + world-postgres + Daytona OSS (or Firecracker/Kata) sandbox + in-sandbox Playwright + MCP + customer model endpoint. Build a single docker compose up (then Helm) that brings all of it up, and run it in CI nightly.

## 9. Other deck claims (deploy anywhere, manage anything, multiplayer, marketplace)

| Deck claim | Reality on main |  |
|---|---|---|
| "Agents in Slack" (slide 11), "Deploy to Slack, Teams, Google Chat, Discord, WhatsApp" (slide 8) | Update 2026-09-30: Slack surfaces were recovered onto main and are live in production (§13), including several agents per channel. Original finding: the phase 0–5 work on codex/slack-surfaces* had been overwritten out of both main and staging by "host main's tree" commits. Teams, Google Chat, Discord, and WhatsApp have nothing. Slack/iMessage import exists, but that's migration, not deployment. | 🟡 Slack only |
| "@-tag agents to get work done" | Works inside Overlay rooms/DMs (mention policy, connected and hosted agents). | 🟢 |
| "Natively multiplayer, humans + agents" | Workspaces, channels, DMs, presence, threads, reactions, agent participants all exist. But files and notes are per-user (§3, §7). | 🟡 |
| "Company knowledge + memory" (slide 4) | Memory system (M1–M4) and file-based search_knowledge exist. Knowledge Bases and Projects were removed (9a6141f5b), and their tables are still in convex/schema.ts. | 🟡 |
| "Monitoring + cost controls" / "Manage: identity, access, activity, usage, cost" | Usage ledger, budget reservations, spend limits, audit events, audit exports, governance policies, authorization roles/groups/grants all exist. todos.md notes a real billing bug (syncPersonalBillingShadows silently reverts canonical top-ups). | 🟡 |
| "Bring any model" | ~15 BYOK presets + custom OpenAI-compatible. | 🟢 |
| "Bring any tool: MCPs, Skills, connectors, credentials" | MCP 🟢, Skills 🟢 (Overlay-native only), Composio 🟢, credentials 🔴 (§5). Not available to harness agents (§1). | 🟡 |
| "Workspace usage-based pricing: minimum subscription + pay-as-you-go" | billingAccounts.scope: personal \| workspace exists, with a markup_25_v1 pricing version. The payment-revision work (PAYMENT REVISION 1–5) sits in staging history; verify what's live on main. | 🟡 |
| "Marketplace (soon)" | No code. | 🔴 (expected) |
| "Open source" | Repo public (LayerNorm/overlay-web), AGPL packages, CLA workflow. ⚠️ Commercial/private components (PRIVATE_COMPONENTS.md, COMMERCIAL_LICENSE.md) need a clear boundary for enterprise buyers. | 🟢 |

## 10. Compliance and enterprise readiness (SOC2 / HIPAA / GDPR)

The raise earmarks capital for SOC2 / HIPAA / GDPR (slide 21), and pharma (Genentech, BMS) will require them before any pilot touches real data.

- 🟢 Foundations exist: audit events + exports, governance policies and access reviews, RBAC (roles/groups/resource grants), rate limiting, SSRF guard, gitleaks/CodeQL/Semgrep in CI, a security audit pass (2026-08-27), SSO via WorkOS or OIDC, and complianceProfile presets (dpdp-strict, enterprise-private).
- 🔴 No HIPAA posture. Zero references to HIPAA. No PHI data classification, no BAA-covered vendor list (Vercel Sandbox, Browser Use, Composio, AI Gateway would all need BAAs or be disabled), no per-workspace "PHI mode" that turns off non-BAA providers.
- 🟡 SCIM / directory sync: only 2 files reference SCIM. Enterprise IT will expect SCIM provisioning (WorkOS supports it; Better Auth/OIDC paths need their own).
- 🟡 Open security items (docs/security/HANDOFF-production-readiness.md): CSP nonce landed but flag off in prod ('unsafe-inline' still in script-src). Postgres/Redis contract suites never run.
- 🟡 Data retention / deletion exist for artifacts (30 days) and agent memory. There's no workspace-level retention policy UI, no legal hold UX, and no documented GDPR DSAR/export flow for end users.
- 🟡 Agents with allow-all permissions plus no secret brokering (§5) will be the first thing a pharma security review flags.

Do first: a written vendor/sub-processor list with a data-flow diagram per deployment profile. It's the input for SOC2 Type I, HIPAA BAAs, and every enterprise questionnaire.

## 11. Engineering health

Scale: ~293K lines of TypeScript on main (195K src/, 37K convex/, 61K packages/), plus the desktop, mobile, and Chrome sub-repos. 188 API route handlers, 150+ Convex tables, 462 commits in the last 30 days, one human. The throughput is impressive. The risk is that surface area is growing faster than verification.

- 🔴 There's no single test command, and CI runs only slices. 339 test files use at least four runners: tsx --test (CJS), node --experimental-strip-types, top-level-await ESM files, and vitest (Convex only, vitest.config.mts). CI (security.yml) runs lint, typecheck, build, route-characterization, and release-safety. It doesn't run the bulk of the unit tests. Running all 269 src/ test files through one runner: 25 files fail. Most are runner incompatibilities, but at least 11 are genuine assertion failures that nobody sees, including:
  - src/server/authorization/authorization-route-policy.test.ts: 38 API route methods have no explicit authorization-policy entry. They include /api/v1/computers/* (create/start/stop/delete/desktop), /api/v1/providers/connections (BYOK keys), /agent-environments/:id/reset-harness and /desktop, /files/ingest-jobs, and /imports/slack. These routes still require authentication through handleBffRoute. The gap is that they skip the RBAC policy registry, so workspace-role checks rely on whatever each handler does itself. Security-relevant; fix first.
  - integrations/route.test.ts: connector-policy withholding and server-side rejection tests fail. That's a governance feature regression candidate.
  - AdministrativeService.test.ts: 3 of 4 fail (custom capabilities, legacy role compatibility, and grant resilience during sync failure). That's the admin authorization path.
  - (All three of these were re-run individually with the repo's standard tsx --test runner to rule out runner artifacts.)
  - Several source-regex tests (e.g. /managedHarnessAvailability\(/, /threadRootMessageId/) fail because the code moved. Tests that grep source text break on refactors and should become behavioral tests.
- 🟢 tsc --noEmit is clean.
- 🔴 Branch divergence is losing work. staging is 103 commits off main (and main 174 off staging). Staging is repeatedly overwritten with "host main's tree" commits. That's how the Slack surfaces work (§9) vanished from both trees, and staging still carries the deleted Postgres layer. With ~40 local branches (codex/*, pr-*, random names), there's no way to know what's shipped. Fix: trunk-based on main behind feature flags (you already have the flag system). Staging should be a deploy of a main SHA, not a content branch.
- 🟡 Prod config rot is found by hand. A dead VERCEL_TOKEN, an empty AI_GATEWAY_API_KEY, and a disabled cloud-environments flag in prod were all found during manual QA (todos.md). Add a /api/health/deep that checks every configured provider credential, plus a scheduled synthetic agent turn per harness.
- 🟡 Dead schema and code: notes, outputs, knowledgeBases*, knowledgeSources*, projectKnowledgeBases, projects tables, and convex/files/notes.ts. They slow every schema push and confuse agents working in the repo.
- 🟡 Doc drift in "must-follow" living docs: bring-your-own-agents.md, workspace-scoping-plan.md (Postgres parity sections), and COMPUTERS_WIRING_PLAN.md (Postgres repository trio) all describe the deleted Postgres path. Your own AGENTS.md makes these docs the source of truth, so stale docs directly produce wrong code.
- 🟡 God files: convex/collaboration/workspaces.ts (2.6K lines), convex/agents/connectedAgents.ts (2.6K), DirectMessageExperience.hooks.ts (2.3K), convex/platform/usage.ts (2.0K), notes editor-state.ts (910).
- 🟡 Known billing bug: syncPersonalBillingShadows rewrites billingAccountBalances from the legacy subscriptions row on every billing mutation and silently reverts canonical top-ups (todos.md). Real money path.
- 🟡 Prod stability history: the (shell) route-group hydration stall forced the singleplayer rollback snapshot. Many routes still have instant = false TODO opt-outs.

## 12. Prioritized delta list

Sizing: S ≈ days, M ≈ 1–2 weeks, L ≈ 3–6 weeks (one engineer plus coding agents). Ordered by leverage on the pitch and on paying customers.

### P0: credibility gaps (things the deck shows or customers will hit first)

| # | Delta | Why now | Size |
|---|---|---|---|
| 1 | ✅ Fix the 38 missing route authorization policies + get the whole test suite running in CI (one runner or a test:all orchestrator). Done 2026-09-29, in production 2026-09-30. | Security. Silent regressions are shipping today. | S–M |
| 2 | ✅ Recover and ship Slack surfaces to main (codex/slack-surfaces-phase3 → rebase onto main). In production 2026-09-30; post-deploy Slack E2E pending. | Deck slide 11 shows it; production doesn't have it | M |
| 3 | ✅ Notes rebuild: one storage format, create/title/edit bugs reproduced and fixed, agent tools append / replace_section / patch with expectedRevision, tags persisted. Landed on main 2026-09-30 (d907b506). | Your #4; daily-use surface | M |
| 4 | Overlay MCP for harness agents (files, notes, memory, knowledge search, integrations) wired into createManagedHarnessAgent and the Agent Host | Hosted Claude Code / Codex are cut off from Overlay today | M |
| 5 | Files: personal / workspace / archived (mirror agents) + a unified Archive view | Your #5; multiplayer claim | M |

### P1: "make the Overlay harness extremely good"

| # | Delta | Size |
|---|---|---|
| 6 | Object-storage-first FS: move text/note bodies to R2/S3, one fs API, agent file tools (read/write/list/move/mkdir), mounted into every sandbox, sandboxes made ephemeral | L |
| 7 | One sandbox substrate + primitive tool set (shell with streaming/background, fs, browser.* via in-sandbox Playwright/CDP, computer.* screenshot/click/type) shared by the Overlay agent and harness agents. Browser Use becomes optional. | L |
| 8 | Secrets store + broker: Secrets page, per-agent grants, edge injection for API keys (reuse SandboxCredentialBroker), in-browser credential fill for logins, per-use approval + audit | L |
| 9 | Harness conformance gate: every picker-visible harness passes a live turn + tool + approval + resume test in CI. Pull Hermes until it passes. Verify BYOK live. Enable askUserQuestions via the room. | M |
| 10 | Agent eval suite: 20–50 real tasks (your pharma workflows plus terminal/browser tasks) run nightly with scores tracked | M |
| 11 | Collapse ACP-host vs AI-SDK-harness orchestration into one projection/approval/billing layer | L |

### P1: self-host / on-prem (Elo.ad is contracted as self-hosted)

| # | Delta | Size |
|---|---|---|
| 12 | Implement one self-hostable sandbox (Daytona OSS or Firecracker/Kata via SandboxRuntime) + in-sandbox browser | L |
| 13 | Remove or implement unimplemented config providers (e2b, local-firecracker, self-hosted-playwright, pgvector, pinecone, vault, azure-openai) | S (remove) / L (implement) |
| 14 | Real Helm chart + Terraform module for one cloud; nightly CI of the full self-host stack (Convex OSS + world-postgres + Better Auth + MinIO + sandbox) including an agent turn | M–L |
| 15 | Get the Convex FSL scope confirmation in writing. Enterprise procurement will ask. | S |
| 16 | Azure OpenAI / Bedrock model and embeddings adapters (pharma default clouds) | M |

### P2: expansion

| # | Delta | Size |
|---|---|---|
| 17 | Subscriptions: get written positions from Anthropic and OpenAI on hosted use of consumer-plan auth. If allowed, wire CLAUDE_CODE_OAUTH_TOKEN / Codex device-auth through the secrets broker. If not, position the connected host as "use your subscription". | S (ask) + M |
| 18 | Config import: overlay-agent-host export-config (CLAUDE.md, skills, subagents, MCP defs, permissions → harness profile) | M |
| 19 | Teams / Google Chat / Discord / WhatsApp via Chat SDK adapters once Slack is solid | M each |
| 20 | Compliance: sub-processor list + data-flow per profile, SOC2 Type I readiness, "PHI mode" (non-BAA providers off), SCIM, turn on the CSP nonce | L (mostly process) |
| 21 | Hygiene: drop dead tables and files, fix doc drift, prune branches, trunk-based flow, deep health check, fix syncPersonalBillingShadows | M |

## 13. Follow-up log

### 2026-09-29: P0 items 1 and 2 (pushed to main, not deployed)

Route authorization. Correction to §11: authorization-route-policy.ts is a declarative inventory checked by tests, not a runtime gate. Handlers authenticate through handleBffRoute and authorize in their domain services. All 38 missing entries were audited and recorded. The audit found two real gaps, now fixed:

- POST /api/v1/agent-environments/{id}/desktop handed a live desktop stream to any workspace member. It now requires an owner or admin.
- The integrations route ignored the admin catalog's withheld-connector policy (lost in the e02a88843 revert). It's enforced again, with a regression test.

Test suite in CI. npm run test:all runs all ~347 test files in the required gate. Getting to green surfaced a real CI breaker: convex-test 0.0.58 was incompatible with convex 1.42, so every Convex suite failed on a clean install. It's pinned to 0.0.54.

Slack surfaces. Ported from codex/slack-surfaces-phase3. The branch's Chat SDK state would have been in-memory in production on Convex-only main, which silently breaks Slack across serverless instances. It's replaced with a Convex state adapter (surfaceChatState). The OAuth legs had no effective rate limit and no audit event; both were added.

Still needed before Slack works in production: set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET / SLACK_ENCRYPTION_KEY, deploy web, then run convex:push:prod, then a live Slack E2E (connect → bind → mention → reply).

### 2026-09-30: Slack follow-ups, and P0 items 1 and 2 deployed to production

#### Shipped to main (after the 2026-09-29 entry):

306401741 Slack replies render Markdown. Replies were posted as plain text, so Slack showed `**pong**` literally. They're now posted as markdown_text, falling back to converted mrkdwn above Slack's 12k cap. This covers both new replies and the edited "working" placeholder.

7e1e0b057 CI audit unblocked. Advisories published 2026-09-29 (including undici's TLS validation bypass, GHSA-w293-vg96-wgc3) failed the production audit on every commit. Fixable paths were patched (undici 7.29.1, brace-expansion 5.0.12). Three paths pinned by pi-coding-agent and eve can't be overridden. security:audit now runs scripts/ci/security-audit.mjs, which only allows those exact paths and advisory IDs, each with a reason and an expiry date.

36b5295ff Several agents per Slack channel. Bindings are now unique per (connection, channel, agent) instead of per channel. Routing follows these rules, in order:

1. `@Overlay <agent name> …` picks that agent.
2. A thread's owning agent handles follow-ups.
3. A channel with a single agent keeps the old behavior.
4. Otherwise the reply asks which agent to use.

Routing is a pure, unit-tested function (src/shared/surfaces/surface-routing.ts). Convex gains listBindingsByChannel. findBindingByChannel stays for older web builds.

06d58be0c, 0d13c1ec3, d8ed391d2 Live-test fixes. Mentions now route on the raw Slack event text; the Chat SDK's normalized @Overlay had been read as the agent named "Overlay". A redundant bold agent-name line was dropped, because Slack does show the answering agent as sender. The agent-choice example no longer repeats the bot name.

#### Production release (main @ d8ed391d2):

Web. The first attempt (mahbj6t9g) hung at "Creating an optimized production build" and failed after 46 minutes. The retry (a21apnb4g) went Ready in about 7 minutes and was promoted. Vercel had discarded an oversized previous build cache on the retry, which is the likely cause of the hang, so it isn't a code problem. getoverlay.io/ and /auth/sign-in return 200.

Convex. convex:push:prod ran from the clean main checkout after the web deploy was live. The push had no schema change and deleted no indexes. surfaces/surfaces:listBindingsByChannel and findBindingByChannel are both confirmed on the production deployment. Slack routing may have failed for about a minute between the web promote and the Convex push.

The SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET / SLACK_ENCRYPTION_KEY production env vars are set. This clears the blocker listed in the previous entry.

#### Still open:

- Post-deploy Slack E2E in production. In a channel with two agents bound, @-mention the non-default agent by name, then the default agent, then reply in a thread. Check that each routes correctly and shows the right sender.
- Sign-in was checked only as a page load, not as a full login.

Machine hygiene: the stale pr139-work worktree entry was pruned, the npm cache cleared, and the .next build cache removed. The disk still sits at about 96% used.

## 14. Parallel work alongside P0 (2026-09-30)

P0 #1–#3 are on main. P0 #4 (Overlay MCP for harness agents) and #5 (Files personal / workspace / archived) are in flight in another agent. This section maps which P1 items can run at the same time without waiting on them or colliding with them.

### Surfaces the in-flight P0 work owns

Stay out of these until #4 and #5 merge, or coordinate with that agent first:

- #4: `createManagedHarnessAgent` in src/server/agents/managed-harness-steps.ts, src/server/agents/harnesses/registry.ts, packages/overlay-agent-host, the new Overlay MCP endpoint, and whatever it uses to enumerate Overlay tools for MCP.
- #5: the `files` table and its indexes in convex/schema.ts, convex/files/files.ts, the file/note services, the Files and Notes UI, and /app/archived.

### P1 dependency map

| # | Delta | Parallel now? | Depends on / collides with | Can start now | Waits |
|---|---|---|---|---|---|
| 6 | Object-storage-first FS | 🔴 Design only | #5 (same `files` table and indexes), #4 (fs tools reach harnesses over MCP), #7 (sandbox mount) | Design doc: fs API contract (read/write/list/stat/move/mkdir/watch), metadata-in-Convex vs bytes-in-R2/S3 split, migration plan for inline `content` | Schema migration, agent file tools, sandbox mount: after #5 merges |
| 7 | One sandbox substrate + primitive tools | 🟢 Mostly | #4 only for harness exposure; #6 for `fs.*` | `shell` (streaming / background / PTY), `browser.*` (in-sandbox Playwright/CDP), `computer.*` (screenshot/click/type) behind `SandboxRuntime` in packages/overlay-sandbox-runtime, exposed as Overlay-native agent tools | Exposing them to harness agents over MCP (after #4); `fs.*` (after #6) |
| 8 | Secrets store + broker | 🟢 Mostly | None for the store; #7 for in-browser credential fill; #4 for harness exposure | `secrets` table (metadata only), Secrets settings page, per-agent grants, wiring `SandboxCredentialBroker` into ManagedAgentSandboxService (the Vercel adapter already does placeholder → header injection; no caller passes a broker today), per-use approval + audit events | `fill_credential` (needs #7 `browser.*`), MCP exposure (needs #4) |
| 9 | Harness conformance gate | 🟢 Yes | Small overlap with #4: `inactiveTools: ['askUserQuestions']` lives in managed-harness-steps.ts | Live turn + approval + resume per picker-visible harness in CI; pull Hermes from the picker until it passes; verify a BYOK managed turn live | The "tool" leg starts with native harness tools and adds an Overlay-MCP assertion once #4 lands. Land the `askUserQuestions` change after #4, or coordinate it |
| 10 | Agent eval suite | 🟢 Yes | None | Runner, scoring, nightly schedule, terminal/browser tasks on today's tools | Pharma task set needs input from the owner. Harness-agent scores become meaningful after #4 |
| 11 | Collapse ACP-host vs AI-SDK-harness orchestration | 🔴 No | #4 changes the same seams (`createManagedHarnessAgent`, Agent Host, dispatch) | Nothing | Start after #4 merges, ideally after #9 so conformance catches regressions |
| 12 | Self-hostable sandbox | 🟢 Yes | #7 defines the primitive contract | Daytona OSS (or Firecracker/Kata) `SandboxRuntime` adapter that passes the existing packages/overlay-sandbox-runtime conformance tests | In-sandbox browser: follow #7's `browser.*` contract |
| 13 | Unimplemented config providers | 🟢 Yes (hours) | None. #16 would implement `azure-openai` | Correction to §8: these already fail closed. `overlayConfigSchema.ts` rejects each one with an explicit `addUnsupportedProviderIssue` error, so there's no silent failure. What's left is dropping them from the enums and docs | Keep `azure-openai` if #16 goes ahead |
| 14 | Helm + Terraform + nightly self-host CI | 🟢 Mostly | #12 for the agent-turn leg | Helm chart, Terraform for one cloud, nightly CI of Convex OSS + world-postgres + Better Auth + MinIO | The agent turn in the nightly waits on #12 |
| 15 | Convex FSL confirmation in writing | 🟢 Yes (not code) | None | Owner asks Convex | – |
| 16 | Azure OpenAI / Bedrock adapters | 🟢 Yes | None (packages/overlay-llm-gateway plus embeddings) | Model and embeddings adapters | – |

### Suggested parallel lanes

One agent per lane, each on its own `codex/<slug>` worktree per docs/develop/agentic-development.mdx:

- Lane A, verification: #9 then #10. Cheapest, and it's the gate that proves #4 works and protects #11.
- Lane B, sandbox: #7 (without MCP exposure or `fs.*`), then #12, then the agent-turn leg of #14.
- Lane C, secrets: #8 store, grants, edge injection, approvals, audit.
- Lane D, quick wins: #13, #16, #15 (owner), and the data-plane part of #14.
- Held: #6 (design doc only until #5 merges) and #11 (after #4 and #9).

### Coordination rules

- Agree with the #4 agent on how the Overlay MCP enumerates tools, so tools added in #7 and #8 are registered once and reach harness agents without re-wiring.
- #8 adds a new Convex table next to #5's `files` changes. Different tables, so conflicts in convex/schema.ts should be trivial, but both push to the shared dev Convex. Only the `staging` worktree runs `convex:push:dev`.
