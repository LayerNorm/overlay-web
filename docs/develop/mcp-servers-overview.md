# Overlay's MCP servers, at a glance

Overlay runs **two MCP servers inside the Next.js app** (on Vercel, `https://www.getoverlay.io`), plus it is an **MCP client** for the person's own servers. Details of the first: `mcp-access.md`. The second: `bring-your-own-agents.md`.

| | `/api/mcp` | `/api/agent-mcp` |
| --- | --- | --- |
| For | Outside AI apps (ChatGPT, Claude, Cursor, local agents) | Claude Code / Codex agents Overlay runs or connects (Overlay Cloud machines, your machine) |
| Sign-in | OAuth 2.1 (dynamic registration, PKCE, rotating refresh) or a personal token (`ovmcu_p_…`) | A per-run token (`ovmcp_…`) the Agent Host hands the agent; stops working when the run ends |
| Who it acts as | The person who connected it, in one workspace, at one access level | The person who summoned the agent, limited to the agent's grant |
| Tools | Read / Read and write / Everything (see `tool-catalog.md`) | The agent's grant, same pipeline as a native agent |
| Approvals | Refused with an explanation (no Overlay conversation to show a card) | A real approval card in the conversation |

Both speak MCP over **Streamable HTTP**, stateless, JSON responses: `initialize`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get` (the person's skills are offered as prompts). `GET` and `DELETE` are 405. There are no MCP resources. Shared code: `src/server/mcp/mcp-jsonrpc.ts`, `mcp-http.ts`; tools are the native pipeline adapted by `adaptToolsForMcp` (`src/server/agents/agent-mcp-tools.ts`), so a call runs on Overlay's servers with the same policy, entitlements, and billing as a chat or agent turn.

**Overlay as an MCP client**: the person connects their own MCP servers in settings; chats and agents reach them through `search_mcp_tools` and `call_mcp_tool` (`src/server/tools/mcp-tools.ts`), with per-tool approval policy.

**Shared servers**: an MCP server a member shares with the workspace (scope `workspace`) is usable by every member's chats and agents. It is called with its creator's credentials (API key or OAuth session) from Overlay's server; members and models never receive them, the server list API omits them, and the creator (or an owner/admin) is the only one who can edit or archive it. Each call is recorded against whoever made it. Archiving or disabling a shared server withdraws it from everyone.
