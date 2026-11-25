# Tools agents and chats can use

Every surface builds its tools through one pipeline (`prepareActTooling`, `src/server/app-api/v1/conversations/act/tooling.ts`), then narrows them. Overlay's own tools are defined in `src/server/tools/tools/build.ts` and registered in `packages/overlay-tools-core/src/policy.ts` (`OVERLAY_TOOL_IDS`); an agent holds them through **tool groups** (`src/shared/agents/tool-groups.ts`).

## Overlay tools, by group

One toggle per thing a person would recognise. Reading and writing the same kind of thing share a group (files and notes are both workspace files), as do images and video, and asking and editing agents. Access levels that need a read-only cut, such as outside-app Read only, list read tools explicitly (`READ_TOOL_IDS` in `src/shared/mcp/access.ts`) instead of relying on group boundaries.

| Group | Tools |
| --- | --- |
| Memory | `search_memory`, `search_messages`, `list_chats`, `read_chat`, `save_memory`, `save_memory_batch`, `update_memory`, `delete_memory` |
| Files (files, folders and notes; read and write) | `search_knowledge`, `search_in_files`, `list_files`, `read_file`, `write_file`, `create_folder`, `move_file`, `list_notes`, `get_note`, `create_note`, `append_to_note`, `replace_note_section`, `edit_note`, `update_note`, `delete_note` |
| Tasks | `list_tasks`, `get_task`, `create_task`, `update_task`, `comment_on_task`, `archive_task`, `restore_task` |
| Skills | `list_skills`, `find_skills`, `load_skill`, `search_skill_registries`, `save_skill`, `draft_skill_from_chat` |
| Automations | `list_automations`, `draft_automation_from_chat`, `create_automation`, `update_automation`, `pause_automation`, `delete_automation` |
| Media generation | `generate_image`, `generate_video`, `generate_video_with_reference`, `animate_image`, `apply_motion_control`, `edit_video` |
| Cloud computer (paid, opt-in) and Local computer (the person's own, in local threads) | `computer_exec`, `computer_read_file`, `computer_write_file`, `computer_list_files`, `computer_open_url`, `computer_screenshot`, `computer_input`, `computer_browser`, `computer_terminal`, `computer_publish_file`, `computer_recording` |
| Agents | `list_agents`, `ask_agent`, `read_agent_reply`, `post_message` (see `agent-to-agent.md`), `create_agent`, `update_agent` (never offered to outside apps), `resolve_assignment` (only in the Chief's native Harness run; withheld from connected agents and outside apps) |
| Chat only | `present_generated_ui` (renders a draft or connect card in the chat) |

Not tool ids but granted as capabilities:

- **Web** (paid): `web_search`, `deep_search`, `web_fetch`. On the free plan they exist as stubs that answer "needs a paid plan".
- **Connected apps** (`integrations`): the connector provider's meta-tools (Composio: search tools, execute tools, manage connections), named by the provider at run time. They act through the person's connected accounts, and, when the workspace has linked its own accounts, a `workspace_`-prefixed copy acts through those.
- **Your MCP servers** (`mcp`): `search_mcp_tools` and `call_mcp_tool`, which stand in for every tool on every MCP server the person connected. A server's policy can require approval per tool. A result is shortened only past 400,000 characters; agent runs keep a large result as a private artifact the agent can page.

Interactive browsing runs inside the bound Computer through `computer_browser` and
`computer_open_url`, with the same workspace admission, machine billing, visible
desktop and approval policy as other Computer actions. There is no separate
browser provider or natural-language browser-session tool. The Browser composer
request selects these Computer tools; it cannot bypass Computer availability or
approvals. Old saved browser-only grants do not automatically gain Computer
permissions.

Every `computer_*` tool except `computer_recording` also runs on the user's own connected Mac (Settings →
Desktop → This Mac) through its Agent Host. Each takes an optional `target`:
`local` for the Mac, `cloud` for the cloud Computer; without one a bound cloud
Computer is used and the Mac is the fallback. A connected Mac also makes the
computer tools available in personal chat. Approvals are the same on both;
automations never use the Mac, and only the person who approved the Mac can use
it. See `local-computer.md`.

When `local` can't be used, the tool result says why so the agent can tell the
user what to change: the Mac is offline (with when it last checked in; the
desktop app can be open with This computer turned off after a restart or
sign-out unless "Let agents run threads on this computer" is on), it is connected with
computer control off, or no Mac is set up. Each result also says the agent
thread's Computer panel (labelled "Cloud computer") shows the cloud machine,
never the user's Mac.

`computer_recording` records the cloud Computer's screen as proof of work (cloud
only; the Mac returns `recording_unsupported`). `start` begins one recording per
Computer (ffmpeg, up to 30 minutes or about 95 MB); `annotate` adds a timestamped
note with a status (`setup`, `step`, `pass`, `fail`) that becomes an MP4 chapter,
and is refused once the capture has hit its limit; `stop` finishes the MP4, saves it
to Files and returns a pass/fail summary, chapters and a `downloadUrl`; `status`
reports the active recording. Recordings are private: personal Files by default, or
workspace Files when asked or in a room others can read (the same rule as
`computer_publish_file`). It publishes under its own grant, so an agent given only
`computer_recording` (plus `write_file`) can save its recordings. `stop` with
`public: true` also creates a public share link; that needs approval in Ask
(`approval_required` where there is no approval UI) and is refused when the
workspace turned public links off. The Computer keeps the newest five stopped
recordings and deletes the raw capture once the MP4 is written.

## How tool calls appear in chat

Rows describe what a call did, built from its input and result by `describeToolCall`
(`packages/overlay-chat-core/src/tool-call-description.ts`): "Ran `npm test`", "Read
`auth.ts:1-50`", "Searched `src` for “x”", "Edited `a.ts` +20 −6", "Created `report.mp4`".
Only simple, unpiped `rg`/`grep`/`cat`/`sed -n`/`head`/`tail`/`ls`/`find` commands are
summarized; everything else is "Ran" with the first line of the command. Secret-looking values
in commands are hidden on screen only. Results that feed this:

- `computer_write_file` returns `created` and `linesAdded`/`linesRemoved` (read before the write;
  omitted when the old file is over 1 MB or unreadable).
- `generate_image`, `generate_video` and `animate_image` return `fileId` and `url`
  (`/api/v1/files/<id>/content`) next to `outputId`.
- Files a turn creates (`write_file`, `create_note`, `generate_*`, `computer_publish_file`, `computer_recording`) render
  as cards after the reply unless the reply already embeds them.

## Scope on list tools

`list_notes`, `list_files`, `list_skills`, `list_automations`, and `list_tasks` take an optional `scope`: `personal` (only yours),
or `workspace` (shared with the workspace). `list_tasks` also accepts `archived: true` to find archived Work tasks for
`restore_task`; it can return archived tasks of any status, filtered by resolved scope. Shared rooms remain Workspace-only.
With `archived` omitted, `list_tasks` returns active tasks. Other list tools return active items only. When `scope` is omitted
(and `archived` is omitted for `list_tasks`), the list tools return everything active the caller can read, which includes
what other members shared with the workspace but never their personal items. Skills the workspace shares are also
in the skill directory every agent gets, and `search_mcp_tools` / `call_mcp_tool` reach MCP servers members shared with
the workspace: the server runs with the credentials connected for it on Overlay's servers, so a member's agent sees only
the server's name and tools, never the secret. Moving a server to the workspace leaves the mover's sign-in behind; it is
off until connected for the workspace (older shared servers keep theirs, see `mcp-access.md`). A personal connector never
moves to the workspace; the workspace connects its own account. Connectors work differently: the workspace has its own accounts for the same connectors (Extensions → Workspace → Connectors), held by a workspace entity at the provider (`ovws_<workspaceId>`), separate from every member's personal accounts. When a workspace has any, its agents get a second set of connector tools named `workspace_<tool>` that act through those shared accounts, beside the person's own tools; each describes whose accounts it uses. Only Composio supports this; the Executor provider stays personal-only.

## Rooms others can read, and workspace automations

An agent summoned in a room others can read does not bring the person's private reach into it. A room is shared when more
than one person is in it, or when it is a channel anyone in the workspace can read; a chat between one person and an agent,
and a private channel with one person, are not. A workspace automation's thread counts the same way: the automation runs
for the whole workspace, so it gets workspace reach only, whoever created it (`workspaceAutomationForThread` in
`convex/lib/roomAudience.ts`; an archived one keeps the scope it was archived from). The server decides this from the
conversation (`conversationAudienceIsShared`, read through `src/server/agents/shared-room.ts`, fail-closed: if it cannot
read the room it treats it as shared); agentless automation runs re-read the automation's scope on every step
(`resolveAutomationSourceGrant`). In a shared room or workspace automation:

- **Loaded automatically** (`buildAgentTurnContext`, `ActContextService.loadTurnContext`): the person's memories and memory
  profile and their personal skills are not loaded; retrieval reads only what the workspace shares (`workspaceOnly`).
- **Searches** (`search_knowledge`, `search_memory`, `search_messages`) send `workspaceOnly`: nothing private is returned,
  not even the person's own. Files in Workspace are searched; personal and archived files are not (`chunkVisibleToSearch`,
  `fileChunkVisibility`).
- **Models**: only workspace provider connections and hosted models; a personal key or subscription is refused
  (`assertUserCanUseByokModel` with `workspaceOnly`).
- **Memory saves**: what an agent learns there is workspace knowledge (`memoryOwnerForPlace`); an agentless workspace
  automation saves under the workspace chief (`workspaceChiefMemoryOwnerId`).
- **Lists** (`list_files`, `list_notes`, `list_skills`, `list_automations`, `list_tasks`) read the Workspace scope whatever `scope` was asked.
- **Not offered**: `list_chats`, `read_chat`, `search_in_files`.
- **Connected apps**: only the workspace's (`workspace_…`) tools; the person's own accounts are not offered.
- **MCP servers**: only the ones shared with the workspace.

Not covered: reading a specific item by id (`read_file`, `get_note`, `get_task`), the write tools (which default to the person's personal
items), computer tools, and agents asking agents. Naming an item in the message is how a person includes it on
purpose, but there is no per-message opt-in yet.

## Who gets what

| Surface | What it gets |
| --- | --- |
| **Personal chat** | The same pipeline, narrowed by what you ask: a base set (knowledge, memory, notes read, skills) is always there; writes, files, browser, video, and automations appear when the request calls for them (`exposure-policy.ts`), plus web and connected apps by plan. Free plan: paid tools are stubs. |
| **Overlay (native) agent** | Its grant (groups it was given, `allowedToolIds`) intersected with deployment, account, and project policy. A grant only narrows. New agents get every group except Cloud computer. The Local computer group (`capability:local_computer`) holds no tool ids of its own: it gives the computer tools to a thread its owner set to run on their own computer (`localThreadComputerToolIds`, `internal/develop/thread-folders.md`). It is never exposed over MCP. |
| **Outside AI apps** (ChatGPT, Claude, Cursor…) | The same tools through `/api/mcp` at the access level the person chose (below), minus agent editing, the `draft_*_from_chat` tools, `present_generated_ui`, computer tools, `post_message`, and `resolve_assignment`. |

## Native agent permissions

Overlay agents use Ask by default. Ask requires approval for typing, consequential clicks, computer commands, command starts, selected connected-app actions and MCP tools whose server policy requires approval. In contexts without an approval UI, those actions return `approval_required`. Auto skips those approval gates for the agent, including automations; MCP tools denied by server policy remain denied. Personal chats without an agent always use Ask. Connected-agent permission values remain owned by the connected harness.

Connected-agent MCP calls revalidate the current session and execution generation before running,
including after a human approval wait. Start-command credentials keep their original scope, grant
and absolute expiry when rebound to a replacement attempt. Stale attempts cannot create approvals
in the replacement session. Legacy unfenced grants work only before an attempt has been replaced.

New connected hosts bridge MCP form elicitation to that same Overlay card. The original tool
call resumes over SSE after a decision; reconnects return the cached exact result. Client-supplied
form answers cannot approve themselves. Auto/Bypass applies to the machine runtime; it does not
override an owner-required Overlay tool policy. Ordinary granted tools run without an extra card.
Older hosts retain the legacy retry flow until upgraded.

## Outside-app access levels (`src/shared/mcp/access.ts`)

An outside app that joined the workspace as an agent (`mcp-access.md`, "Joining the workspace as an agent") keeps its
level's tools and gains tools that exist only on `/api/mcp` and are not in the Overlay tool registry: `join_workspace`
(before joining), `join_status`, `list_rooms`, `read_room`, `post_message`, `check_inbox`, `wait_for_messages`, `reply`,
and its own `list_agents`, `ask_agent`, `read_agent_reply`, which ask as the agent instead of as the person. While its
request is pending, declined, removed, or paused, `join_status` is its only tool.

- **Read only**: `search_memory`, `search_messages`, `list_chats`, `read_chat`, `search_knowledge`, `search_in_files`, `list_files`, `read_file`, `list_notes`, `get_note`, `list_skills`, `find_skills`, `load_skill`, `search_skill_registries`, `list_automations`, `list_tasks`, `get_task`.
- **Read and write**: read, plus memory, knowledge, files, notes, skills and tasks groups and web search.
- **Everything**: write, plus automations, connected apps, your MCP servers, image and video, asking agents. Never agent editing or computers.

Task tools use the Work API and its existing permissions. `update_task` sends fields and status in one
transaction (it cannot move a task between Personal and Workspace: that one-way move needs a person's
confirmation in the app); its optional revision is checked by Convex before any write. Conflicts return the current task,
revision and instructions to review newer edits before retrying, or to call `get_task` if the read failed.
Comments also advance the task revision monotonically, so a same-tick comment cannot revive a stale write.
`comment_on_task` reads back the task and returns its new revision for the next update. A failed readback
does not turn a saved comment into a failure: the agent is told to read the task, not post a duplicate comment.
Agents should serialize comments and updates on the same task; revision guards are never bypassed on retry.
All Work mutations, including scope/archive/restore, require server authentication at the Convex boundary.
Task tools never delete tasks or start an agent run. Agent turns supply activity attribution only through
service-authenticated calls, including archive/restore scope requests; other callers cannot choose their event actor. Existing full-toolbox grants
receive the later-added Tasks group through `LATER_GROUP_MEMBERS`.

**Assigned tasks.** In the thread a Work assignment opened, the assigned agent always gets `get_task`, `update_task` and
`comment_on_task` (`src/server/agents/assigned-task-tools.ts`), because the assignment message tells it to use them. Agents
created without the Tasks group (an empty or narrow grant) otherwise could not read the task or report progress. Tools the
agent's own grant lacks are limited to that one task, and `update_task` then changes only `status` and `blocked`. The task
is found by `work/workItems:assignedTaskForConversation` (assignee, active, thread, and readable by the person the agent acts
for); deployment and workspace policy still apply, and calls still go through the Work API as that person.

Agent note/file creation and edits mark `byAgent` through the existing API path;
Computer binary publication and agent-drive uploads set `createdByAgent` in
Convex. Growth rollups count their output without human activity credit.


## Skill discovery and self-verticalization

- `find_skills`, `load_skill`, `search_skill_registries` and `save_skill` are exposed on every chat turn; `draft_skill_from_chat` still appears only when the user asks about skills or reusable workflows.
- `find_skills` ranks the caller's visible skills plus the built-in `builtin:*` skills (self-verticalize, frontier-research, skill-reuse, skill-authoring, skill-testing). With a `domain` filter the domain map ranks first. When no non-built-in skill scores at least 0.3, it returns a hint to load `builtin:self-verticalize`.
- `load_skill` returns the outline by default, or one section by heading (headings inside code fences are ignored), capped at 30,000 characters.
- `search_skill_registries` calls only skills.sh `/api/search` and skillmd.com `/v1/search`, drops unsafe identifiers, and labels every result untrusted. Agents must read and vet a skill before adopting it.
- `save_skill` always saves as Personal with `origin: agent`, plus optional `domain`, `kind` (`skill` or `domain_map`), `triggers` and `provenance`. Sharing to the workspace is a human action.
- Saved agents whose grant has `list_skills` and `draft_skill_from_chat` are migrated to include the four new tools (`LATER_GROUP_MEMBERS` in `src/shared/agents/tool-groups.ts`).
