# Agent thread UI

Agent threads use a flush sidebar layout. Each row reserves a 24px icon box
aligned with the agent avatar, including rows without a current activity icon.
Archive and delete remain separate actions; PR buttons do not navigate the thread.

## Pull requests

Only sidebar thread rows render `ThreadPullRequests`. Its popover lists
repository, number, title, lifecycle state and observation time, with a GitHub link.
Draft, open, merged and closed use distinct Lucide icons and accessible labels.
No PR indicator appears in the conversation header or body; the thread panel's
Changes tab (below) lists the same pull requests beside the thread. Sending a new message
must retain all previous exchanges in the continuous scrollable transcript.
Newly sent agent exchanges start near the viewport top using a shrinking bottom
spacer, not a filtered transcript. Streaming does not pull readers away from
history. Jump to latest releases the turn anchor and resumes bottom following.

PR metadata is optional on the conversation and returned through the existing
caller-owned agent thread bundle. Associations come from successful structured
GitHub tool results, not assistant prose, arbitrary URLs or search results.
Creation and mutation results associate a PR; subsequent observations can update
an existing association. Failed tool calls must not fabricate a state transition.

There is no dedicated GitHub webhook/status subscription in this path. These are
**last-observed states**, not a live GitHub status feed. Changes made outside the
thread appear after a supported integration operation observes them. Existing
threads are not backfilled from historical prose. Terminal commands and browser
actions without structured GitHub results do not establish an association.

The schema change is additive and optional; no backfill is required. Rolling back
the UI can leave the metadata in place. Keep the optional Convex schema field if
rolling back the writer after rows have been populated; remove persisted metadata
before a later schema contraction.

## Response actions

Agent threads are chats with one agent, not channels. Each agent reply shows the
same action row as a personal chat reply (`ExchangeActions`): copy, retry,
delete, reply and branch. Like a chat reply, the row shows only while the
reply is hovered or focused, and is absent while the reply streams. The member's own
messages show only a hover copy button. Agent threads show no reactions, thread
replies, pins, saves, edit or report; channels and multi-person DMs keep the
channel toolbar. `RoomMessageItem` switches on its `chatActions` prop, which
`useAgentThreadTurnActions` provides only when the room has one agent
participant with a directory id.

- **Delete** calls `agents/threads:deleteTurn`, which soft-deletes the
  member's message and every agent reply to it (agent reply turn ids are
  `agent_<messageId>_<agentId>`; a started turn also records the trigger on its
  run). It refuses with `TURN_IN_PROGRESS` while a reply is still being
  written. Deleted rows disappear from the agent-thread transcript instead of
  leaving a "Message deleted" placeholder.
- **Retry** is enabled only on the latest reply while nothing is running. It
  deletes that exchange and sends the same text and attachments again through
  the normal send path, so the agent runs a fresh turn with exactly the history
  it had before. Older replies cannot be retried, because a resend lands at the
  end of the thread, after every later exchange.
- **Branch** calls `agents/threads:branch`, which creates a new thread with the
  same agent titled "<title> branch" and copies the main transcript up to and
  including the chosen message (text and file parts only, like chat branches;
  side-thread replies, deleted rows and replies still being written are left
  out; 500-message limit). The client opens the new thread.

Both mutations accept only the caller's own, non-automation agent thread.

## Response and composer behavior

Agent replies use the chat response renderer and indicator: `AssistantVisualBlocks`
for the body (shared with `ChatExchange`) and `ExchangeLoadingState` driven by
`responseLoadingPresentation`, the same rule chat exchanges use. The 24px mark
appears below the author as soon as the reply is pending, stays below the reply
through text and tool-only periods, and disappears when the reply settles or
fails. It is also hidden while the reply waits on the person for an approval or an
answer, because the agent is not working then. Room chrome (avatar with its working eyes, author row, reactions, threads,
approval and input cards) stays around it. There is no separate dots row.
The Notebook assistant panel renders its note conversation with `ChatExchange`
itself (through `EmbeddedPersonalTranscript`), so it shows the same body and mark.

Work task status and priority live in an anchored settings popover. Their values
remain in the composer draft when the popover closes and reset only after successful
submission. Opening the menu must not change the composer height.

While an agent reply in the main transcript is pending or generating, the room
composer shows Stop and supports queue and steer (see "Queue and steer while a
response runs" in `interface-design.md`). Steering stops each generating
reply, including one that appears after the request, then sends the message.
Side-thread replies do not count as running for the main composer.

## Thread panel

The right panel of an agent thread (`ThreadPanel`, rendered by
`AgentRightSidebar`) shows each surface as a tab: Assignments, Progress,
Computer, Changes, Files, the agent's settings (labelled with the
agent's name) and any opened file. Panels open once and are focused when opened
again; a file opens once per file. With no tab open the panel is the agent's
home: avatar, name, role and description above a Computer row and a row per
panel. The avatar appears only there; opening a panel replaces the home with the
tabs, and closing the last tab returns to it. A first visit starts on the home.
"+" (⌥T) opens a launcher with search and the same rows; it turns into the panel
picked from it. ⌥F opens Files, opening the panel when it is closed. Shortcuts
use Option only, so they never take a browser or text-editing command, and they
do nothing while a dialog is open. There is no Terminal tab: commands the agent
ran are tool rows in the transcript and in Progress. With four or more tabs, inactive tabs shrink to their icons.

## Assignments

`collaboration/agentAssignments:forConversation` returns, for each assignment,
the response that made it (`messageId`: the parent harness run's
`deliveryAgentRunId` -> `conversationAgentRuns.assistantMessageId`), its
`createdAt` and a `failureReason`. `AgentAssignmentsProvider` (in
`DirectMessageExperience`) loads it once per conversation. Each agent response
ends with one collapsed row for its own assignments (`ResponseAssignments` ->
`AssignmentTrace`), built from the same `Trace` parts as tool-call and "Worked
for" rows: the assigned agents' avatars (each agent once, overlapping, at most three
then "+N") and "Assigned N tasks · …". Opened, each line shows the agent's
avatar, agent and task and its state, and links to its thread; a failed line is red with its
reason underneath. Assignments with no
traceable response and the "Assigned from" link stay below the transcript.
`AssignmentsPanel` lists every assignment grouped by response with "Show in
conversation"; it is the Assignments tab of the agent thread panel and the first
view of the room sidebar. Chats and channels have one sidebar button
(`RoomHeaderActions`) that opens Assignments, with People and Pinned as tabs
(`RoomViewTabs`) and their counts. The button is hidden when the host supplies
its own right panel, as agent threads do; there People is in the ⋯ menu. Thread replies keep their own panel.

- Progress reads the newest `agentPlan` (shown with `RunPlan`) and every tool
  call in the loaded transcript, in the transcript's row style.
- Changes lists the thread's pull requests from the agent thread bundle and the
  files its computer edits changed, with summed line counts. There is no stored
  diff text, so it shows no line-by-line diff.
- The panel reads messages through `RoomTranscriptProvider`, which
  `DirectMessageExperience` provides; `threadActivity` derives all three views.
- `overlay:agent-right-sidebar` remembers whether the panel is open, its panel
  tabs and selection, its dragged width (480px default, 360px minimum) and
  whether it is expanded. File tabs and launchers are not remembered, and file
  tabs close when the thread changes. Preferences saved before tabs map Details
  to the agent tab and Library to Files.

## Sidebar agent rows

- Each mode pins its chief of staff as a tile above the other agents: Overlay in
  Workspace, the viewer's own Personal Chief in Personal (a personal chief is
  never listed in Workspace). The tile shows its avatar and name, with a
  new-thread button on hover. Agents are listed by visibility: workspace-visible
  agents in Workspace, the viewer's creator-only agents in Personal. Like other rows, clicking it only shows or hides its threads. The
  activity view keeps it as an ordinary row.
- Clicking an agent row only expands or collapses its threads; it never
  navigates or selects a thread. Opening happens from a thread row.
- Opening a thread (or creating one) records the agent as most recently used
  and re-sorts the list in the same click, so the agent and its threads move up
  directly below the pinned chief of staff. `useFlipReorder` animates the move
  (260 ms, disabled with reduced motion).
- The row subtitle shows only in-progress counts (working, ready, needs you,
  failed). Agents with nothing in progress show just their name; there is no
  "No active tasks" placeholder.
