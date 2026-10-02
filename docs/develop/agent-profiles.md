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
- A run that is cut off by a pause or restart leaves a `running` session that blocks every later turn on that machine (`managed_environment_concurrency`). The reconcile sweep now fails a cloud run with no events for 15 minutes (`ABANDONED_CLOUD_RUN_MS` in `convex/agents/connectedAgents.ts`). Until it runs, "could not start this turn" is this limit. Do not pause or restart a machine while an agent is replying.
- MCP servers: stdio servers run on the machine and need network for `npx` downloads; their secrets arrive as environment variables per run.

## Verified on production (2026-10-02)

- Real `~/.claude` (19 skills, settings, 750 files): exported with the host CLI, staged, applied, and the agent invoked an imported skill from `/home/user/.claude/skills`. Nothing sensitive left the machine (the CLI prints counts only; `.credentials.json`, history, and plugins are never read).
- Fixture config (CLAUDE.md, command, subagent, skill, two MCP servers, a hook, a fake token): the agent answered from the imported CLAUDE.md; the command and subagent files landed; the MCP token became `${GITHUB_TOKEN}` and the stored value reached the agent only as an environment variable during runs; the hook did not run and was absent from the applied `settings.json`; Boat's own `computer` MCP server stayed in `~/.claude.json`.
- Apply while the machine was paused (about 16 s), turning hooks on, restoring version 1, removing a value, and refusing to discard an active version.
- The first machine tried was left with a dead host after an apply on a paused machine and was not diagnosed (a fresh machine behaved correctly in every later test, including apply while paused); treat a host that does not return after an apply as a Restart-then-report case.
- Not verified live: Codex config, a stdio MCP server actually starting, and that restoring an earlier version deletes the later version's files (covered by unit tests of the apply plan).
