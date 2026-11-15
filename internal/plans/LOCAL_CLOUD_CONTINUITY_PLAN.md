# Local and cloud continuity: one Overlay harness on your Mac and in the cloud

Status: Approved by the owner (2026-11-14); implementation in progress. See the
progress table for what is merged, deployed and accepted.

Repos: `LayerNorm/overlay-web` (this repo) and `LayerNorm/overlay-desktop`.

## Problem

Agent-forward users still run their agents locally, where their repositories,
signed-in browsers, tools and configuration live. Overlay's cloud gives them
asynchronous, parallel agents, but today the two worlds don't connect:

- The desktop app is a thin web shell. Its local terminal, runtime and knowledge
  sync were retired (`internal/develop/desktop-web-shell.md`).
- The only way an agent can act on the user's machine is a third-party harness
  (Claude Code, Codex) run through the Agent Host over ACP. The native Overlay
  harness, which carries the subscriptions, memory, tools, approvals and billing,
  can act only on cloud Computers.
- Nothing moves a local project's context into the cloud so an agent can carry on
  the same work there.

Goal: whatever an Overlay agent can do on a cloud Computer, it can also do on the
user's Mac, under the same identity, thread, approvals and subscriptions. The
user can hand a project from the Mac to the cloud and back without losing context.

Non-goals: becoming an agentic development environment that hosts many
third-party harnesses, any ACP fallback, continuous two-way file sync, and running inference on
the laptop (local dictation models are unaffected).

## Decisions

1. **The harness loop and inference stay in Overlay.** The native
   harness runs server-side as it does today. Only tool execution moves. The
   thread, run state, memory, approvals and billing therefore remain in the
   control plane, so a handoff only changes where the tools run, not who owns the
   conversation. Subscription credentials (including rotating refresh tokens)
   never reach the laptop. Cost: one cloud→host round trip per tool call, and
   local tools need a network connection.
2. **The user's Mac is a Computer.** Add a provider-neutral execution
   target interface whose implementations are the cloud Computer (Box) driver and
   a local Agent Host. Local tools reuse the existing Computer tool contracts
   (`computer_terminal`, `computer_browser`, `computer_input`, screenshots, file
   reads and writes) so agents, approvals, takeover, risky-click confirmation and
   tool rows behave identically. The agent or user picks a target; the tool
   surface does not change.
3. **Local tools live in the Agent Host, not in a desktop renderer.**
   This reverses the retirement of the desktop's local runtime, but keeps
   "native code owns only OS integrations": the Agent Host is already the
   outbound-only, signed, enrolled bridge with approved roots. The desktop app
   bundles and supervises the host and exposes OS permissions (Accessibility,
   Screen Recording) through the bridge.
4. **Handoff, not sync.** Moving a project between the Mac and the cloud
   is an explicit checkpoint with a single writer at a time, enforced by a
   project lease. No background two-way file sync.
5. **No ACP fallback.** The local target does not depend on ACP adapters or a
   third-party harness. The Agent Host's tool executor runs with no adapter
   configured, and the desktop does not ship one for this feature. Subscriptions
   reach the native harness only through the existing server-side bridge.

## Phases

### Progress

| Phase | State |
| --- | --- |
| 1: Mac as a Computer | Implemented on the feature branch (web, Convex, Agent Host 0.5.0, desktop branch); unit, Convex and server end-to-end tests pass. Not merged, not deployed; Agent Host 0.5.0 is not published. Hosted preview QA pending. |
| 2: Projects and context packages | Not started |
| 3: Continue in cloud / bring back | Not started |
| 4: Delegating from local threads | Not started |
| 5: Subscription coverage | Not started |

### Phase 1: Mac as a Computer

- Define the execution target interface in a shared package (target identity,
  capabilities, availability, tool dispatch). Wrap the existing cloud Computer
  driver as the first implementation with no behavior change.
- Add an Agent Bridge Protocol capability and command for tool execution. The
  host advertises it; Overlay sends bounded, signed, idempotent tool commands and
  receives results with the existing acknowledgement and replay semantics.
- Implement local tools in the Agent Host:
  - terminal sessions with the same session ids, output limits and cancellation
    as `computer-desktop-driver.md`, restricted to approved roots as working
    directories;
  - file read, write and search within approved roots, rejecting symlink escapes;
  - browser control of a dedicated Chrome profile over loopback-only CDP. Using
    the user's everyday profile is a separate opt-in decision (see open
    questions);
  - screenshots and input through macOS Screen Recording and Accessibility
    permissions, requested and reported through the desktop bridge.
- Reuse approvals: typing and key input, risky browser clicks and writes outside
  approved roots require approval in personal runs. Unattended automations deny
  approval-required calls, as on cloud Computers.
- Desktop enrolls its own bundled host on sign-in with one confirmation (no
  enrollment code), and shows the Mac as a Computer in the agent's environment
  picker. Sign-out stops the host and revokes the tool capability.
- Offline behavior: if the host is unreachable, the tool fails with a typed
  `target_offline` result and the run can wait, switch target with approval, or
  stop.

Acceptance: an Overlay agent on a subscription model completes a multi-step task
on a real Mac (edits files, runs tests, drives the browser), with approvals,
human takeover, tool rows and billing matching a cloud Computer run. Sign-out,
sleep/wake and host restart settle in-flight tool calls.

### Phase 2: Projects and context packages

- A project binds an agent or thread to a local folder (a git repository or a
  plain folder) on an enrolled Mac.
- A context package is the portable part of a project: instructions (for
  example `AGENTS.md`, `CLAUDE.md`), skills, MCP server definitions without secret
  values, and a list of needed environment values. Reuse the cleaning and
  allowlist rules from the retired `export-config` host command; secrets are never
  exported and are requested by name instead.
- The context package is versioned in Overlay and shown to the user before any
  upload.

### Phase 3: Continue in cloud / bring back

- **Continue in cloud**: take the project lease, then snapshot the working state.
  For git, push a work branch that includes uncommitted and untracked files inside
  the approved roots. For other folders, use the connected-agent drive
  (`features.connectedAgentDrive`) into Files. Provision or resume the agent's
  cloud Computer, check out the snapshot, apply the context package, prompt for
  needed values, and continue the same thread on the cloud target.
- **Bring back to my Mac**: take the lease back, then fetch and check out the
  branch (or apply a patch) locally after showing the diff. Conflicts with local
  edits made in the meantime stop the handoff and ask the user to choose.
- The thread records every handoff (from, to, snapshot reference) so the agent
  and the user can see where work happened.

### Phase 4: Delegating from local threads

- A local thread can delegate to cloud agents with a context package and a
  snapshot reference through the existing agent-to-agent tools
  (`internal/develop/agent-to-agent.md`). Results come back as branches or
  patches to review before bringing them back to the Mac.

### Phase 5: Subscription coverage

- Add Gemini and GitHub Copilot subscriptions through the existing CLIProxyAPI
  bridge when the pinned revision supports them, with the same fenced
  credential lifecycle.

## Risks

- **Local blast radius**: approved roots are not an operating-system sandbox.
  Approvals, root checks and a clear indication on the Mac that an agent is
  acting are required. Strict isolation still needs a container or VM.
- **Latency**: per-call round trips may slow tool-heavy runs. Measure in Phase 1
  before considering a local harness loop.
- **Handoff correctness**: snapshots must capture uncommitted and untracked work
  without secrets (`.env` files, keys). Default exclusions plus a preview of what
  is uploaded.

## Open questions

- Should browser tools be able to use the user's everyday Chrome profile
  (signed-in sessions, much more useful but much riskier), or only a dedicated
  profile?
- Is the Mac a Computer per user, or can a workspace agent be granted access to a
  member's Mac?
- Windows and Linux desktop support timing.
- Does local tool use bill anything (it uses no Overlay compute), and how is it
  shown on the run?
