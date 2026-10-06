# Tools agents and chats can use

Every surface builds its tools through one pipeline (`prepareActTooling`, `src/server/app-api/v1/conversations/act/tooling.ts`), then narrows them. Overlay's own tools are defined in `src/server/tools/tools/build.ts` and registered in `packages/overlay-tools-core/src/policy.ts` (`OVERLAY_TOOL_IDS`); an agent holds them through **tool groups** (`src/shared/agents/tool-groups.ts`).

## Overlay tools, by group

| Group | Tools |
| --- | --- |
| Memory | `search_memory`, `search_messages`, `list_chats`, `read_chat`, `save_memory`, `save_memory_batch`, `update_memory`, `delete_memory` |
| Knowledge and files (read) | `search_knowledge`, `search_in_files`, `list_files`, `read_file` |
| File editing | `write_file`, `create_folder`, `move_file` |
| Notes | `list_notes`, `get_note`, `create_note`, `append_to_note`, `replace_note_section`, `edit_note`, `update_note`, `delete_note` |
| Skills | `list_skills`, `draft_skill_from_chat` |
| Automations | `list_automations`, `draft_automation_from_chat`, `create_automation`, `update_automation`, `pause_automation`, `delete_automation` |
| Image | `generate_image` |
| Video | `generate_video`, `generate_video_with_reference`, `animate_image`, `apply_motion_control`, `edit_video` |
| Browser (paid) | `interactive_browser_session` |
| Computer (paid, opt-in) | `computer_exec`, `computer_read_file`, `computer_write_file`, `computer_list_files`, `computer_open_url` |
| Agents (editing) | `create_agent`, `update_agent` |
| Ask other agents | `list_agents`, `ask_agent`, `read_agent_reply`, `post_message` (see `agent-to-agent.md`) |
| Chat only | `present_generated_ui` (renders a draft or connect card in the chat) |

Not tool ids but granted as capabilities:

- **Web** (paid): `web_search`, `deep_search`, `web_fetch`. On the free plan they exist as stubs that answer "needs a paid plan".
- **Connected apps** (`integrations`): the connector provider's meta-tools (Composio: search tools, execute tools, manage connections), named by the provider at run time. They act through the person's connected accounts, and, when the workspace has linked its own accounts, a `workspace_`-prefixed copy acts through those.
- **Your MCP servers** (`mcp`): `search_mcp_tools` and `call_mcp_tool`, which stand in for every tool on every MCP server the person connected. A server's policy can require approval per tool.

## Scope on list tools

`list_notes`, `list_files`, `list_skills`, and `list_automations` take an optional `scope`: `personal` (only yours),
or `workspace` (shared with the workspace); archived items are not offered to agents (they are a UI view, not a scope). Omitted, they return everything active the caller can read, which
includes what other members shared with the workspace but never their personal items. Skills the workspace shares are also
in the skill directory every agent gets, and `search_mcp_tools` / `call_mcp_tool` reach MCP servers members shared with
the workspace: the server runs with its creator's credentials on Overlay's servers, so a member's agent sees only the
server's name and tools, never the secret. Connectors work differently: the workspace has its own accounts for the same connectors (Extensions → Workspace → Connectors), held by a workspace entity at the provider (`ovws_<workspaceId>`), separate from every member's personal accounts. When a workspace has any, its agents get a second set of connector tools named `workspace_<tool>` that act through those shared accounts, beside the person's own tools; each describes whose accounts it uses. Only Composio supports this; the Executor provider stays personal-only.

## Rooms others can read

An agent summoned in a room others can read does not bring the person's private reach into it. A room is shared when more
than one person is in it, or when it is a channel anyone in the workspace can read; a chat between one person and an agent,
and a private channel with one person, are not. The server decides this from the conversation
(`src/server/agents/shared-room.ts`, fail-closed: if it cannot read the room it treats it as shared), for native agents and
for Claude Code / Codex over `/api/agent-mcp` alike. In a shared room:

- **Loaded automatically** (`buildAgentTurnContext`): the person's memories and memory profile, retrieval over their files,
  notes and memories, and their personal skills are not loaded; what the workspace shares still is.
- **Searches** (`search_knowledge`, `search_memory`, `search_messages`) send `workspaceOnly`: nothing private is returned,
  not even the person's own, and files are not searched (`chunkVisibleToSearch`).
- **Lists** (`list_files`, `list_notes`, `list_skills`, `list_automations`) read the Workspace scope whatever `scope` was asked.
- **Not offered**: `list_chats`, `read_chat`, `search_in_files`.
- **Connected apps**: only the workspace's (`workspace_…`) tools; the person's own accounts are not offered.
- **MCP servers**: only the ones shared with the workspace.

Not covered: reading a specific item by id (`read_file`, `get_note`), the write tools (which create the person's personal
items), computer and browser tools, and agents asking agents. Naming an item in the message is how a person includes it on
purpose, but there is no per-message opt-in yet.

## Who gets what

| Surface | What it gets |
| --- | --- |
| **Personal chat** | The same pipeline, narrowed by what you ask: a base set (knowledge, memory, notes read, skills) is always there; writes, files, browser, video, and automations appear when the request calls for them (`exposure-policy.ts`), plus web and connected apps by plan. Free plan: paid tools are stubs. |
| **Overlay (native) agent** | Its grant (groups it was given, `allowedToolIds`) intersected with deployment, account, and project policy. A grant only narrows. New agents get every group except Computer. |
| **Claude Code / Codex on Overlay Cloud, or on your machine** | The same tools through the Overlay MCP server (`/api/agent-mcp`), limited by the agent's grant, minus `computer_*` (it has its own machine) and `present_generated_ui`. Tools that need approval show an approval card. |
| **Outside AI apps** (ChatGPT, Claude, Cursor…) | The same tools through `/api/mcp` at the access level the person chose (below), minus agent editing, the `draft_*_from_chat` tools, `present_generated_ui`, computer tools, and `post_message`. |

## Outside-app access levels (`src/shared/mcp/access.ts`)

- **Read only**: `search_memory`, `search_messages`, `list_chats`, `read_chat`, `search_knowledge`, `search_in_files`, `list_files`, `read_file`, `list_notes`, `get_note`, `list_skills`, `list_automations`.
- **Read and write**: read, plus memory, knowledge, files, notes, and skills groups and web search.
- **Everything**: write, plus automations, connected apps, your MCP servers, image and video, the browser, and asking agents. Never agent editing or computers. (A personal token at this level saw 46 tools on 2026-10-03.)
