# Agent Tasks Plan

Status: approved. Decisions 2 to 5 accepted as recommended; decision 1 replaced by the explicit Start/Queue button. Phases 1 and 2 in progress.

Goal: a task in Work can be given to an agent the same way it is given to a person. The agent picks it up in its own
thread, works it, keeps the task up to date, and hands it back for review or asks for input. Any chat (personal chat,
agent thread, connected agent, outside MCP client) can create, edit, start, finish and archive tasks through the same
task tools. This is the core loop of the self-driving organization: humans set and review work, AI employees take and
manage it.

## What exists today (verified in code)

- Tasks: `workItems` in `convex/schema.ts`, mutations in `convex/work/workItems.ts`, HTTP via `/api/v1/work` and
  `WorkService` (`src/server/work`). Fields already cover what agents need: status (backlog, todo, progress, review,
  done), `blocked`, priority, `assigneePrincipalId` ("a person now, an agent later"), `reviewerUserId`, dates, parent,
  `blockedBy`, `doneWhen` checklist, `context` links (file, note, chat, link). Activity in `workItemEvents`, which
  already has a `comment` kind. Archive is soft; hard delete only from Settings, only for archived tasks.
- Agents are workspace principals (`workspacePrincipals.type = 'agent'`) with an active `member` membership
  (`convex/collaboration/agents.ts`). `work/workItems:context` already returns agents as assignees, and `OwnerPicker`
  already has an "Agents" section.
- Why you only see people: on a Personal task, `OwnerPicker` gets `personalOnly` and hides every agent, and
  `assertAssignable` (`convex/lib/workItems.ts`) refuses any assignee other than the creator. Solo workspaces mostly
  produce Personal tasks, so agents never appear. Workspace tasks can technically take an agent today, but nothing
  happens after assignment.
- Side finding: the `context` query lists every agent principal, including creator-only agents
  (`visibility: 'creator'`) that other members are not allowed to see. Phase 1 fixes this.
- Agent threads: `agents/agentThreads:createThreadByServer` creates a fresh thread under an agent. Turns start through
  `startWorkspaceAgentTurns` (`src/server/agents/start-agent-turns.ts`), which handles native Overlay agents (durable
  workflow) and connected agents (Claude Code/Codex via the Agent Host). Runs are tracked in `conversationAgentRuns`
  with queued, running, waiting_for_approval, completed, failed, cancelled.
- Delegation precedent: `ask_agent` (`AgentAskService`) posts a message into a thread and starts the agent's turn
  "with the person's access", with chain limits and budgets from `@/shared/agents/agent-lineage`. Task runs should
  reuse this model rather than invent a new one.
- Tool plumbing: overlay tools are defined in `src/server/tools/tools/build.ts`, listed in
  `@overlay/tools-core` (`INTERNAL_TOOL_IDS`, policy, exposure), granted to agents through
  `src/shared/agents/tool-groups.ts`, and reach connected agents through the agent MCP server and outside clients
  through `src/server/mcp/external-mcp-tools.ts`. One definition reaches every surface.
- Notifications: `workspaceNotifications` exists but only knows conversation events (mention, thread, message,
  reaction, participant) and requires a `conversationId`.

## The flow

1. Assign. In a task, pick an agent in Owner (or ask any chat: "give the onboarding doc task to Research Agent").
2. Start. Assigning an agent does not start anything, so the rest of the task can still be edited. Once the owner is
   an agent, a "Start Task" button appears at the bottom of the task menu. If the task has open blockers it reads
   "Queue Task" instead, and the run starts by itself when the last blocker is done. Chats use `start_task`.
3. Thread. Overlay opens a new thread under the agent, titled with the task, and posts a kickoff brief as the
   assigner: title, description, done-when checklist, context links (resolved so the agent can read them), parent
   and blockers, due date, and who reviews. The task links to the thread and the thread shows the task.
4. Work. Status moves to In progress. The agent uses its normal tools plus task tools: tick done-when items, add
   context links to what it produced (notes, files), comment progress, create subtasks.
5. Hand back. The agent ends by calling `submit_task`:
   - Ready for review: status to In review, reviewer (or the assigner) is notified.
   - Done: only allowed when the workspace or task says agent work needs no review (off by default).
   - Needs input: task stays In progress, marked "Waiting on you", the assigner is notified with the question.
     Replying in the thread or commenting on the task resumes the agent in the same thread.
   - Can't do it: marked failed with the reason, assigner notified, Retry available.
   If a run ends without calling `submit_task`, Overlay applies a safe default: move to In review with the agent's
   closing summary as a comment. Failed runs mark the task failed. The task never silently sits "In progress" with
   nothing running.
6. Review. The reviewer sees the summary and the thread link. Approve moves it to Done. Request changes posts the
   feedback into the same thread and starts a new turn, so the agent keeps its full context.

Reassigning, unassigning or archiving a task stops its current run. One active run per task.

## Decisions to confirm

1. Decided: assigning never starts work. "Start Task" (or "Queue Task" while blockers are open) starts or queues it.
2. The agent works with the assigner's access (same as `ask_agent` and room turns), narrowed by the agent's own tool
   grant, and bills to the assigner's workspace payer like any agent turn. The activity log credits the agent.
   Recommended. The alternative (the agent's creator's access) breaks when someone else assigns.
3. Agent-finished work goes to In review by default; marking Done directly is an opt-in per workspace. Recommended.
4. AI never hard-deletes tasks. It can archive and restore. Permanent delete stays a human action in Settings.
5. No confirmation prompt for single edits from chat; archiving or reassigning more than a few tasks in one go asks
   first.

## Task tools (one set, every surface)

| Tool | What it does |
| --- | --- |
| `list_tasks` | Filter by scope, status, assignee (including "me" and "agents"), due, parent, text. Returns compact rows. |
| `get_task` | Full task: fields, done-when, context, recent activity, linked thread and run state. |
| `create_task` | Any field at creation, including assignee, reviewer, parent, blockers, done-when, context. Never starts the agent; call `start_task` for that. |
| `update_task` | Patch any editable field: title, description, status, blocked, priority, assignee, reviewer, dates, parent, blockers, done-when items (add, edit, check), context links. Guarded by the task's `updatedAt` like note writes. |
| `comment_on_task` | Adds a comment to the activity. |
| `start_task` | Assigns to an agent if needed and starts (or queues, while blockers are open) the run. Phase 3. |
| `stop_task` | Stops the current run. Phase 3. |
| `submit_task` | For the agent working a task: review, done, needs input, or failed, with a summary. Phase 4. |
| `archive_task` / `restore_task` | Soft archive and restore. |

Rules:
- Tools call `WorkService` as the acting person, so every permission rule in Convex applies unchanged. Agent turns add
  `actingAgentPrincipalId`, which Convex validates (a live agent in that workspace) and uses only for attribution in
  `workItemEvents`.
- A new `tasks` group in `AGENT_TOOL_GROUPS`, on by default for the default agent and for agents that hold the full
  toolbox (via `LATER_GROUP_MEMBERS`, so saved grants keep working).
- An agent working a task always gets `get_task`, `update_task`, `comment_on_task` and `submit_task` for that one task,
  even without the `tasks` group, or it could never report back.
- Personal chat gets the full set (tool ids added to `INTERNAL_TOOL_IDS`, policy and exposure). Connected agents get
  them through the agent MCP server, outside clients through external MCP, with no extra work per surface.
- Tool results render as a compact task card in chat that opens the task peek.

## Data changes (expand only, no migrations of existing rows)

- `workItems.agentRun` (optional): `{ conversationId, runId?, state: 'queued' | 'working' | 'needs_input' |
  'in_review' | 'failed' | 'stopped', startedAt, updatedAt, summary?, error? }`. Statuses stay fixed; this is the
  agent-specific layer on top.
- `workItems.createdByPrincipalId` (optional): so tasks an agent created say so.
- `workItemEvents.kind` adds `agent_started`, `agent_update`, `agent_submitted`, `agent_failed`, `agent_stopped`,
  `done_when`, `context`, `description`.
- `conversations.workItemId` (optional), set on task threads.
- `workspaceNotifications`: add a `task` type and optional `workItemId`; make `conversationId` optional.

## Guardrails for self-driving

- Agents may create tasks and assign them to other agents. That hand-off counts against the existing agent lineage
  limits (`MAX_AGENT_ASKS_PER_ROOT`, chain depth), carried on the task, so agents cannot assign in a loop.
- Subtask depth stays at `WORK_LIMITS.maxDepth`. A per-workspace daily cap on agent-started task runs, with a
  notice when it is hit.
- Auto-start on unblock only for tasks a human assigned or approved; agent-created chains of tasks start only within
  the lineage budget.
- Connected agents: a task can wait longer than a chat message for the machine to come online. Queue task runs with a
  longer window than `CONNECTED_AGENT_INTERACTIVE_QUEUE_MS` and show "Waiting for machine" on the task.
- Free tier: same entitlements as agent turns today; no new cost path. Sandbox/computer use keeps its own metering.

## Phases (one main PR each)

1. Agents are assignable everywhere. Personal tasks accept agents the creator can use; `context` hides creator-only
   agents from people who cannot see them; Owner picker shows agents on Personal tasks. Small, ships alone.
2. Task tools. `TaskToolService` over `WorkService`, the tool set above, `tasks` tool group, personal chat and MCP
   exposure, attribution field, chat task card. Usable from chat before any auto-run exists.
3. Agent runs. `agentRun` field (plus a `queued` state for Queue Task), `conversations.workItemId`, kickoff brief,
   "Start Task" / "Queue Task" button at the bottom of the task menu, start on unblock for queued tasks, stop on reassign/unassign/archive, Start/Stop/Retry, completion fallback, one run per task. Native and
   connected agents.
4. Review and input loop. `submit_task`, task notifications, Approve / Request changes, comments and thread replies
   resume the agent, "Waiting on you".
5. UI pass. Agent section in the task peek (state, Open thread, Stop, Retry, summary), task chip in the thread
   header, agent activity lines, Work filters "Needs you" and "Agent work" (already in `work-mockup.html`).
   Standalone HTML mockup first, for approval.
6. Self-driving. Lineage limits on agent-created assignments, daily cap, dependency auto-start, and an optional
   "triage" automation that grooms the backlog (dedupes, splits, assigns) on a schedule.

Phases 1 and 2 are independent of agent runs and can land first. Each phase gets authenticated preview QA; agent runs
need the connected-agent Preview flags for Claude Code/Codex coverage.

## Tests per phase

- Convex: assignability matrix (personal/workspace, visible/creator-only agents, archived agent), attribution
  validation, run state transitions, one-run-per-task, stop on reassign.
- Server: tool input validation, revision conflicts, permission refusals surfaced as plain messages, lineage limits.
- Preview QA: assign from peek, from personal chat, from an agent thread; agent submits for review; request changes
  resumes; needs input notification; archive from chat.
