# Agents asking agents

Workstream 4 of `docs/plans/OVERLAY_CLOUD_AGENTS_PLAN.md`. An agent can ask another agent in the workspace for help and read its answer. It works the same for Overlay agents (native tools) and Claude Code / Codex agents on Overlay Cloud (the same tools over the Overlay MCP server).

## Tools (group `agent_chat`, "Ask other agents")

- `list_agents`: the agents the person can see, except the caller.
- `ask_agent(agent, message, wait?)`: `agent` is an id or exact name. With `wait` (default) it returns the reply, or a handle (`conversationId`, `turnId`) if the agent is still working after about 80 seconds. The message must stand alone: the asked agent does not see the asker's conversation.
- `read_agent_reply(conversationId, turnId)`: the reply to an earlier ask that was still working.
- `post_message(conversationId, text, mentions?)`: post into a channel or group chat the person can see and the agent is part of, optionally mentioning up to 3 agents who are in it; they answer there. It does not wait. A mention is a question: the same chain limits and budgets apply, and the message carries the lineage. A post that mentions nobody starts nothing. Refused for a personal chat, a conversation the person cannot see, a room the agent is not in, or a mention of someone not in the room.

All four call one route, `POST /api/v1/agent-asks` (`list`, `ask`, `post`, `read`), through `executeListAgents` / `executeAskAgent` / `executePostMessage` / `executeReadAgentReply`. Registered in `OVERLAY_TOOL_IDS`, the `agent_chat` group, and (for `post_message` only) the outside-app withheld list. The route's actions and the boundary schema's action list are tied by a test. Agents that hold the whole toolbox (automations, video, browser) read as holding these too (`LATER_GROUP_MEMBERS`); narrower grants do not get them.

## How an ask works (`AgentAskService`)

1. The asking turn is read from the database: the tool sends the asker's agent id, conversation, and turn id (`agent_<triggering message id>_<agent id>`), and the service loads that triggering message. Nothing about the chain comes from the model.
2. The question is posted by the **asking agent** into a group conversation of the person, the asking agent, and the asked agent (`Asker & Asked`, reused for the same trio), with a lineage part, and the asked agent's turn is started by the same code as any mention (`startWorkspaceAgentTurns`, shared with the message route). It runs with the person's access, bills the same place, and the whole exchange is visible to the person in that conversation. Delegated turns run without recalled memory, so the answer comes from the question.
3. The reply is the asked agent's message for that turn; `ask` polls for it.

## Outside apps asking agents

ChatGPT, Claude, Cursor and other MCP clients at the Everything level get `list_agents`, `ask_agent`, and `read_agent_reply` (not `post_message`, which needs to be an agent in a room). With no agent identity, the question is the **person's own message** in the agent's direct conversation ("Asked from an outside app: …"), so it is attributed to them and shows in their history, and the agent's turn starts a new chain at hop 0. Limited to 30 questions an hour and 100 a day per person (`outside-hour:` / `outside-day:` counters).

## Lineage and limits (`src/shared/agents/agent-lineage.ts`)

- Lineage = root turn (the person's message), hop, and the chain of agent ids. It lives on the question message (`data-agent-lineage`); only an agent-authored message is trusted to carry one, and a person's message parts are restricted to text and files, so a lineage cannot be forged.
- **Hop limit 3**, **no self-asks**, **no cycles** (an agent already in the chain cannot be asked), **3 questions per turn**, **12 per person's message** across the whole chain (`agentAskCounters`, claimed atomically in Convex before anything is posted and given back if delivery fails). **Posts**: 5 per turn, 20 per request. **Spend**: a chain whose asked agents have already used 500,000 tokens (input plus output of their replies, added up from the replies each request recorded) cannot ask again (`MAX_CHAIN_TOKENS`); counts alone do not bound cost, and tokens are what every provider reports. Cloud agents report tokens too. Each refusal is a plain tool error the agent can relay.
- Visibility: only agents the person can see (`WorkspaceAgentService.list`) can be asked.

## UI

The question shows "Agent question · step N of 3 · see where it came from" in the room view; the link goes to the conversation the asking turn was running in (`parentConversationId` in the lineage). A link to a direct message or channel with no view (such as that one) used to open it in the personal-chat renderer; `ConversationExperienceRouter` now probes the conversation's participants and moves the route to `view=dms` or `view=channels`.

## Verified on production (2026-10-03)

- Overlay agent asks Overlay agent and relays the answer; a chain that tries to loop back is refused with the cycle message; Overlay agent asks the cloud Claude Code agent ("51"); the cloud agent asks an Overlay agent over MCP ("pong").
- `post_message`: an agent posted into its shared room with a mention; the post carried its lineage and the mentioned agent answered in the room.
- Outside app: a personal MCP token at Everything saw `list_agents`, `ask_agent`, `read_agent_reply` (and not `post_message`) among 46 tools, and `ask_agent` returned the agent's answer. The token was revoked afterwards.
- A group conversation of agents opened by a plain `/app/chat?id=` link moved itself to the room view.
- Failures found along the way: the `conversationMessages` schema did not allow the lineage part; the remote-turn start refused a trigger that was not a person's message; the API boundary schema listed only the first three actions; an outside app's tool context carries a turn id but no agent id, so the route decides agent-or-outside by the agent id alone. A Convex test covers the first two, a source test the third.

## Not built yet

A spend limit in money rather than tokens (the usage ledger is per turn and not yet summed per chain), and posting into a conversation the agent is not already part of (an agent must be a participant today).
