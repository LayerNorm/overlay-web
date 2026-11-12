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

## Response and composer behavior

`AgentResponsePending` renders three compact dots beneath the author while the
response is pending. The first displayed text block permanently dismisses them
for that reply. Tool steps and pauses must not restart the dots. Terminal states
and requests for user input hide them. The existing streaming avatar stays intact;
reduced-motion mode disables the dot animation.

Work task status and priority live in an anchored settings popover. Their values
remain in the composer draft when the popover closes and reset only after successful
submission. Opening the menu must not change the composer height.
