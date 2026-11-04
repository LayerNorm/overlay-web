# Agent threads: recency, parallel work, and completion

Design proposal for review. No production application behavior has been changed.

## Recommended experience

1. Clicking an agent opens its most recently active, non-archived thread. Clicking a specific thread always opens that thread. An incoming update must not switch the conversation the user is already reading.
2. Separate threads can work concurrently. A busy thread does not lock the whole agent. Existing workspace, billing, provider, and security limits still apply.
3. If a task needs a computer, it uses the agent's primary computer when available. If another task owns that computer, allocate an isolated temporary computer. Save outputs before stopping that temporary computer when the task ends.
4. Keep threads nested under their agent, as in the reference. Show a small status icon and secondary label, not another dashboard.
5. Completed tasks appear in Activity and produce a bottom-right toast using the existing shared Sonner components, with a **View thread** action.

## Mockup

Open `mockups/agent-thread-activity.html` directly. It is a self-contained, interactive prototype built with Overlay's actual DoubleSidebar component, production double-sidebar styles, and shared Button, Textarea, Toaster, and OverlayMark components. The surrounding shell follows the existing icon rail plus contextual panel layout, not a newly designed sidebar.

- The initial view has two working threads, one unseen completed result, and an already-read result.
- **Simulate completion** finishes a background task first, changes its sidebar status, moves it to the top, and shows a completion toast.
- **View thread** opens the result and clears its ready indicator.
- Open **Chats** in the icon rail to preview **Activity**, its existing location. Activity displays task completions. The Tasks filter is additive in production; existing mention, thread, and reaction filters remain.
- The agent's **+** creates a thread. Enter a task and start it while the original two tasks are still working.
- Click **Temporary computer** to see ownership and cleanup details. Simulate both initial completions to see the stopped state.
- Click the agent name to open the most recently active thread. The chevron controls expansion separately.
- Theme and reset controls are in the preview toolbar.

This is simulated state, not a running agent or computer. Other shell navigation, result files, and the Scout row are illustrative. Agents and nested threads remain in the sidebar at every width. At narrow widths, the header sidebar toggle opens the same vertical navigation; there is no horizontal thread strip above the workspace.

## What the code confirms

| Finding | Existing implementation | Consequence |
| --- | --- | --- |
| Opening an agent explicitly selects the oldest thread | `convex/agents/agentThreads.ts`, `resolveMainThread` sorts ascending `createdAt`; `listThreadsByServer` uses the same rule for `isMain` | Update both definitions, not just the sidebar |
| The visible list already sorts newest activity first | `listThreadsByServer` returns descending `lastModified` | Opening and listing currently disagree |
| Nested thread rows lack execution indicators | `src/components/layout/AppSidebarAgentThreads.tsx` | Add realtime execution/read metadata to the existing rows |
| Connected-agent admission has concurrency gates | `convex/agents/connectedAgents.ts`, including `CONNECTED_AGENT_POLICY_LIMIT:concurrent_runs` and `CONNECTED_AGENT_POLICY_LIMIT:managed_environment_concurrency` | Do not just remove all limits; distinguish workspace admission from runtime isolation |
| Computers are bound to owners | `src/server/computers/ComputerService.ts`, one computer per `(ownerType, ownerId)` | Temporary task computers need a distinct binding and authorization, not replacement of the primary |
| Activity and persistent notifications exist | `src/features/chat/components/ChatActivityView.tsx`, `convex/collaboration/directMessages.ts`, `workspaceNotifications` | Extend existing infrastructure rather than creating a second feed |
| Toast infrastructure already exists | `src/components/feedback/ArchiveToastHost.tsx`, `packages/overlay-ui/src/components/ui/sonner.tsx` | Reuse the shared host and bottom-right presentation |

**Investigation boundary:** the exact error from the reported second-thread attempt has not been reproduced. The managed-environment gate is a verified possible blocker, not a confirmed diagnosis of that incident. Before changing admission, capture the failing request, error code, agent execution mode, active run IDs, and runtime/computer IDs in an isolated Preview. Trace native and connected execution separately.

## 1. Resolve the most recently active thread

- Use descending `lastModified` initially, matching the existing list, with deterministic descending creation time and ID tie-breakers. Exclude threads archived for the caller and inaccessible/deleted threads. Preserve the existing create-if-none behavior.
- Apply one shared ordering rule to resolution and `isMain`. Update the outdated contract comment in `packages/overlay-workspace-contracts/src/types.ts` and audit callers of `resolveMainThread`, including onboarding, for assumptions that “main” means a permanent oldest thread.
- Audit timestamp writers. Sending a task, receiving substantive output, and settling a task should count as activity. Opening a thread, read receipts, and heartbeats should not move it. If `lastModified` also includes administrative edits, introduce `lastActivityAt` with a backward-compatible fallback and incremental backfill rather than silently changing every consumer of `lastModified`.
- Reorder on meaningful activity, not every streamed token. Explicit thread URLs and an already-open thread remain stable.

## 2. Admit work per thread, isolate computer access per task

### Execution admission

- Keep run identity, cancellation, approvals, recovery, and follow-up queues scoped to the conversation/run, not the agent ID. Preserve one active execution chain within a thread so two submissions cannot corrupt the same history.
- Allow independent threads to run together within workspace policy. Surface actual capacity, entitlement, or credit constraints accurately, rather than reporting that the agent is busy.
- For native tasks, acquire computer resources only when needed. For managed agents whose process itself lives on the computer, allocate an isolated runtime before starting that process. This cannot be fixed safely by deleting the managed-environment check alone.
- External/self-hosted agents must advertise or support independent sessions. If an adapter cannot isolate them, explicitly queue with a reason rather than promising unsupported concurrency.

### Computer assignment

Add a durable, run-scoped assignment through the existing computer service/repository boundary: workspace, agent, conversation, run, computer, primary/temporary kind, lease token/generation, and lifecycle state. Exact schema names can follow the existing repository conventions during implementation.

1. Atomically reserve the primary computer if it has no conflicting run or human-control reservation.
2. Otherwise reserve a temporary task-owned computer, using an idempotency key so concurrent requests and retries cannot create duplicate instances.
3. Provision from a clean authorized baseline. Do not clone a live browser session, copy another thread's private state, or inherit broader credentials. Supply only the current task's workspace access, secrets, and required artifacts.
4. Route every computer operation through the assignment, including browser, desktop, terminal, files, screenshots, and remote-agent runtime access. Separate browser tabs alone do not isolate a shared filesystem or process environment.
5. Keep the assignment stable throughout the task. Do not move a running task to the primary computer just because it becomes free.

Use durable leases with heartbeats and fencing so a stale worker cannot continue operating after losing ownership. Reuse existing lease/lifecycle infrastructure where suitable; a provisioning lease by itself is not proof of exclusive task ownership. Never fall back to sharing a busy computer when temporary provisioning fails.

When capacity prevents a temporary computer, preserve the submitted task and show **Waiting for computer**, with retry/cancel behavior. Computer-free work can still proceed when execution capacity permits. Automatic temporary computers use normal metering and workspace limits; no new price or entitlement is proposed here.

### Cleanup and failure recovery

- On success, failure, cancellation, or timeout: stop task execution, persist outputs/logs, then stop the temporary computer. Verify provider acknowledgement before calling it stopped. Release the primary reservation without stopping another thread's or human's computer.
- Keep results accessible from the thread after shutdown. Destroy disposable resources according to retention policy after required artifacts are durable.
- Make cleanup idempotent and retryable; reconcile orphaned runs/resources after worker crashes. Record cleanup failures independently from task outcome, without showing a false stopped state.
- Waiting for approval/input is not completion. Use a bounded idle policy that checkpoints safely and preserves resumability; do not tear down an interactive session blindly during a prompt.
- Computer isolation does not prevent two tasks from editing the same remote document or external system. Preserve revision checks, existing permissions, and confirmation rules for shared external writes.

## 3. Project execution state into the sidebar

| State | Thread presentation | Agent summary |
| --- | --- | --- |
| Queued/starting/running/recovering | Working, with an animated indicator; details can show the exact phase | Count active tasks |
| Waiting for capacity | Waiting for computer or Queued | Count waiting work without implying progress |
| Waiting for input/approval or actionable failure | Needs you, with a distinct icon and accessible label | Surface attention even when other threads are working |
| Succeeded and result unseen | Ready to review, check icon and unread dot | Count ready results |
| Succeeded and result seen | Completed, muted check | No ready count |
| Cancelled | Cancelled, not a success check | No ready count |

Add an authorized, batched realtime projection to `WorkspaceAgentThread`/the agent bundle. Avoid a separate subscription and run-history query per row. Use canonical run transitions rather than guessing from message text or whether a browser stream is connected.

“Ready to review” means an unseen successful result, not an approval requirement. Track the latest completed run/result and a per-viewer seen marker, so another collaborator opening the thread does not clear my state. Opening a thread acknowledges only the result actually rendered. A later completion remains unread. Do not count the same thread twice in an agent summary.

## 4. Completion events, Activity, and toasts

- Emit completion from the durable terminal run transition, not the frontend or end of one assistant/tool step. Commit the outcome and notification intent together, or use a transactional outbox.
- Extend `workspaceNotifications`, its validators, contracts, repository/API mapping, and Activity filters with task events. Use a stable `(runId, terminal event, recipient)` dedupe key. Retries, reconnects, and worker recovery must not create duplicate Activity entries.
- Default recipients to the task initiator; include explicit followers only where the existing subscription model supports them. Recheck access when reading or opening a notification. Do not broadcast private thread titles to the workspace.
- Successful completion uses **Task completed**, agent/thread title, and **View thread**. Failures/input requests use a distinct actionable state, never a success notification. Cancellation is not successful completion.
- Mount completion handling in the authenticated app shell, so notifications work outside the agent page. Reuse the existing Toaster instead of adding a second host. Opening a toast routes to the exact thread/result.
- Persist Activity even if the browser was closed. Show banners for fresh events after subscription, not the entire history on reload. Deduplicate across reconnects/tabs and respect existing notification preferences; introduce a task-completion preference with compatible defaults if needed.
- Activity read state and result-seen state are separate. Opening Activity may mark feed items read, matching current behavior, but must not mark all results reviewed. Opening the result can mark its associated notification read. Merely dismissing a toast does not mark the result reviewed.
- If the user is already viewing the result in a focused thread, acknowledge it after rendering; still persist the Activity event. Group completion bursts and preserve the existing toast limit. Use text/icons as well as color, and respect reduced motion.

## Delivery order and acceptance gates

1. **Recency fix:** update both resolution paths and contract semantics. Tests cover newest activity on an older-created thread, archived exclusion, ties, and the empty-agent fallback.
2. **Reproduce and fix concurrency:** identify the reported rejection, then add run-scoped admission and durable computer assignment together. Do not enable unsafe parallel shared-runtime work behind a cosmetic UI change.
3. **Lifecycle safety:** prove two simultaneous claims cannot share a computer, retries provision once, cancellation of one run leaves the other running, and success/failure/crash cleanup preserves artifacts without leaking running computers. Verify capacity failures are explicit and recoverable.
4. **Status and notifications:** add backward-compatible optional projections and task-event support, then sidebar/Activity/toast UI. Test per-viewer read state, exactly-once notifications, stale/repeated events, access removal, and archived/deleted destinations.
5. **Isolated Preview QA:** run two real tasks under one agent, including simultaneous computer use; complete one while viewing the other; verify sidebar, Activity, toast navigation, temporary shutdown, reload, a second tab, mobile, keyboard access, and both themes. Exercise native and supported managed-agent paths separately.

Deploy additive contracts/readers before enabling new writers, following the repository's scoped Convex and Preview workflow. Do not retroactively notify users about old completed runs. Roll out isolated parallel execution behind a capability/feature gate; disabling it must stop new admissions while allowing existing runs and cleanup to finish. Monitor active/temporary computer counts, allocation conflicts, queue times, orphaned resources, cleanup latency, and duplicate/missing completion events.

## Prototype validation and boundary

Built the standalone HTML and inspected its rendered desktop/mobile layouts and light/dark themes. Exercised new-thread task start with existing working threads, completion toasts, result navigation, most-recent-thread navigation, Activity rendering, reset, and primary-release/temporary-stop presentations. These checks validate the proposed interaction only, not actual concurrent execution, billing, provider cleanup, or production notifications. No production test suite, deployment, or real agent run was performed for this design-only task.

Approval requested for the interaction direction before production implementation. The main safety requirement is fixed: do not remove concurrency guards until conflicting computer/runtime access is isolated.
