# Private local threads: Overlay's agent running on the user's computer

Status: Mockup approved (2026-11-21). Phases 1 and 2 merged (PR 586), Agent
Host 0.6.0 published to npm, and shipped in Overlay Desktop 0.4.0 (2026-11-21).
Free tier approved (Decision 4, 2026-11-24) and the paid-first plan amended.
Phase 1–2 gaps closed and Phase 3 merged (PR 618, 2026-11-25): live on web, Convex
production deployed, Agent Host 0.7.0 published to npm, and shipped in Overlay Desktop 0.5.0
(2026-11-26). Phase 4 (plans and Overlay-billed models) built in a draft PR (2026-11-27): not merged, not released
(it needs Agent Host 0.8.0 published and a desktop release), not accepted. Phase 5 not started. Living doc:
`internal/develop/private-threads.md`.

Repository: `LayerNorm/overlay` (`apps/desktop`, `packages/overlay-agent-host`, web UI).

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
     CLIProxyAPI on localhost; the person signs in to ChatGPT (Codex) and Claude
     on the computer and the refresh tokens stay in the Keychain, never in
     Vault. Free to Overlay. CLIProxyAPI (a Go binary) is bundled, signed and
     notarized with the app like Node.js. The owner waived the terms review on
     2026-11-27: using a person's Claude and ChatGPT plans is allowed and ships
     fully, not behind a flag.
   - **Overlay-billed models**, yes. The loop still runs locally; each model call
     goes to Overlay's metered inference endpoint and is charged to the
     workspace. Those calls pass through Overlay's servers in transit but are
     not stored with a thread. They are not free.
   - Local models (Ollama, LM Studio) can be added cheaply later; not required.

3. **Overlay tools are available in private threads.** Which tools a thread gets
   is the agent's existing tool grant, set by the person when they set up the
   agent. No separate private-thread tool policy.

4. **A free tier for private threads (approved 2026-11-24).** It applies only
   to private threads in the desktop app, in a personal workspace with no paid
   plan. Team workspaces stay paid-only, and paying lifts every limit and
   charges usage to the workspace.

   | Item | Free tier |
   | --- | --- |
   | Local agent loop and computer tools | Unlimited |
   | Own API keys and local subscriptions | Unlimited |
   | Notes, tasks, memory and knowledge reads and search | Unlimited within the storage cap; search matches words only, since embeddings are a paid resource |
   | Saving a memory when the agent explicitly does so | Unlimited; nothing is extracted from private conversations automatically |
   | Overlay Files storage | 100 MB |
   | Web search | 50 a month |
   | Overlay Cloud computers, image and video generation, transcription, automations, browser tasks, Overlay-billed models, synced threads | Paid only |

   - Limits are counted per person, not per workspace, on the server in
     `/api/mcp`; the desktop is never trusted for them.
   - At a limit the tool returns a plain refusal ("You've used this month's 50
     free web searches. Upgrade the workspace to keep searching."), so the agent
     carries on without that tool.
   - `PAID_FIRST_EXECUTION_PLAN.md` is amended: no free execution in Overlay's
     cloud stays the rule. The only exception is private threads, where Overlay
     runs no inference, plus this capped tool allowance. BYO keys remain no
     payment bypass for hosted execution.

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
  from the first source that has it: a signed-in Claude or ChatGPT plan, the
  provider's key or OpenRouter's, then Overlay's models in a paid workspace
  (`src/shared/agents/private-model.ts`). Without one, a note above the message
  box says what to set up, and Settings → Desktop → Plans and Model keys set it
  up.
- Tool rows, approvals and Stop look the same as in synced threads.
- Quitting the app stops a running thread that is not synced; the transcript is
  kept up to the last step, and the person can say "continue".
- No "Mac" in the UI: it says "this computer" so it works for Windows and Linux.

## Phases

| Phase | State |
| --- | --- |
| 0: Decisions and mockup | Done: mockup approved, free tier approved 2026-11-24 |
| 1: Private runtime in the Agent Host | Merged; Agent Host 0.6.0 published; shipped in desktop 0.4.0 |
| 2: Bridge and UI | Merged and live on web; desktop 0.4.0 released; tested end to end in a desktop dev build against the PR preview, not yet in the released app |
| 3: Overlay tools and free tier | Merged (PR 618) and live on web; Convex production deployed; Agent Host 0.7.0 published; shipped in desktop 0.5.0 (signed, notarized, published 2026-11-26). QA'd end to end in a desktop dev build against the PR preview (15/15); the released 0.5.0 app has not been run against production yet. Not built: analytics, the allowance usage display and the export diagnostics action |
| 4: Local subscriptions and Overlay-billed models | Built in a draft PR (2026-11-27); not merged, released or accepted. Needs Agent Host 0.8.0 published and the desktop's host pin and web enrollment bumped to it, then a signed, notarized desktop release. Real sign-in against Claude and ChatGPT and a paid Overlay-models turn are untested |
| 5: Sync to cloud | Not started |

### Phase 0: Decisions and mockup

Done: the owner set the free-tier allowances (Decision 4) and the paid-first
plan is amended. Mockup of
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
Later (PR 618, with Agent Host 0.7.0): the computer tool inputs, approval rules,
browser result text and context compaction moved into the bridge protocol package
(`computer-tools.ts`, `agent-context.ts`), which the cloud and the host both import;
private threads gained screenshots and input (macOS), the browser and open URL
(macOS and Linux), and compaction with the cloud's prompt, its summary saved with
the thread. Screenshot images are dropped from finished turns.

Acceptance: a private thread completes a multi-step coding task in a real folder
with approvals and Stop, survives an app restart with its transcript intact, and
a network capture shows no request to Overlay during the run (no Overlay tools
yet in this phase). Mock-model tests cover tools, approvals, Stop and saving;
a desktop dev build against the PR preview ran a real turn (write file, approval, command, reply), reloaded it from disk, kept it out of the browser and deleted it. Quitting mid-turn and reopening is covered by a host test; the desktop restart and network capture are checked in Phase 3's QA.

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

Built: `POST /api/v1/mcp/private-thread` mints a one-hour sealed token (person,
workspace, agent; no grant row) that the desktop main process asks for with its
own session before each turn; `/api/mcp` serves the agent's grant (paid), the
free tier (unpaid, one person) or nothing (unpaid team); web searches are counted
in `privateThreadAllowances` before they run; free storage is 100 MB per person;
the host connects with `@ai-sdk/mcp` for the turn. Not built: product analytics
for private threads, and a usage display of the free allowance.

Acceptance: a private thread on a free account uses memory and web search within
its allowances, is refused cleanly past them, and a network capture shows
Overlay received tool calls and token requests but no transcript.

### Phase 4: Local subscriptions and Overlay-billed models

- Bundle, sign and notarize CLIProxyAPI in the desktop; run it on localhost
  for the host only. Per provider: local sign-in and Keychain token storage in
  Settings → Desktop (terms review waived by the owner, 2026-11-27).
- Overlay-billed models through the metered inference endpoint, charged to the
  workspace, with the same budget checks as cloud runs.

Built (draft PR, 2026-11-27): CLIProxyAPI 8.1.7 pinned by archive and binary
checksum (arm64 and x64) in `build-agent-host-bundle.mjs` and
`native-artifacts.json`, packaged beside Node.js so electron-builder signs and
notarizes it; the desktop's plan proxy (loopback, random port, per-launch keys,
Keychain tokens, sign-in with a loopback callback listener, sign-out);
`localThreads.plans`, `signIn`, `cancelSignIn`, `signOut`; Settings → Desktop →
Plans and onboarding step 4; Agent Host 0.8.0 turn models for plans and
Overlay's models; `POST /api/v1/private-threads/model-access` and the metered
relay `POST /api/private-threads/model` (paid only, 2% check before, usage
charged after, nothing stored). The model source is chosen automatically:
plan, key, then Overlay's models. Not done: publishing Agent Host 0.8.0,
bumping the desktop pin, a desktop release, and QA with real accounts.

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
