# This Mac: the user's own computer as an Overlay Computer

Overlay runs only its own agent harness. A user can connect their own machine
(Settings → Desktop → This Mac, or a one-copy command) so Overlay agents can use
its shell, files, terminal sessions, screen, input and an Overlay Chrome profile.
The agent loop, model calls and subscriptions stay in Overlay; only tool
execution runs on the machine. There is no third-party harness and no ACP.

## Pieces

| Piece | Where |
| --- | --- |
| Agent Host (local tools only) | `packages/overlay-agent-host` (`@layernorm/overlay-agent-host`) |
| Host contract | `packages/overlay-agent-bridge-protocol` (enrollment, signed requests, capabilities, local tools) |
| Enrollment, credentials, heartbeat, folders, revoke | `src/server/agents/ConnectedAgentControlPlaneService.ts`, `convex/agents/environmentControlPlane.ts` |
| Tool calls | `src/server/computers/local/LocalComputerService.ts`, `convex/agents/localToolCalls.ts`, routes under `agent-environments/[environmentId]/local-tool-calls` |
| Computer tools on the Mac | `src/server/computers/local/LocalHostSandboxInstance.ts`, `computerInstanceFor` in `src/server/tools/tools/overlay-executes.ts` |
| Desktop | Settings → Desktop → This Mac (`DesktopLocalComputerSettings.tsx`), desktop bridge `agentHost.*` / `localComputer.*` |

## Enrollment and trust

A workspace owner or admin creates a ten-minute, single-use code. The host proves
possession of its Ed25519 device key, shows a three-word verification phrase and
waits; the person approves the machine and the folders it may use. The desktop
matches the phrase its host printed to the pending enrollment, so the user only
picks folders. Later host requests carry a 15-minute bearer credential plus a
signature over method, path and query, body hash, timestamp, nonce and credential
hash; rotation can keep or narrow scopes, never add one. A host whose credential expired while the Mac slept may still renew it through `credentials/refresh` for 30 days after expiry, with the same device signature and single-use nonce; renewing revokes the old credential, and no other route accepts an expired one. Credential scopes:
heartbeat, capabilities, `commands:poll` (local tool long-poll),
`events:write` (local tool results) and credential refresh. Revoking a machine
revokes its credentials. Connecting a machine follows the Computers feature
(`features.computers`); there are no separate flags.

## Local tools

- **Capability.** The host advertises `localTools` (`version: 1`, `os`,
  `features`, `homeDirectory`) at enrollment and on refresh. Hosts without it
  are refused.
- **Delivery.** `GET local-tool-calls` long-polls up to 20 s; `POST
  local-tool-calls/{callId}/result` answers. `agentLocalToolCalls` rows are at
  most once: claimed before running, expired (not delivered) after their
  deadline, answered once; the waiting server expires them on timeout. Rows are
  deleted after an hour.
- **Who can use it.** Only the person who approved the machine, while it is
  online and they remain an active workspace member. Automations never use a
  local machine.
- **Tools.** `LocalHostSandboxInstance` presents the machine through the sandbox
  interface, so every `computer_*` tool runs unchanged; desktop and terminal
  commands go to the host's native driver instead of the cloud Python driver.
  Each tool takes an optional `target` (`cloud` or `local`); without it a bound
  cloud Computer wins and the Mac is the fallback. An agent thread set to run on
  one of the person's Macs sends tools to that Mac by default and never falls back
  to another (`localEnvironmentId`; `internal/develop/thread-folders.md`).
- **Several Macs.** A person can connect any number of Macs. Without a thread
  choice, `local` means the one seen most recently. Each Mac stays personal: a
  workspace agent never uses a teammate's Mac. Approvals, risky-click
  confirmation and tool rows match cloud Computers. Cloud gateway credentials
  are never sent to the machine.
- **Host executor** (`packages/overlay-agent-host/src/local-tools*.ts`). Shell
  commands run in the user's login shell inside approved folders; paths are
  resolved through symlinks before the folder check. Terminal sessions mirror
  the cloud driver (ids, eight-session limit, output limits). macOS screen
  control uses only built-in tools (`screencapture`, `sips`, JavaScript for
  Automation) and needs the Screen Recording and Accessibility permissions of
  the app that started the host. Typing pastes through the clipboard and
  restores plain-text clipboard content. The browser is a dedicated Overlay
  Chrome profile on loopback DevTools, never the user's everyday profile.
- **Folders.** The person who connected a Mac, or a workspace owner or admin,
  can change its approved folders (`PATCH roots`); the host applies the change
  when it next renews its credential, within 15 minutes. `POST copy-to-files`
  copies one of them into Overlay Files once.
- **Unavailable reasons.** When no usable Mac is found, `unavailableReason`
  reports whether the user's Mac is offline (with its last check-in),
  connected without local tools, or not set up, and the tool result tells the
  agent what the user should turn on (Settings → Desktop → This computer, the
  "Let agents run threads on this computer" switch, which also keeps it on after
  a restart or sign-out). With no target and no cloud Computer bound, the
  Mac's reason is returned rather than the cloud's.
- **Folders are a scope, not a sandbox.** Use a restricted account, container or
  VM when strict isolation is needed.

## Host package

`overlay-agent-host connect <code> --server <origin> --local-tools --run`
enrolls and runs; `run --config`, `doctor --config` and `service
install|uninstall|status --config` (macOS launchd) restart and inspect it.
`config.json` must say `"localTools": true`; a configuration written for a
third-party agent is refused with a reconnect message. Host and protocol
versions are released together; the web enrollment command, desktop pin and host
CLI must name the same version (`npm run verify:agent-host-release`, and
`scripts/ci/desktop-web-shell-boundary.mjs` checks the desktop pin). Publish with
the `publish-agent-host` workflow after `npm run check:local-computer:release`.

## Removed third-party agent data

`convex/migrations/purgeConnectedAgents.ts` deletes everything the removed
connected-agent feature stored (bindings, remote sessions and runs, commands,
events, MCP calls, drive data, artifacts, agent accounts and imported configs).
After the deploy that removed the feature: run
`scripts/db/purge-connected-agent-credentials.ts` (vault secrets, then their
rows), `migrations/purgeConnectedAgents:purgeRemovedTables` and
`migrations/purgeConnectedAgents:purgeRemoteRuns` against each deployment. Once
production reports nothing left, delete that migration, the script,
`convex/lib/retiredConnectedAgentSchema.ts` and the remote-run fields on
`conversationAgentRuns` and `conversationMessages`.

## QA

`npm run check:local-computer` covers Convex, server, protocol and host. A
protected Preview needs `--hosting-auth-file` (a private, one-shot file holding
the exact Preview origin and the project bypass secret; see
`browser-testing-with-agent-browser.md`). Real screen and input control needs a
Mac that has granted the permissions above.
