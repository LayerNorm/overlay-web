# Agent thread UI

Agent threads use a flush sidebar layout. Each row reserves a 24px icon box
aligned with the agent avatar, including rows without a current activity icon.
Archive and delete remain separate actions; PR buttons do not navigate the thread.

## Pull requests

Only sidebar thread rows render `ThreadPullRequests`. Its popover lists
repository, number, title, lifecycle state and observation time, with a GitHub link.
Draft, open, merged and closed use distinct Lucide icons and accessible labels.
No PR indicator appears in the conversation header or body. Sending a new message
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
delete, reply and branch, hidden while the reply streams. The member's own
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

`AgentResponsePending` renders three compact dots beneath the author while the
response is pending. The first displayed text block permanently dismisses them
for that reply. Tool steps and pauses must not restart the dots. Terminal states
and requests for user input hide them. The existing streaming avatar stays intact;
reduced-motion mode disables the dot animation.

Work task status and priority live in an anchored settings popover. Their values
remain in the composer draft when the popover closes and reset only after successful
submission. Opening the menu must not change the composer height.

While an agent reply in the main transcript is pending or generating, the room
composer shows Stop and supports queue and steer (see "Queue and steer while a
response runs" in `interface-design.md`). Steering stops each generating
reply, including one that appears after the request, then sends the message.
Side-thread replies do not count as running for the main composer.

## Sidebar agent rows

- Clicking an agent row only expands or collapses its threads; it never
  navigates or selects a thread. Opening happens from a thread row.
- Opening a thread (or creating one) records the agent as most recently used
  and re-sorts the list in the same click, so the agent and its threads move up
  directly below the pinned chief of staff. `useFlipReorder` animates the move
  (260 ms, disabled with reduced motion).
- The row subtitle shows only in-progress counts (working, ready, needs you,
  failed). Agents with nothing in progress show just their name; there is no
  "No active tasks" placeholder.
