# Private threads (Cloud sync off)

A thread on **This computer** can be set to **Not synced** before its first message. Its agent loop runs on the
computer the desktop app is open on, its transcript is stored only there, and it calls models with the person's
own keys. Plan and open phases: `internal/plans/LOCAL_PRIVATE_THREADS_PLAN.md`.

## What runs where

| Piece | Where | Code |
| --- | --- | --- |
| Agent loop | `overlay-agent-host private --state-dir <userData>/private-threads`, started by Overlay Desktop with a Node.js IPC channel (no port) | `packages/overlay-agent-host/src/private-threads*.ts` |
| Transcript | `private-threads.sqlite` in that folder (`node:sqlite`, Node 24), AI SDK UI messages saved after every step | `private-threads-store.ts` |
| Computer tools | In the host process, through the same `LocalToolExecutor` that serves synced threads; the run may use only the thread's folder, or `~/Overlay Files` | `private-threads-tools.ts` |
| Model keys | System keychain through Electron `safeStorage` (`secure-storage/private-model-key-<provider>.enc`); passed to the host per run, in memory | desktop `src/main/services/private-threads-service.ts` |
| Bridge | Capability `localThreads` (macOS only for now): `list`, `get`, `create`, `send`, `stop`, `update`, `delete`, `keys`, `setKey`, `models`; events `localThreads.chunk`, `localThreads.turn`, `localThreads.threads` | `packages/overlay-desktop-bridge/src/index.ts` |
| UI | The agent page renders `private_…` ids with `PrivateThreadExperience` (AI SDK `useChat` over `DesktopChatTransport`), never querying Convex with them | `src/features/chat/components/private-threads/` |

The desktop app bans AI SDKs in its own source (`check:no-provider-sdks`), so every model and provider call lives in
the Agent Host package. Overlay Desktop ships the host from npm (`agent-host-bundle/package.json` pins
`@layernorm/overlay-agent-host`), so a host change reaches the app only after the package is published and the pin is
bumped.

## Rules

- **Chosen before the first message, fixed after it.** Choosing Not synced on a new synced thread creates an empty
  private thread with the same agent and folder and deletes the empty synced one (`usePrivateThreadSwitch`); choosing
  Synced does the reverse. Convex refuses to delete an agent's last thread, which then simply stays.
- **Owned by one person in one workspace.** Every bridge call names `{userId, workspaceId}`; the host lists and opens
  only that owner's threads. Another account on the same computer sees none of them.
- **Folders the page cannot invent.** `create` and `update` accept only `~/Overlay Files`, folders chosen in the system
  folder dialog (`localComputer.chooseFolder`, remembered in `private-threads/folders.json`) and folders already
  approved for this computer's host connection.
- **Approvals as in cloud threads.** `computer_exec` and starting a `computer_terminal` session ask first (AI SDK tool
  approval); the page answers with `addToolApprovalResponse` and the turn continues. Tool names and inputs match the
  cloud computer tools so tool rows look the same.
- **Keys are checked, never read back.** `setKey` lists the provider's models with the key before storing it; the page
  only learns which providers have a key. Keys are per computer, not per Overlay account.
- **Stop and quit.** Stop aborts the turn; quitting or signing out stops runs, and the transcript keeps everything up to
  the last finished step. Signing out keeps threads on disk.
- **Nothing reaches Overlay.** A private turn calls only the chosen model provider. Overlay tools (memory, files, web
  search…) are not in private threads yet; they will come through `/api/mcp` (Phase 3 of the plan).

## Testing

- Host: `npm --prefix packages/overlay-agent-host test` (Node 24) runs `private-threads.test.ts` with a mock model:
  tool call and saved transcript, approval then run, Stop, owner isolation, request validation.
- Desktop: `npm run typecheck` and the contract tests. For a dev build with an unpublished host, bundle the host
  (`esbuild packages/overlay-agent-host/dist/cli.js --bundle --platform=node --format=esm --outfile=<dir>/cli.mjs`)
  and start Electron with `OVERLAY_DESKTOP_DEV_HOST_CLI=<dir>/cli.mjs`.
