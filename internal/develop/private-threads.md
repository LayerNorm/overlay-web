# Private threads (Cloud sync off)

A thread on **This computer** can be set to **Not synced** before its first message. Its agent loop runs on the
computer the desktop app is open on, its transcript is stored only there, and it calls models with the person's
own keys. Plan and open phases: `internal/plans/LOCAL_PRIVATE_THREADS_PLAN.md`.

## What runs where

| Piece | Where | Code |
| --- | --- | --- |
| Agent loop | `overlay-agent-host private --state-dir <userData>/private-threads`, started by Overlay Desktop with a Node.js IPC channel (no port) | `packages/overlay-agent-host/src/private-threads*.ts` |
| Transcript | `private-threads.sqlite` in that folder (`node:sqlite`, Node 24), AI SDK UI messages saved after every step | `private-threads-store.ts` |
| Computer tools | In the host process, through the same `LocalToolExecutor` that serves synced threads; the run may use only the thread's folder, or `~/Overlay Files`. Exec, files and terminal everywhere; browser and open URL on macOS and Linux; screenshots and input on macOS. Inputs, approval rules and browser result text come from the bridge protocol's `computer-tools.ts`, shared with the cloud tools | `private-threads-tools.ts` |
| Context | Before each step, `compactHarnessPrompt` (bridge protocol `agent-context.ts`, shared with the cloud harness) folds older history into a summary written by the thread's model once the prompt passes 80% of the model's context window; the summary and the last message it covers are saved on the thread, so later turns send only what follows it | `private-threads-context.ts` |
| Overlay tools | Overlay's MCP server `/api/mcp`, called from the host with `@ai-sdk/mcp` for the length of one turn | host `private-threads-overlay-tools.ts`; server `src/server/mcp/private-thread-tools.ts` |
| Local MCP servers | stdio servers the person runs on this computer: the list in `private-threads/local-mcp-servers.json` (name, command, arguments, folder, names of environment values), the values in one keychain entry per server (`local-mcp-env-<id>.enc`). The host starts them with the official MCP SDK's `StdioClientTransport` and `@ai-sdk/mcp`, shares a running server between turns, stops it after 10 idle minutes, when it is removed or changed, and on quit | desktop `local-mcp-servers.ts`, `private-threads-service.ts`; host `private-threads-local-mcp.ts` |
| Overlay tools token | `POST /api/v1/mcp/private-thread` `{workspaceId, agentId}`, asked for by the desktop main process with its own signed-in session before each turn; sealed `ovmcu_t_` value naming person, workspace and agent, valid one hour, no grant row | desktop `overlayToolsAccess`; `McpAccessService.issuePrivateThreadToken` |
| Model keys | System keychain through Electron `safeStorage` (`secure-storage/private-model-key-<provider>.enc`); passed to the host per run, in memory | desktop `src/main/services/private-threads-service.ts` |
| Bridge | Capability `localThreads` (macOS only for now): `list`, `get`, `create`, `send`, `stop`, `update`, `delete`, `keys`, `setKey`, `models`; events `localThreads.chunk`, `localThreads.turn`, `localThreads.threads`. Capability `localMcp` (only when the bundled host runs local servers): `list`, `add`, `remove`, `check` | `packages/overlay-desktop-bridge/src/index.ts` |
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
- **Approvals as in cloud threads.** `computer_exec`, starting a `computer_terminal` session, typing and keys, and clicks
  marked `confirm` ask first (`computerToolRequiresApproval`, AI SDK tool approval); the page answers with `addToolApprovalResponse` and the turn continues. Tool names and inputs match the
  cloud computer tools so tool rows look the same.
- **Keys are checked, never read back.** `setKey` lists the provider's models with the key before storing it; the page
  only learns which providers have a key. Keys are per computer, not per Overlay account.
- **Keys from the shell are offered, not taken.** Desktop setup lists model keys set in the login shell (`localSetup`,
  `internal/develop/desktop-web-shell.md`) by variable name and last four characters; *Use this key* checks one with
  the provider and stores it exactly like `setKey`.
- **Screenshots are not kept.** A finished turn's screenshot images are dropped from the saved transcript and from what
  later turns send; the tool row stays and the model is told to take a new one.
- **Stop and quit.** Stop aborts the turn; quitting or signing out stops runs, and the transcript keeps everything up to
  the last finished step. Signing out keeps threads on disk.
- **The conversation never reaches Overlay.** A private turn sends its transcript only to the chosen model provider.
  Overlay tools are called over `/api/mcp` with the arguments of each call; the page never holds the token, and the
  desktop sends it only to its own server's `/api/mcp`. Without a token (signed out, offline) the turn runs with this
  computer's tools only.
- **Which Overlay tools.** The agent's own tool grant, minus what `/api/mcp` withholds from outside apps (computers,
  generated UI, agent editing, posting). Paid workspace: the whole grant, charged to the workspace like any agent
  turn. Unpaid workspace with only this person: the free tier (`src/shared/billing/private-thread-allowance.ts`),
  memory, files and notes, tasks, skills and web search; memory and file search match words only, because without
  budget for embeddings `convex/knowledge/knowledge.ts` stores chunks without them and searches by text; storage is the person's free amount
  (`FREE_PLAN_STORAGE_BYTES`, 100 MB); web searches (each query of a batch, each deep search or page fetch) count
  against 50 a month per person in `privateThreadAllowances`, counted before they run, and the tool says so plainly
  at the limit. Unpaid workspace with other people: no Overlay tools.
- **Local MCP servers.** Added by hand in Settings → Desktop → MCP servers on this computer (a command line split
  without a shell, plus `NAME=value` lines) or imported from Claude Code, Codex, Claude Desktop, Cursor or Gemini CLI
  (desktop setup and Settings → Import). They belong to the computer, like model keys. A turn gets them only when the
  agent's grant includes MCP servers (`capability:mcp`): the page sends `agent.localMcp: true` and the desktop app adds
  every server, with its environment values from the keychain and the login shell's `PATH` (where `npx` and `uvx`
  live) unless the server sets its own. Servers start with only the basic environment (home, user, `PATH`…) plus their
  own values, in their folder or the home folder. Tools are named `<server>__<tool>`, static tools so the page shows
  the same row and approval card; in Ask mode every call asks first, since a local server can do anything its command
  can. A server that fails to start is left out of the turn and named in the model's instructions, with the end of its
  error output and its environment values hidden. The page never receives environment values; `check` starts a server
  and returns its tool names. Importing again updates the same server (by scan item, or by identical command,
  arguments and folder) and adds the imported environment values to the ones it has.
- **Memory is the person's.** Tool saves from a private thread go through the outside-app path, which saves to the
  person, not the workspace; nothing is extracted from a private conversation automatically.

## Testing

- Host: `npm --prefix packages/overlay-agent-host test` (Node 24) runs `private-threads.test.ts` with a mock model:
  tool call and saved transcript, approval then run, Stop, owner isolation, request validation, Overlay tools joining
  a turn and closing, a turn without them, compaction and the saved summary, quitting mid-turn and reopening,
  screenshot images dropped, and the tool list and approval rules per platform. `private-threads-local-mcp.test.ts`
  runs the fixture stdio server `src/fixtures/local-mcp-server.mjs`: start and tool list, approval in Ask mode, one
  process shared by turns, idle stop, restart on change, stop on removal and quit, start failures with hidden values.
- Server: `McpAccessService.test.ts` (the token), `private-thread-allowance.test.ts` (the free grant) and
  `convex/privateThreadAllowances.convex.test.ts` (the monthly counter).
- Free tier on This computer: a workspace that never set up billing gets the free connected-computer limits (one
  computer) instead of failing (`bootstrap.ts` `policyLimits`).
- Desktop: `bun run typecheck` and the contract tests; `local-mcp-servers.test.ts` (values only in the keychain,
  importing again updates) and `local-setup.test.ts`. For a dev build with an unpublished host, bundle the host
  (`esbuild packages/overlay-agent-host/dist/cli.js --bundle --platform=node --format=esm --outfile=<dir>/cli.mjs`)
  and start Electron with `OVERLAY_DESKTOP_DEV_HOST_CLI=<dir>/cli.mjs`.
