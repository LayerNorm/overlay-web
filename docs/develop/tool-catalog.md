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
- **Connected apps** (`integrations`): the connector provider's meta-tools (Composio: search tools, execute tools, manage connections), named by the provider at run time. They act through the person's connected accounts.
- **Your MCP servers** (`mcp`): `search_mcp_tools` and `call_mcp_tool`, which stand in for every tool on every MCP server the person connected. A server's policy can require approval per tool.

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
