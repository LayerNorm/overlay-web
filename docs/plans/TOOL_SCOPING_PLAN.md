# Tool scoping and search: Personal and Workspace

Status: plan, written 2026-10-05. Nothing in it is built yet except where marked "done". It builds on `docs/plans/UNIFIED_SCOPES_PLAN.md` (the Personal / Workspace / Archived model for files, notes, outputs, skills, MCP servers, connectors, and automations) and `docs/develop/tool-catalog.md`.

## The question

Are our tools personal, workspace, or mixed, and how do we scope and search them properly?

**Short answer: mixed, and not by design.** The resources got a scope model (Phases 1–4); the tools and the search behind them grew up around the old "everything is mine" model and were patched one at a time. Some tools see only your own items, some see the whole workspace, some see both, and a few show other people's private content. There is no single rule, no shared filter, and the tools do not tell the model (or the person) which scope an item is in.

## What we found

### 1. Inventory (checked against the code, 2026-10-05)

"Reads" is what a tool can see; "writes" is where a new item lands.

| Group | Tools | Reads today | Writes today | Gap |
| --- | --- | --- | --- | --- |
| Memory | `search_memory`, `search_messages`, `save_memory`, `save_memory_batch`, `update_memory`, `delete_memory` | Your chunks plus **every active member's and agent's** memory and message chunks in the workspace (`listWorkspaceMemoryUserIds`), minus memories marked `owner` | Memory takes `visibility: creator \| workspace`; when omitted the row is shared (treated as workspace) | Different vocabulary from scope; **message chunks are shared for every chat (see P0)**; default for saves is shared |
| Chats | `list_chats`, `read_chat` | Chats you can access (your personal chats, rooms you are in) | none | Fine; no scope field in results |
| Knowledge and files (read) | `search_knowledge`, `search_in_files` | **Your own files only** (vector and text search are filtered by `userId`) | none | Workspace files that others shared are not found by content, only by name |
| | `list_files`, `read_file` | Scope-aware since Phase 2/4 (`scope` argument on `list_files`; `read_file` follows read rules) | none | Results do not say which scope or whose item |
| File editing | `write_file`, `create_folder`, `move_file` | n/a | Always Personal (no `scope` argument) | Cannot create in the workspace; cannot move or archive between scopes |
| Notes | `list_notes`, `get_note`, `create_note`, `append_to_note`, `replace_note_section`, `edit_note`, `update_note`, `delete_note` | Scope-aware reads; edits follow edit rules (creator, or owner/admin for workspace items) | `create_note`: always Personal | No `scope` on create; no move/archive tools |
| Skills | `list_skills`, `draft_skill_from_chat` | Yours plus those the workspace shares; `scope` argument | Draft only | OK; results lack scope |
| Automations | `list_automations`, `draft_automation_from_chat`, `create_automation`, `update_automation`, `pause_automation`, `delete_automation` | Scope-aware list | `create_automation`: Personal | No `scope` on create |
| Image, video | `generate_image`, `generate_video*`, `animate_image`, `apply_motion_control`, `edit_video` | n/a | Output files, Personal | Fine for now; no way to put an output in the workspace |
| Browser, Computer | `interactive_browser_session`, `computer_*` | Your own machine and browser | Your own machine | **Personal by nature**: should never be offered as a workspace resource |
| Agents | `create_agent`, `update_agent`, `list_agents`, `ask_agent`, `read_agent_reply`, `post_message` | Workspace agents and rooms | Workspace objects | Workspace-level already; not part of the Personal/Workspace resource model |
| Web | `web_search`, `deep_search`, `web_fetch` | The internet | none | No scope question |
| Connectors | Provider meta-tools (Composio) | Your connected accounts | Acts through them | **New: the workspace now has its own accounts** (`workspace_` prefixed tools) beside yours, so a turn can hold two sets of tools with the same names and different accounts |
| MCP servers | `search_mcp_tools`, `call_mcp_tool` | Yours plus those members shared with the workspace | Calls the server with its creator's credentials | OK; search results do not say which are shared |

So the tool surface is **mixed**: resource tools (files, notes, skills, automations) are scope-aware on read but personal-only on write; knowledge search is personal for files and workspace-wide for memory and messages; identity tools (connectors, MCP) now exist in both scopes; machine tools are personal; agent tools are workspace.

### 2. Problems, ranked

**P0: personal chats and DMs are searchable by teammates.** `reindexMessageInternal` marks a message chunk `visibility: 'workspace'` whenever the conversation has a `workspaceId`, and every conversation has one (1,145 personal chats, 93 DMs, 6 channels in production). The recall query includes other members' chunks that are not `owner`. In a workspace with more than one member, `search_messages` and `search_knowledge` can return text from another member's personal chat or from a DM they are not in. Today only one production workspace has two people, so the exposure is small, but it grows with every invitation, which is exactly what the personal-workspace retirement encourages. The code comment says "personal chats are not" shared; the check does not match it.

**P1: agents in rooms act with the summoner's full access.** An agent answering in a channel or DM retrieves with the summoner's user id (memory, files, skills, connectors, MCP). Its reply is visible to everyone in the room, so a Personal item the summoner can see can end up quoted to the room.

**P1: memories default to shared.** All 1,726 production memories have no `visibility`, which reads as shared. Anything an agent saves in a personal chat is recalled by teammates.

**P1: file content search ignores the workspace.** A note a teammate shared is found by name (mentions, `list_notes`) but not by content (`search_knowledge`, `search_in_files`, global search), so shared knowledge is half-invisible.

**P2: write tools cannot choose a scope.** Agents cannot put a note, file, or automation in the workspace, nor move or archive one. Outside apps (MCP) have the same limit.

**P2: results do not say where an item lives.** The model and the person cannot tell Personal from Workspace or whose item it is, so they cannot reason about sharing ("this is private to Maya").

**P2: three vocabularies.** `visibility: creator | workspace` (memory tools), `view: personal | workspace | archived` (HTTP), `scope: personal | workspace` (resources and tool arguments), and chunk `visibility: owner | workspace`. They mean nearly the same thing.

**P3: two connector tool sets in one turn** (`COMPOSIO_*` and `workspace_COMPOSIO_*`). The model has to choose; today only the descriptions help it.

## Target model

### One vocabulary

`scope` everywhere, with the same three values the panel uses: `personal`, `workspace`, `archived`. Memory's `visibility` becomes `scope` at the tool boundary (`creator` maps to `personal`); stored chunk fields can keep their names but are derived from the source row's scope.

### Four kinds of tool, four rules

1. **Resource tools** (files, notes, outputs, skills, automations, memories, MCP servers): reads return everything the caller may read, optionally narrowed by `scope`; each result carries `scope` and `ownerUserId` (and the owner's display name); creates take `scope` (default Personal); two new tools, `move_to_scope` and `archive_item`/`restore_item`, call `POST /api/v1/scope`, so an agent can do what the buttons do, under the same rules.
2. **Identity tools** (connectors, MCP calls): act through an account. Personal and workspace accounts are labelled; when both exist for a connector the turn says which it will use, and a tool call can name `account: personal | workspace`.
3. **Machine tools** (`interactive_browser_session`, `computer_*`): Personal only, never shared; documented as such.
4. **Workspace objects** (agents, rooms, messages): already workspace-level; unchanged, but subject to the room rule below.

### The room rule (decision needed)

When an agent runs in a **shared room** (channel or DM), its reads default to **workspace scope only**: it does not see the summoner's Personal items unless the summoner explicitly includes them in that message (an "include my personal items" toggle, or an `@`-mention of a specific personal item, which already carries consent). In a **personal chat** the default stays everything the person can read. This one rule closes P1.

### One search path

Every search (agent tools, mentions, global search, MCP tools, the workspace search of Phase 4) goes through the same function and the same readable-scope filter, instead of each backend re-deriving it:

- **Input**: query, `kinds` (file, note, output, memory, message, skill, automation, MCP server), `scope` (or all readable), workspace, and the caller.
- **Index fields**: every chunk and search row carries `workspaceId`, `scope` (copied from its source row and kept in sync when it moves or is archived; archived is excluded unless asked), and `ownerUserId`. File chunks gain the same fields memory chunks already have.
- **Filter**: a chunk is readable if it is the caller's own, or its scope is `workspace` and the caller is an active member of its workspace (the same rule as `canReadResource`). One helper, used by the vector search, the lexical search, and the name searches, with a test per backend that a second member cannot read someone's Personal item.
- **Message chunks**: personal chats are `personal`; DMs are readable by their participants only; channels follow `channelVisibility` (public: workspace; private: members of the channel). This replaces the `workspaceId`-based rule behind P0.
- **Ranking and output**: Personal and Workspace hits are merged by score, each labelled; the model can be told "prefer workspace" or "personal only" through `scope`.
- **Global search UI**: the dialog gets the same scope chips as the panel (All, Personal, Workspace, Archived) and shows a Personal/Workspace tag on each hit.

### Tool exposure

Tool grants (what an agent may call) stay as they are. New: a grant may also be **scope-limited** ("this agent may read workspace items only"), which is the knob for shared agents and for outside apps, and the access level of an MCP connection gains the same limit.

## Phases

Each phase is shippable alone and ends with the checks listed.

**T0: stop the leak (small, do first). Done 2026-10-06 for messages and for the memory default (new memories are `owner` unless saved as shared or owned by an agent: `defaultMemoryVisibility`); existing memories not yet re-scoped (1,728 live in production, all unset; 1,473 human-owned ones in the one two-person workspace).**
- Make message chunk visibility depend on the conversation type as above (personal chat: owner; DM: participants; channel: by `channelVisibility`); add `scope`/participant data the filter needs.
- Backfill existing message chunks (about 2.9k chunk rows in total across kinds); idempotent migration with a dry run.
- Make new memories default to Personal (`owner`) unless the tool or person says workspace; leave existing memories as they are and report how many are unscoped.
- Exit: a Convex test per chunk kind where a second member searches and must not see a personal chat, a DM they are not in, or a Personal memory; production check with the one multi-member workspace.

**T1: one vocabulary and labelled results.**
- `scope` argument on every list/search/create tool; memory `visibility` accepted as an alias for one release.
- Results include `scope`, `ownerUserId`, and owner name; tool descriptions explain scopes; `tool-catalog.md` updated.
- Exit: contract tests that every list tool accepts `scope` and returns it; outside-app (MCP) tools get the same schema.

**T2: write tools and the scope tools.**
- `create_note`, `write_file`, `create_folder`, `create_automation` take `scope`; new `move_to_scope`, `archive_item`, `restore_item` tools (group: the existing resource groups, so grants carry over; `LATER_GROUP_MEMBERS` entries so saved agents keep the groups).
- Honour `workspaceExtensionsEditors`, `workspaceContentEditors`, and `memberCanMoveScope`; denials come back as plain messages the model can relay.
- Exit: tests per tool for allowed, denied, and archived cases; audit events for tool-made moves name the agent and the person.

**T3: one search path.**
- Add `scope`, `ownerUserId` to file chunks (backfill), build the shared readable filter, route `search_knowledge`, `search_in_files`, mention search, global search, and the MCP search tools through it.
- Global search dialog scope chips and tags.
- Exit: shared notes and files are found by content; nothing private is; latency within the current budget (the filter is an index field, not a join).

**T4: rooms and grants.**
- The room rule (workspace-only default, explicit include), scope-limited tool grants, and the same limit on outside-app access levels.
- Connector account choice: label both account sets in the prompt, `account` argument on connector calls.
- Exit: an agent summoned in a channel by someone with private files cannot quote them; including a Personal item on purpose still works.

## Decisions to confirm

1. **Room rule**: workspace-only by default in shared rooms, with explicit opt-in per message. (Recommended.) The alternative, today's behaviour, keeps convenience and the leak.
2. **Memory default**: new memories Personal unless stated. (Recommended.) Existing ones stay as they are until you decide whether to re-scope them.
3. **DMs**: readable only by participants, including for search. (Recommended.)
4. **Order**: T0 now (it is a privacy fix and independent of everything else), then T1, T2, T3, T4. The personal-workspace retirement (Phase 5b) should not invite people into workspaces at scale before T0 ships.
5. **Agent-made moves**: allow agents to move and archive on the person's behalf under the person's own permissions (recommended), or keep scope changes human-only.

## Testing

- A matrix test shared by every search backend: roles (owner, admin, member, guest, outsider) × scopes (personal, workspace, archived) × kinds, asserting the negative cases first.
- Tool contract tests: every list/search tool accepts `scope`, every result carries `scope` and `ownerUserId`.
- A room test: summoning an agent in a channel never returns the summoner's Personal items unless included.
- Production checks after each phase using the owner's own data and the one multi-member workspace.
