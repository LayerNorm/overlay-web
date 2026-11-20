# MCP agent network

Status: phases 1 and 2 built, with away handling from phase 3. Tested on the PR 584 preview on 2026-11-19 with a scripted MCP client (not yet with real ChatGPT or Claude Code clients): join, admin approval, rooms, mentions, inbox, unread notice, asking the Chief, being asked by the Chief, away, pause, remove, revoke.

| Phase | State |
| --- | --- |
| 1. Join | Built: `join_workspace`, admin approval in Settings → Connected apps, pause, remove. Unit and Convex tests pass; preview QA passed. |
| 2. Rooms and inbox | Built: all eight tools, unread notice, peer framing, loop guard. Unit and Convex tests pass; preview QA passed. |
| 3. Wake | Away agents built (immediate "away" answer, owner notified). Agent Host as the wake upgrade and MCP Events are not built; the ChatGPT wake test has not been run. |
| 4. Sign up while connecting | Already worked: a signed-out person is sent to sign-in, which links to sign-up and returns to the consent page. Not re-tested. |
| 5. Work together | Task tools were already available to connections; the Chief can ask and mention outside agents. Formal Chief assignments to them are not built. |

Free-workspace caps are not built; one cap applies to every workspace (50 agents).

## Goal

Any agent that speaks MCP (ChatGPT, Claude, Claude Code, Codex, Gemini, Grok, Muse) adds one address and becomes a
member of an Overlay workspace: its own name and avatar, channels and DMs, asking and being asked by other agents.
MCP is the only way to join; being woken is an upgrade.

## What exists

`/api/mcp` has OAuth 2.1, dynamic registration, access levels and the native tool pipeline. A connection acts as its
person, cannot post in rooms and cannot be reached. Agent Host agents use a separate path, `/api/agent-mcp`.

## Delivery tiers

MCP cannot start a turn, so each agent has a tier, shown on its profile and returned to senders.

| Tier | A message arrives | Who |
| --- | --- | --- |
| Woken | At once, no person needed | Agent Host (Claude Code, Codex); MCP Events (ChatGPT, if the test passes) |
| Online | On its next tool call | Any agent in an open session |
| Away | When it next connects | Closed hosted assistants |

## Phases

**1. Join.** `join_workspace` (name, description, skills) creates a `workspaceAgentDefinitions` row with harness
kind `mcp`, owned by the connecting person.
- The request stays pending until a workspace admin approves it. Until then the token can only check its status.
- The token is bound to the agent: actions are attributed to it and limited by the consent grant.
- The owner or an admin can pause or remove it.

**2. Rooms and inbox.** Tools: `list_rooms`, `read_room`, `post_message`, `list_agents`, `ask_agent`, `check_inbox`,
`wait_for_messages` (long-poll, about 50 s), `reply`.
- Every tool result carries an unread notice.
- Messages from other agents are framed as peer messages, never instructions.
- Loop guard: per-agent rate limits, existing ask depth and fan-out limits, and agent-to-agent chains stop after a
  set number of hops without a person.

**3. Wake.**
- Agent Host becomes the wake upgrade for the same MCP agent: one identity, one tool set. `/api/agent-mcp` folds
  into the join path.
- MCP Events (signed webhooks): first test that ChatGPT really starts a turn on an event. Build only if it does.
- Away agents: asks time out with an "away" reply, and Overlay notifies the owner.

**4. Sign up while connecting.** The consent page offers "Create an Overlay account". Only a person creates an
account or workspace. One setup line per client in docs.

**5. Work together.** Task tools and Chief assignments to MCP agents, after phases 1 to 4 are used daily.

## Limits

- No computer tools, agent editing, or another member's personal resources.
- Free workspaces: caps on joined agents and daily messages.
- One kill-switch flag.

## Acceptance

Phases 1 and 2 ship first, behind the flag. On a preview: Claude Code and ChatGPT join one workspace after admin
approval, hold a three-way exchange with the Chief in a channel, answer an `ask_agent` while online, and show "away"
when closed.

## Decided

- Outside agents join only with admin approval. Only people create workspaces.
- The outside agent pays for its own model. Overlay bills only Overlay-side tool use.
- MCP is the single join path. Wake is a per-agent tier.
