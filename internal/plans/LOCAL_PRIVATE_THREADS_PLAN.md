# Private local threads: Overlay's agent running on the user's computer

Status: Mockup approved (2026-11-21). Phases 1 and 2 merged (PR 586), Agent
Host 0.6.0 published to npm, and shipped in Overlay Desktop 0.4.0 (2026-11-21).
Phases 3–5 not started. Free-tier allowances and the paid-first conflict still
open (Decision 4). Living doc: `internal/develop/private-threads.md`.

Repos: `LayerNorm/overlay-desktop`, `LayerNorm/overlay-web` (Agent Host package,
web UI).

## Problem

A thread set to "This computer" runs its tools on the computer, but everything else
happens in Overlay's cloud: the agent loop, the model calls, the transcript,
memory and billing (`internal/develop/local-computer.md`,
`LOCAL_CLOUD_CONTINUITY_PLAN.md` Decision 1). Some people want a thread whose
conversation never lives in Overlay's cloud, and every run costs Overlay server
time even when the person pays for the model themselves.

Goal: a **Cloud sync** switch next to "This computer" and the folder under the
composer. With sync off:

- the agent loop runs on the computer, not on Overlay's servers;
- the transcript is stored only on the computer and never appears on other devices
  or in the browser;
- the thread keeps the same agent and the same Overlay tools the person gave
  that agent (memory, files, notes, tasks, web search, connected apps…). A tool
  call sends what that tool needs, exactly as it would from any client, but the
  conversation itself is never stored in the cloud.

Sync off therefore means **not stored and not run in the cloud**, not "no byte
leaves the computer". The UI must say this accurately (see "What the user sees").

Non-goals: replacing the cloud harness, durable or scheduled local runs
(automations stay cloud-only), and syncing private threads between devices.

## How it fits what exists

- **The cloud harness stays as is.** `src/server/harness/` (about 23k lines) is
  built on `WorkflowAgent` from `@ai-sdk/workflow` with leases, checkpoints,
  durable waits, delegation and billing receipts behind `HarnessExecutionPorts`.
  None of that is needed on one laptop, so it is not ported.
- **The private runtime is new and small.** It uses `ToolLoopAgent` from `ai`
  (7.0.93, already a dependency): one process, one loop, stop on finish, an
  abort signal for Stop. Durability on a laptop means "the transcript is saved
  after every step", not resumable workflows.
- **It runs in the Agent Host**, which the desktop ships with its own Node.js 24
  (desktop 0.3.1). The host already implements the computer tools (shell, files,
  terminal sessions, browser, screenshots, input), so private threads call them
  in-process.
- **Overlay tools come from Overlay's MCP server.** The connected-agent server
  `/api/agent-mcp` this plan first named has since been removed. `/api/mcp`
  (`internal/develop/mcp-access.md`) serves the same native tool pipeline
  (`adaptToolsForMcp`) to outside apps under a tool grant. Private threads will
  connect to it from the host with a token the desktop obtains for the agent's
  grant, sending only what each tool needs, never the conversation.
- **Storage is `node:sqlite`** (built into Node 24, no native module to sign) in
  the app's support folder: threads, messages, tool results, approvals.
- **The UI is the existing web transcript.** The desktop bridge gains a
  `localThreads` capability (list, create, send, stop, approve, delete,
  sync-to-cloud, and a stream event). The web app renders private threads with
  the same transcript components; the bridge carries the UI message stream over
  IPC, never the network.
- **Shared, not duplicated:** the instructions builder, computer tool schemas,
  approval policy and message-part shapes move into packages both runtimes
  import. Anything that imports `server-only`, Convex or Vault stays
  server-side.

## Decisions (owner, 2026-11-21)

1. **Continuity Decision 1 is reversed for sync-off threads only.** Their loop
   and model credentials live on the computer. Synced local threads keep the current
   design (loop and inference in Overlay).

2. **Models in a private thread:**
   - **Own API keys** (Anthropic, OpenAI, Google, OpenRouter…), stored in the
     macOS Keychain through Electron `safeStorage`, called directly from the
     computer. Free to Overlay.
   - **Subscriptions through a local CLIProxyAPI.** The desktop runs its own
     CLIProxyAPI on localhost; the person signs in to ChatGPT/Codex, Claude
     etc. on the computer and the refresh tokens stay in the Keychain, never in
     Vault. Free to Overlay. Before each provider ships: a terms review for
     third-party use, and CLIProxyAPI (a Go binary) is bundled, signed and
     notarized with the app like Node.js.
   - **Overlay-billed models**, yes. The loop still runs locally; each model call
     goes to Overlay's metered inference endpoint and is charged to the
     workspace. Those calls pass through Overlay's servers in transit but are
     not stored with a thread. They are not free.
   - Local models (Ollama, LM Studio) can be added cheaply later; not required.

3. **Overlay tools are available in private threads.** Which tools a thread gets
   is the agent's existing tool grant, set by the person when they set up the
   agent. No separate private-thread tool policy.

4. **A new free tier.** Private threads with own keys or local subscriptions run
   for free, and some Overlay tool use is included for free. Resources with a
   real per-use cost stay paid: cloud machines and sandboxes (Boat/E2B),
   Overlay-billed inference, and likely media generation.
   *Still open, for the owner:*
   - the allowances: which tools are free and how much (for example memory and
     notes unlimited within a storage cap, web search N per day, file storage
     X MB, media generation paid);
   - **this reverses `PAID_FIRST_EXECUTION_PLAN.md`**, which is approved and in
     progress and says there is no free execution tier and BYO keys are never a
     payment bypass. That plan must be amended before Phase 3 ships, and its
     "remove free-tier infrastructure" step must not delete what this tier
     needs.

5. **Sync is chosen when the thread is created and locked.** Later, a one-way
   **Sync to cloud** action uploads a private thread's transcript and turns it
   into a normal synced thread. A synced thread never becomes private.

## What the user sees

Mockup: `internal/plans/mockups/private-threads.html` (feature `private-threads`).

- Under the composer, desktop app only: **This computer**, folder, and a third
  control, **Cloud sync**, with two choices: *Synced* ("Saved to your
  workspace", the default) and *Not synced* ("Runs and stays on this
  computer"). A note under them says Not synced runs with your own model keys
  and this computer's tools (Overlay tools arrive in Phase 3). The control
  appears only when the thread runs on This computer; a Cloud thread is always
  synced.
- Once the thread has a message the choice is fixed: the footer reads "This
  computer · folder · Not synced", in the same muted labels as today.
- In the agent's thread list, a thread that is not synced has a small Lucide
  `CloudOff` after its title. It never appears on other devices or in the
  browser, not even its title.
- The thread's options menu has **Delete from this computer** (built) and, in
  Phase 5, **Sync to cloud** (Lucide `CloudUpload`), which asks first ("Its messages and tool results are saved to your workspace, and you
  can read it from any device. This can't be undone.") and then turns it into a
  synced thread on this computer.
- No model picker in the composer: a private thread runs the agent's own model
  with a key on this computer, the provider's key or OpenRouter's
  (`src/shared/agents/private-model.ts`). Without one, a note above the message
  box says which key to add, and Settings → Desktop → Model keys adds it. Local
  subscriptions and Overlay-billed models come in Phase 4.
- Tool rows, approvals and Stop look the same as in synced threads.
- Quitting the app stops a running thread that is not synced; the transcript is
  kept up to the last step, and the person can say "continue".
- No "Mac" in the UI: it says "this computer" so it works for Windows and Linux.

## Phases

| Phase | State |
| --- | --- |
| 0: Decisions and mockup | Mockup approved; Decision 4 allowances still open |
| 1: Private runtime in the Agent Host | Merged; Agent Host 0.6.0 published; shipped in desktop 0.4.0 |
| 2: Bridge and UI | Merged and live on web; desktop 0.4.0 released; tested end to end in a desktop dev build against the PR preview, not yet in the released app |
| 3: Overlay tools and free tier | Not started |
| 4: Local subscriptions and Overlay-billed models | Not started |
| 5: Sync to cloud | Not started |

### Phase 0: Decisions and mockup

Owner sets the free-tier allowances and amends the paid-first plan. Mockup of
the composer choice, the started-thread label, the thread list mark and Sync to
cloud, checked in light and dark, desktop and narrow, and in a browser (where
the thread is not listed). Drafted; the agent-settings model picker moves to
Phase 2.

### Phase 1: Private runtime in the Agent Host

- Extract the shared pieces (instructions builder, computer tool schemas and
  approval policy, message-part types) into packages the host can bundle.
- `ToolLoopAgent` runtime in the host with the local computer tools in-process,
  approvals, Stop, step-level persistence in `node:sqlite`, and compaction when
  the context fills (reuse the cloud compaction prompt).
- Own-API-key model adapters, with keys read from the desktop through the
  bridge per run, never written to the host's config file.

Built: `overlay-agent-host private` (IPC only), `ToolLoopAgent` with the
computer tools (exec, read/write/list files, terminal) through
`LocalToolExecutor`, approvals for exec and terminal start, Stop, per-step
saves in `node:sqlite`, own keys for Anthropic, OpenAI, Google and OpenRouter.
Not built: shared-package extraction (tool names and approval rules are copied
and point at their source), compaction, screenshots/input/browser tools.

Acceptance: a private thread completes a multi-step coding task in a real folder
with approvals and Stop, survives an app restart with its transcript intact, and
a network capture shows no request to Overlay during the run (no Overlay tools
yet in this phase). Mock-model tests cover tools, approvals, Stop and saving;
a desktop dev build against the PR preview ran a real turn (write file, approval, command, reply), reloaded it from disk, kept it out of the browser and deleted it. Restart survival and the network capture are not checked yet.

### Phase 2: Bridge and UI

- `localThreads` bridge capability and events (desktop, host and
  `@overlay/desktop-bridge` contract, with the vendored copy and fingerprint
  checks updated).
- Composer choice, thread list, transcript and Model keys in the web app,
  desktop only. Sync to cloud moves to Phase 5.
- Signing out stops private runs, but keeps private threads on disk for that
  account. Deleting a private thread deletes it from disk.

### Phase 3: Overlay tools and free tier

- A token for `/api/mcp` with the agent's tool grant, obtained by the desktop
  for this person and workspace, short-lived and metered to the workspace; the
  host adds those tools to the private turn.
- Entitlements: a free plan that allows private threads on own keys and local
  subscriptions plus the Decision 4 tool allowances; sandboxes, cloud machines
  and Overlay-billed inference stay paid.
- Product analytics count private threads and runs only, never content.

Acceptance: a private thread on a free account uses memory and web search within
its allowances, is refused cleanly past them, and a network capture shows
Overlay received tool calls and token requests but no transcript.

### Phase 4: Local subscriptions and Overlay-billed models

- Bundle, sign and notarize CLIProxyAPI in the desktop; run it on localhost
  for the host only. Per provider, after the terms review: local sign-in and
  Keychain token storage in Settings → Desktop.
- Overlay-billed models through the metered inference endpoint, charged to the
  workspace, with the same budget checks as cloud runs.

### Phase 5: Sync to cloud

One-way upload of a private thread's messages and tool results into a normal
cloud thread, then removal of the local copy after the upload is confirmed.

## Risks

- **Two runtimes drift.** Mitigated by sharing instructions, tool schemas and
  approval policy, and by an acceptance suite run against both.
- **Credentials on the laptop.** API keys and subscription tokens live in the
  Keychain; the host gets them per run in memory.
- **"Private" misread.** Tool calls still send data to Overlay and third
  parties. The switch is named Cloud sync, not Private mode, and its help text
  says what stays on the computer.
- **Free tier abuse.** Free tool allowances need per-account limits and the
  same abuse controls as paid usage.
- **Support blind spot.** Overlay cannot see private transcripts to debug them.
  A local "export diagnostics" action, run by the person, covers this.
