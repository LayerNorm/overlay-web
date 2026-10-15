---
title: "Tracing Agent Conversations"
description: "How coding agents read past Devin CLI and Codex sessions from local storage to recover context, summarize work, or audit decisions."
---

# Tracing Agent Conversations

When a user asks you to "summarize the Devin conversation about X" or "what did Codex do in
that session," the conversation is not in the git history or the codebase — it is in local
agent session storage on the user's machine. This doc explains where those sessions live, how
to query them, and the patterns that work for extracting a coherent narrative from raw
transcript data.

## Why this matters

- **Context recovery**: A prior session may have made architectural decisions, written plans,
  or hit blockers that the current session needs to know about. The session transcript is the
  only record.
- **Summarization**: The user may want a human-readable summary of a long session for a
  retrospective, handoff, or commit message.
- **Auditing**: You may need to verify what a previous agent actually did (which files it
  touched, which commands it ran, what it claimed vs. what it committed).

## Storage locations

### Devin CLI sessions

Devin CLI stores all session data in a SQLite database:

```
~/.local/share/devin/cli/sessions.db
```

Related files in the same directory:

| Path | Contents |
|------|----------|
| `sessions.db` | SQLite database — the source of truth for all sessions, messages, and tool calls |
| `sessions.db-wal` | Write-ahead log (may be large; data is live even before checkpoint) |
| `summaries/` | Markdown transcript files named `history_<id>.md` (full conversation dumps) and `<uuid>.md` (session summaries) |
| `session_locks/` | One `.lock` file per active session, named `<session-slug>.lock` (contains a PID) |
| `logs/` | Per-session debug logs |
| `plugins/` | Plugin discovery state |

There is also an older summaries directory at `~/.local/share/devin/summaries/` with
slug-named `.md` files (e.g. `tartan-fridge.md`). These are app-level summaries, not full
transcripts.

### Codex sessions

Codex stores sessions as JSONL files (one JSON object per line):

```
~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
```

Each file is a self-contained, append-only event log for one session. No database needed —
just read the file line by line and parse each line as JSON.

## Devin CLI: SQLite schema

### `sessions` table

The primary index of all sessions.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- slug (e.g. "tartan-fridge") or UUID
  working_directory TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  model TEXT NOT NULL,           -- e.g. "GLM-5.2 High"
  agent_mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,   -- Unix epoch seconds
  last_activity_at INTEGER NOT NULL,
  title TEXT,                    -- human-readable title
  main_chain_id INTEGER,
  shell_last_seen_index INTEGER DEFAULT 0,
  cogs_json TEXT,                -- agent configuration (system prefix, permissions, etc.)
  workspace_dirs TEXT,           -- JSON array of workspace directories
  hidden INTEGER NOT NULL DEFAULT 0,
  metadata TEXT                  -- JSON: token counts, model info, client metadata
);
```

**Key fields for finding a session:**

- `title` — search with `LIKE '%keyword%'` to find sessions by topic
- `working_directory` — filter to a specific repo/worktree
- `last_activity_at` — Unix epoch seconds; convert with `datetime(ts, 'unixepoch', 'localtime')`
- `metadata` — JSON with `response_dimensions` containing cumulative token counts and agent
  message count

### `message_nodes` table

Every message in every session. This is the main conversation content.

```sql
CREATE TABLE message_nodes (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,      -- FK to sessions.id
  node_id INTEGER NOT NULL,      -- sequential within session (not globally unique)
  parent_node_id INTEGER,        -- NULL for root nodes (supports branching/forks)
  chat_message TEXT NOT NULL,    -- JSON object (see below)
  created_at INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  UNIQUE(session_id, node_id)
);
```

**`chat_message` JSON structure:**

```jsonc
{
  "message_id": "uuid",
  "role": "system" | "user" | "assistant" | "tool",
  "content": "the message text",
  "tool_calls": [{ "id": "...", "name": "...", "arguments": {...} }],  // assistant only
  "metadata": {
    "num_tokens": null,
    "is_user_input": true | null,   // true = actual user prompt; null = system/tool
    "request_id": null,
    "metrics": null,
    "finish_reason": null,
    "extensions": { ... }           // client metadata, content blocks, etc.
  }
}
```

**Critical filtering note:** The first ~3 messages in every session are `role: "system"`
(system prompt, subagent profiles, model info). To get only actual user prompts, filter on
`json_extract(chat_message, '$.metadata.is_user_input') = 1`. Many `role: "user"` messages
are tool results or system-injected context, not human input.

### `prompt_history` table

A separate log of user-typed prompts (not tool results or system messages).

```sql
CREATE TABLE prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,    -- Unix epoch milliseconds
  session_id TEXT NOT NULL,
  is_shell INTEGER NOT NULL DEFAULT 0
);
```

In practice, this table is often empty for some sessions (prompts may go directly to
`message_nodes`). Always fall back to `message_nodes` if `prompt_history` is empty.

### `tool_call_state` table

Serialized tool call inputs and outputs.

```sql
CREATE TABLE tool_call_state (
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_call_json TEXT,           -- initial ToolCall event JSON
  tool_call_update_json TEXT,    -- final completion update JSON
  PRIMARY KEY (session_id, tool_call_id)
);
```

### `rendered_commits` table

Rendered HTML snapshots of the conversation UI (for the Devin app's scrollback). Not useful
for text-based summarization.

## Devin CLI: query patterns

### Find a session by title or keyword

```sql
SELECT id, title, datetime(last_activity_at, 'unixepoch', 'localtime') as last_active,
       working_directory
FROM sessions
WHERE title LIKE '%Next.js%' OR title LIKE '%16.3%'
ORDER BY last_activity_at DESC;
```

### Find sessions active in a time window

```sql
-- Sessions active in the last 4 hours
SELECT id, title, datetime(last_activity_at, 'unixepoch', 'localtime') as last_active
FROM sessions
WHERE last_activity_at BETWEEN strftime('%s', 'now') - 4*3600 AND strftime('%s', 'now')
ORDER BY last_activity_at DESC;
```

### Get all user prompts from a session (in order)

```sql
SELECT node_id, json_extract(chat_message, '$.content') as content
FROM message_nodes
WHERE session_id = 'tartan-fridge'
  AND json_extract(chat_message, '$.role') = 'user'
  AND json_extract(chat_message, '$.metadata.is_user_input') = 1
ORDER BY node_id ASC;
```

### Get assistant messages (the agent's responses)

```sql
SELECT node_id, json_extract(chat_message, '$.content') as content
FROM message_nodes
WHERE session_id = 'tartan-fridge'
  AND json_extract(chat_message, '$.role') = 'assistant'
ORDER BY node_id ASC;
```

### Get the last N assistant messages (current state)

```sql
SELECT node_id, substr(json_extract(chat_message, '$.content'), 1, 500) as preview
FROM message_nodes
WHERE session_id = 'tartan-fridge'
  AND json_extract(chat_message, '$.role') = 'assistant'
ORDER BY node_id DESC
LIMIT 5;
```

### Filter assistant messages by keyword (find milestones)

```sql
SELECT node_id, substr(json_extract(chat_message, '$.content'), 1, 300) as preview
FROM message_nodes
WHERE session_id = 'tartan-fridge'
  AND json_extract(chat_message, '$.role') = 'assistant'
  AND json_extract(chat_message, '$.content') LIKE '%committed%'
ORDER BY node_id ASC;
```

### Get session metadata (token usage, model)

```sql
SELECT json_extract(metadata, '$.response_dimensions') as stats,
       workspace_dirs, model
FROM sessions WHERE id = 'tartan-fridge';
```

### Handle large sessions

Some sessions have 60,000+ message nodes. To avoid loading everything:

1. **Use `substr()` in SQL** to preview message content without loading full text:
   ```sql
   SELECT node_id, substr(json_extract(chat_message, '$.content'), 1, 300)
   FROM message_nodes WHERE ...;
   ```

2. **Filter empty content** — many assistant messages are empty (tool-call-only turns):
   ```sql
   AND length(json_extract(chat_message, '$.content')) > 50
   ```

3. **Page through with `LIMIT` and `OFFSET`** or use `node_id` ranges:
   ```sql
   SELECT ... WHERE node_id > 68000 ORDER BY node_id ASC LIMIT 20;
   ```

4. **Use `grep` on the CLI summaries** if you need full-text search across all sessions:
   ```bash
   grep -l "keyword" ~/.local/share/devin/cli/summaries/history_*.md
   ```

### Identify forked/related sessions

Sessions can fork (e.g., a user starts a new tab from an existing conversation). Forked
sessions share the same initial `message_id` values in their early `chat_message` JSON. To
find related sessions, compare the first user message's `message_id`:

```sql
SELECT s2.id, s2.title
FROM sessions s1
JOIN message_nodes m1 ON m1.session_id = s1.id
  AND json_extract(m1.chat_message, '$.metadata.is_user_input') = 1
JOIN message_nodes m2 ON json_extract(m2.chat_message, '$.message_id')
  = json_extract(m1.chat_message, '$.message_id')
JOIN sessions s2 ON m2.session_id = s2.id
WHERE s1.id = 'tartan-fridge' AND s2.id != s1.id
GROUP BY s2.id;
```

## Codex: JSONL event format

Each line in a Codex `.jsonl` file is a JSON object with `timestamp`, `type`, and `payload`.

### Event types

| `type` | `payload.type` | What it is |
|--------|---------------|------------|
| `session_meta` | — | Session metadata (ID, cwd, CLI version, model provider, base instructions) |
| `turn_context` | — | Per-turn context (turn ID, cwd, workspace roots) |
| `event_msg` | `user_message` | A user-typed prompt (the `message` field has the text) |
| `event_msg` | `agent_message` | Agent commentary or final response (`phase`: "commentary" or "final") |
| `event_msg` | `task_started` | A new turn begins |
| `event_msg` | `task_complete` | A turn ends (`last_agent_message` has the final response) |
| `event_msg` | `token_count` | Token usage for a turn |
| `event_msg` | `patch_apply_end` | A file patch was applied |
| `event_msg` | `context_compacted` | Context window was compacted (summary replaced history) |
| `event_msg` | `turn_aborted` | A turn was aborted |
| `response_item` | `message` | A full message (role: user/assistant/developer, content array) |
| `response_item` | `reasoning` | Agent reasoning (internal chain-of-thought) |
| `response_item` | `custom_tool_call` | A tool call (e.g., `exec_command`, `apply_patch`) |
| `response_item` | `custom_tool_call_output` | Tool call result |
| `response_item` | `function_call` | A function call |
| `response_item` | `function_call_output` | Function call result |
| `compacted` | — | Context compaction event (includes `replacement_history`) |
| `world_state` | — | Snapshot of workspace state |

### Reading a Codex session

```bash
# Find sessions from a specific date
find ~/.codex/sessions -name "*.jsonl" -newer "2026-08-07" | sort

# Extract all user messages from a session
cat ~/.codex/sessions/2026/08/07/rollout-*.jsonl | \
  python3 -c "
import sys, json
for line in sys.stdin:
    obj = json.loads(line)
    if obj.get('type') == 'event_msg' and obj['payload'].get('type') == 'user_message':
        print(obj['payload']['message'])
        print('---')
"

# Extract all agent final messages (not commentary)
cat ~/.codex/sessions/2026/08/07/rollout-*.jsonl | \
  python3 -c "
import sys, json
for line in sys.stdin:
    obj = json.loads(line)
    p = obj.get('payload', {})
    if obj.get('type') == 'event_msg' and p.get('type') == 'agent_message' and p.get('phase') == 'final':
        print(p['message'])
        print('---')
"

# Count event types in a session
cat ~/.codex/sessions/2026/08/07/rollout-*.jsonl | \
  python3 -c "
import sys, json
from collections import Counter
c = Counter()
for line in sys.stdin:
    obj = json.loads(line)
    t = obj.get('type','')
    pt = obj.get('payload',{}).get('type','') if isinstance(obj.get('payload'), dict) else ''
    c[f'{t}/{pt}' if pt else t] += 1
for k, v in c.most_common():
    print(f'{v:6d}  {k}')
"
```

### Codex session metadata

The first line(s) of a Codex JSONL are `session_meta` events containing:

- `session_id` — UUID for the session
- `forked_from_id` — if this session was forked from another (may be present)
- `cwd` — working directory
- `originator` — e.g. "Codex Desktop"
- `cli_version` — Codex CLI version
- `model_provider` — e.g. "openai"
- `base_instructions.text` — the full system prompt (very long; skip unless needed)

Multiple `session_meta` lines may appear if a session was forked — the second line has the
parent session's metadata.

## Workflow: summarize a session

1. **Find the session** — query `sessions` by title keyword or time window.
2. **Get session metadata** — `title`, `working_directory`, `model`, token counts from
   `metadata`.
3. **Extract user prompts** — `message_nodes` filtered by `role='user'` and
   `is_user_input=1`, ordered by `node_id ASC`. This gives you the user's intent at each
   step.
4. **Extract milestone assistant messages** — filter by keywords like `committed`,
   `deployed`, `Phase`, `QA`, `fixed`, `error`. Use `substr()` to preview, then read full
   content for important ones.
5. **Read the final assistant messages** — `ORDER BY node_id DESC LIMIT 5` to understand
   current state and what was last done.
6. **Check for forks** — compare first user `message_id` across sessions to find related
   branches of the same conversation.
7. **Synthesize** — group the work into phases/topics, note commits (search for commit SHAs
   in assistant messages), note blockers, and note what remains unfinished.

## Gotchas

- **Timestamps**: `sessions.created_at` and `last_activity_at` are Unix epoch **seconds**.
  `prompt_history.timestamp` is Unix epoch **milliseconds**. Always check units before
  converting.
- **Empty content**: Many assistant `message_nodes` have empty `content` (the turn was
  tool-call-only with no text). Filter with `length(content) > 0` or `> 50` to skip noise.
- **Duplicate messages**: Forked sessions share early messages (same `message_id`). When
  summarizing, pick the session with the most messages (the main line) and note forks
  separately.
- **WAL file**: The `sessions.db-wal` file can be hundreds of MB. Data in the WAL is live
  — `sqlite3` reads it automatically. Do not delete it.
- **AGENTS.md in every session**: The system prompt includes the full `AGENTS.md` content,
  which contains Next.js docs and other large text. Searching for "Next.js" or "16.3" across
  all sessions will match every session's system prompt. Always combine with a title search
  or time filter.
- **Codex `base_instructions`**: The system prompt in Codex JSONL is enormous (40K+ chars).
  Never print it in full — always truncate or skip it.
- **Codex `compacted` events**: When context is compacted, the full history is replaced with
  a summary. The `compacted` event's `replacement_history` contains the summarized version.
  Messages before a compaction event may not be available in full — rely on the compaction
  summary instead.
- **Session slug vs UUID**: Devin session IDs can be either human-readable slugs
  (`tartan-fridge`) or UUIDs (`244adf01-43b0-...`). Both work as primary keys in queries.
  The `session_locks/` directory uses slugs; the `summaries/` directory uses both.
