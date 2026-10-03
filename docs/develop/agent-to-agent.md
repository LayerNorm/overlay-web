# Agents asking agents

Workstream 4 of `docs/plans/OVERLAY_CLOUD_AGENTS_PLAN.md`. An agent can ask another agent in the workspace for help and read its answer. It works the same for Overlay agents (native tools) and Claude Code / Codex agents on Overlay Cloud (the same tools over the Overlay MCP server).

## Tools (group `agent_chat`, "Ask other agents")

- `list_agents`: the agents the person can see, except the caller.
- `ask_agent(agent, message, wait?)`: `agent` is an id or exact name. With `wait` (default) it returns the reply, or a handle (`conversationId`, `turnId`) if the agent is still working after about 80 seconds. The message must stand alone: the asked agent does not see the asker's conversation.
- `read_agent_reply(conversationId, turnId)`: the reply to an earlier ask that was still working.

All three call one route, `POST /api/v1/agent-asks` (`list`, `ask`, `read`), through `executeListAgents` / `executeAskAgent` / `executeReadAgentReply`. Registered in `OVERLAY_TOOL_IDS`, the `agent_chat` group, and the outside-app withheld list (outside apps have no agent identity, so they cannot be part of a chain). Agents that hold the whole toolbox (automations, video, browser) read as holding these too (`LATER_GROUP_MEMBERS`); narrower grants do not get them.

## How an ask works (`AgentAskService`)

1. The asking turn is read from the database: the tool sends the asker's agent id, conversation, and turn id (`agent_<triggering message id>_<agent id>`), and the service loads that triggering message. Nothing about the chain comes from the model.
2. The question is posted by the **asking agent** into a group conversation of the person, the asking agent, and the asked agent (`Asker & Asked`, reused for the same trio), with a lineage part, and the asked agent's turn is started by the same code as any mention (`startWorkspaceAgentTurns`, shared with the message route). It runs with the person's access, bills the same place, and the whole exchange is visible to the person in that conversation. Delegated turns run without recalled memory, so the answer comes from the question.
3. The reply is the asked agent's message for that turn; `ask` polls for it.

## Lineage and limits (`src/shared/agents/agent-lineage.ts`)

- Lineage = root turn (the person's message), hop, and the chain of agent ids. It lives on the question message (`data-agent-lineage`); only an agent-authored message is trusted to carry one, and a person's message parts are restricted to text and files, so a lineage cannot be forged.
- **Hop limit 3**, **no self-asks**, **no cycles** (an agent already in the chain cannot be asked), **3 questions per turn**, **12 per person's message** across the whole chain (`agentAskCounters`, claimed atomically in Convex before anything is posted and given back if delivery fails). Each refusal is a plain tool error the agent can relay.
- Visibility: only agents the person can see (`WorkspaceAgentService.list`) can be asked.

## UI

The question shows "Agent question · step N of 3" in the room view. A conversation among agents opens in the room view (Agents and Messages), not in the personal Chats view, which does not render it well yet.

## Verified on production (2026-10-03)

Overlay agent asks Overlay agent and relays the answer; a chain that tries to loop back is refused with the cycle message and the person gets the refusal; Overlay agent asks the cloud Claude Code agent ("51"); the cloud Claude Code agent asks an Overlay agent over MCP and gets "pong". Failures found by the run: the `conversationMessages` schema did not allow the lineage part (posting failed), and the remote-turn start refused a trigger that was not a person's message.

## Not built yet

`post_message` (agents posting into a channel with mentions), a per-chain spend budget (only counts are limited), lineage links to the parent turn, and letting an outside app ask an agent directly.
