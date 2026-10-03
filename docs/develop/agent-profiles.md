# Agent profiles (imported Claude Code / Codex config)

An **agent profile** is a versioned, cleaned copy of a person's Claude Code or Codex setup, applied to an Overlay Cloud agent's machine. It is workstream 3 of `docs/plans/OVERLAY_CLOUD_AGENTS_PLAN.md`.

## What is imported

| Harness | Imported | Never imported |
| --- | --- | --- |
| Claude Code | `CLAUDE.md`, `settings.json` (sanitized), `agents/`, `commands/`, `skills/`, `output-styles/`, `mcpServers` from `~/.claude.json` | `.credentials.json`, history, projects, plugins, caches, hook scripts |
| Codex | `AGENTS.md`, `config.toml` (sanitized), `prompts/`, `skills/` | `auth.json`, sessions, history |

The allowlist and every cleaning rule live in one file, `packages/overlay-agent-bridge-protocol/src/index.ts` (`analyzeAgentProfile`). The same rules run **three times**: on the person's machine (so nothing sensitive is even sent), on the server when an upload arrives, and again when a stored bundle is read back. A sender cannot skip them.

## Cleaning rules (why each exists)

- Files that can hold credentials or sessions are dropped, never redacted-and-kept.
- Secret-looking values in MCP `env`, headers, args, or URLs become `${NAME}` placeholders and show up as "needs a value" in the UI. The value is set by the owner, stored in the encrypted credential vault (`agentSecrets` holds only the name and an opaque reference), and handed to the agent process per run (`agentSecretEnv` → `issueRunCredentials`, provider credentials win on a name clash). Names that change sign-in or process start (`PATH`, `ANTHROPIC_*`, `OVERLAY_*`, …) are refused.
- Hooks, `notify`, and `statusLine` run commands, so they are listed and **off** until the person turns them on (the applied `settings.json` is written without them until then).
- Limits: 3000 files, 256 KB per file, 12 MB total; upload 4 MB gzipped, 24 MB inflated.

## Flow

1. The agent page (Config section) calls `POST /api/v1/agents/{id}/profile {action:'import_code'}`: a one-time `ovprof_` code (hashed at rest, 15 minutes) bound to the agent, workspace, harness, and person.
2. Either run `npx --yes --package node@24 --package @layernorm/overlay-agent-host@latest overlay-agent-host export-config <claude-code|codex> --server … --code …` on the computer (lists what it found, `--dry-run` sends nothing), or pick the `.claude` / `.codex` folder in the browser. Both gzip a JSON upload to the public `POST /api/v1/agent-profiles/upload` with the code as a bearer token.
3. The server cleans it again and stages a version (`agentProfiles` + `agentProfileChunks`, gzip+base64 in ≤900k-char chunks to stay under Convex document limits). The page shows counts, what was left out and why, warnings, needed values, and hooks.
4. **Apply** (`CloudAgentMachineService.applyProfile`): wakes the machine, writes files under `/home/user/.claude` or `/home/user/.codex` in batches, merges `mcpServers` into `/home/user/.claude.json`, and records what it owns in `/home/user/.overlay/profile-managed.json`. Re-applying removes only files a previous profile put there, so anything the agent created itself is kept.
5. Versions: the last 9 superseded versions are kept; **Restore** applies an earlier one the same way. Archiving the agent deletes its versions and stored values.

## Gotchas

- The host command needs the published `@layernorm/overlay-agent-host` containing `export-config` (npm publish is a manual owner step). Folder upload works without it.
- Apply and the machine: the machine is woken for an apply, which is billed like any run time.
- Codex apply writes `config.toml` and files but is less tested than Claude Code.
- Only a person who can edit the agent (creator, or workspace owner/admin) can import, apply, or set values.

## How Claude Code sees the imported config (found live)

- acpx runs Claude Code with the user settings source **off** by default, so `~/.claude` (skills, commands, subagents, settings) is invisible to the agent even though the files are on disk. The machine's host is started with `ACPX_CLAUDE_INCLUDE_USER_SETTINGS=1` (`detached()` in `cloud-agent-machine.ts`). A machine whose host started before that change needs a Restart once.
- Skills are read when a Claude Code session starts, so an applied profile shows up on the next turn, not mid-turn.
- Applying wakes a paused machine and brings its host back; verified live (apply while paused: about 16 s).
- Pausing or restarting a machine now fails the runs it was in the middle of right away (`control()` asks the control plane to sweep with `abandonEnvironmentId`), with a message to send the message again. A run that is cut off some other way is failed by the reconcile sweep after 15 minutes without events (`ABANDONED_CLOUD_RUN_MS`). Until then, "could not start this turn" is the one-run-per-machine limit (`managed_environment_concurrency`).
- Imported permission modes: only `default` and `plan` are kept. `bypassPermissions`, `acceptEdits`, and `dontAsk` are dropped, because Overlay's approval cards are the prompt and a mode that skips or denies it would sidestep or silently break them. `allow` rules are kept.
- Applying a version removes the files the previous version wrote and the folders that leaves empty (never the harness folder).
- MCP servers: stdio servers run on the machine and need network for `npx` downloads; their secrets arrive as environment variables per run.

## Machine wake and command numbering (found live, fixed)

- **Waking a machine idle for more than 15 minutes failed.** Host credentials last 15 minutes and the host refreshes them, but the machine idle-stops after about the same time, so it woke with an expired credential and could not refresh. An expired credential may now refresh itself (and nothing else) for Overlay Cloud environments for 7 days, with the machine's device key still signing the request (`CLOUD_REFRESH_EXPIRED_GRACE_MS` in `ConnectedAgentControlPlaneService`; `expiredGraceMs` on the nonce check in Convex).
- **A hole in the host's command numbers stuck it forever.** The host takes commands strictly in sequence and does not record a rejected gap, so one skipped or cancelled command made every later command fail ("the connected environment rejected this command"). Claiming now delivers a command whose run is over as a harmless `shutdown` (a host accepts it for a run it does not know), and the sweep no longer cancels undelivered commands. `repairUndeliveredCancelledCommands` (internal mutation, per environment) restores commands cancelled before acknowledgement on a machine that is already stuck.

## Verified on production (2026-10-02)

- Real `~/.claude` (19 skills, settings, 750 files): exported with the host CLI, staged, applied, and the agent invoked an imported skill from `/home/user/.claude/skills`. Nothing sensitive left the machine (the CLI prints counts only; `.credentials.json`, history, and plugins are never read).
- Fixture config (CLAUDE.md, command, subagent, skill, two MCP servers, a hook, a fake token): the agent answered from the imported CLAUDE.md; the command and subagent files landed; the MCP token became `${GITHUB_TOKEN}` and the stored value reached the agent only as an environment variable during runs; the hook did not run and was absent from the applied `settings.json`; Boat's own `computer` MCP server stayed in `~/.claude.json`.
- Apply while the machine was paused (about 16 s), turning hooks on, restoring version 1, removing a value, and refusing to discard an active version.
- The first machine's dead host was the credential-expiry bug above (it had been idle for hours), not the apply.
- A stdio MCP server from an imported profile (`@modelcontextprotocol/server-everything` via `npx`) started on the machine and its `echo` tool answered through the agent.
- Wake after more than 15 minutes paused: the host came back by refreshing its expired credential. A queued turn on a cloud machine is no longer failed as "host offline" while the machine wakes (it waits for the queue's own 2-minute expiry), but a wake slower than that still shows "environment went offline" and the message must be sent again.
- Codex: a real `~/.codex` (AGENTS.md, config.toml, 6 skills) exported, staged with the notify command held back, and applied; the files landed under `~/.codex` with no `notify` or secret-looking text. Whether a Codex agent then uses them was not run (needs a Codex API key).
- Rolling back to version 1 removed version 2's command, subagent, CLAUDE.md, skill file, and MCP server.
- Not verified live: a Codex agent actually using the imported config.
