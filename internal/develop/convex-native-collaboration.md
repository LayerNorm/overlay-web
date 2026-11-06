# Native collaboration (CN-07–CN-11)

## Stage D: room state and presence

`collaboration/nativeRoomState` owns bounded participants, viewer state, pins,
per-viewer follows/saves and message-scoped reactions. Saved-message pagination
rechecks live room access. Participant removal revokes all native room queries.
Native writes share reaction/pin/save/follow/participant and everyone-archive
internals with legacy callers, including notification/event effects. Everyone
archive/restore still requires the workspace owner.

`NativeRoomStateProvider` is the reactive room-state owner. Action-id overlays
rebase on canonical data; settling one operation removes only its own entry.
Archive overlays also reconcile active/archived lists across navigation.
Participant additions show a pending row until the authorized roster arrives.
Native enrichment does not issue HTTP loads or local invalidation events.

Native presence keeps 45-second heartbeats and absolute 120-second session and
6-second typing deadlines. Queries never clock-filter presence; the client
schedules the next deadline and aggregates live sessions locally. The legacy
`computePresence`/`watchPresence` clock filter is retained for existing callers:
without another database write, its result can remain stale. Presence reads the
newest 200 sessions per participant via the updatedAt index, then returns the
newest 200 room sessions. Historical rows do not exhaust a fail-closed budget.
Presence errors clear presence only, never room availability. No cleanup job is
needed to make the presence window safe.

Legacy ledger: `channels` state handlers and `directMessages` participant/follow/
archive/presence handlers remain for BFF/external callers. Reports continue
through the BFF durable moderation-audit intake, unchanged. Read/unread HTTP
writes remained until CN-11 (completed below). Physical deletion keeps its existing BFF cleanup path.
Native Settings room restore bypasses legacy refresh/events; other archived
resources and personal-chat ownership remain unchanged.

## Stage A: room backend and admission

Native rooms, agent threads and activity use the existing **`chat`** deployment
feature. No new capability/configuration field is introduced. Every room access
derives the human viewer from Convex identity via `requireNativeWorkspace`, then
checks the deployment policy, `conversations.read`, and a live active participant.
Create requires `conversations.create`; edit/delete require `conversations.edit`
and the existing human-author policy. Agent rooms additionally require a live,
same-workspace, non-archived agent definition. Personal-chat ownership is unchanged.

`collaboration/nativeRooms` exposes listRooms/getRoom/listMessages/getMessageAnchor
and createDirectMessage/createChannel/editMessage/deleteMessage. These functions
never accept actor IDs, access tokens or server secrets. Revoked detail/transcript
queries return null. Lists omit inaccessible records. Message pagination uses
`by_conversationId_threadRootMessageId_createdAt`, including the undefined-root
main stream, and native Convex cursors (including equal timestamps).

Pages clamp to 1–100; related traversals cap at 200 and fail closed above that.
Room names are bounded to 240 characters in DTOs; message content and serialized
structured parts/agent plan each cap at 64,000 characters. `partsJson` and
`agentPlanJson` preserve structured
text/file/tool/data payloads without an unbounded `v.any()` return validator.
Clients must decode it only after receiving the scoped canonical message DTO.
Over-budget messages fail closed, rather than silently rendering partial content.
Message hydration remains server-side and after authorization.

Room recency is denormalized into participant `roomLastModified`, indexed by
workspace/principal/status/recency, and synchronized by collaboration event writes.
Before enabling native room lists on an existing backend, page the internal
`collaboration/nativeRoomMaintenance:backfillRoomRecency` mutation separately for
each workspace until `isDone`. It is idempotent and reads current conversation
recency transactionally. Lists fail closed with `ROOM_RECENCY_NOT_READY` when a
matching historical participant lacks the recency projection. This migration has
**not** been run on any backend during implementation.

The `nativeCollaborationRevision` readiness marker is deliberately **absent**.
The readiness helper/provider and all client migrations remain later stages;
legacy consumers remain authoritative until the complete backend is advertised.

## Send replay and partial failure

The authenticated BFF message POST remains the only human send admission boundary:
governance, sanitization, workspace checks and external read-only denial stay in
place. Convex `addMessage` now returns admission metadata including `messageId` and
`replayed`, plus the canonical turn/content/thread/mentions/memory preference.
Nonce OR human turn ID deduplicates insertion transactionally. Reusing another
author's nonce/turn is denied. Replays use original admission metadata, not mutable
retry payloads, for all downstream effects.

Chosen strategy: **retry the idempotent effects on replay**, not skip them based
only on insertion success. The canonical message and activity receipt commit in
separate transactions, so a receipt cannot be inferred from message existence.

- Activity fanout and `collaborationActivityRecordedAt` commit in one mutation.
  Retries finish missing fanout and cannot create duplicate activity.
- Mention lifecycle publishing retains
  `workspace.mention:<messageId>:<principalId>` idempotency keys.
- Native agent runs deduplicate transactionally on
  `(conversationId, userMessageId, agentPrincipalId)`, even if an invocation's
  turn ID or nonce changes. Existing invocation nonces already use canonical
  `messageId`. Queued runs without a workflow binding report `dispatchNeeded`,
  allowing recovery after durable turn admission but failed workflow launch.
  A previously recorded launch-error reply is reopened only for this queued case.
  Running/terminal runs are not relaunched. Concurrent workflow launches before
  binding may race, but native Harness `claim_execution` fences execution to one
  workflow; only its owner attaches delivery and executes/bills the turn.
- Remote agent admission already deduplicates its message/run/transactional
  dispatch intent; the remote coordinator is best-effort acceleration, not the
  durable delivery owner. Existing remote behavior is retained.

Failures remain logged without losing the saved human message; a replay can
complete missing activity, lifecycle publication, and queued native dispatch.
There is no browser multi-write sequence and no change to personal admission.

## Legacy public endpoint ledger

All entries below remain public with their existing server-secret/token auth.
Their native replacements do not call legacy authenticated endpoints; shared
creation, participant projection, and message policy internals are plain helpers.
Unless explicitly noted, server consumers go through
`ConvexConversationCollaborationRepository` and BFF conversation routes.

| Module | Retained exports | Remaining consumers |
| --- | --- | --- |
| directMessages | getAccessibleConversation, listAccessibleConversations, listArchivedConversations, accessibleConversationIds, canAccessConversation | Repository; BFF room lists/access; agent/context/surface and server consumers |
| directMessages | listMessages, watchRoomMessages | Repository/BFF transcript; `ConvexRoomMessageSubscription` legacy token watch |
| directMessages | addMessage, createDirectMessage | BFF message/DM POST; agent asks; onboarding recovery; work assignment transaction helper |
| directMessages | addAgentMessage, enqueueMemoryExtraction | Onboarding/prepared agent messages; room agent dispatcher and agent reply memory |
| directMessages | startAgentTurn, startAgentMessage, recordAgentStartFailure, appendAgentMessageDelta, finalizeAgentMessage, failAgentMessage, sanitizeAgentMessageTextParts, completeAgentToolInvocation | Native/remote execution repositories, room dispatcher; retained startAgentMessage retirement boundary |
| directMessages | listParticipants, addParticipant, removeParticipant, updateParticipantState | BFF room participants/read/mute/self-archive; legacy room panels |
| directMessages | archiveConversationForEveryone, deleteConversationForEveryone | BFF owner moderation; legacy room archive/delete actions |
| directMessages | upsertPresence, listPresence, watchPresence | BFF presence/heartbeats; legacy presence subscription |
| directMessages | recordMessageActivity | BFF authenticated message POST; idempotent canonical message activity |
| directMessages | getConversationEventCursor, listConversationEvents, watchConversationListVersion | Legacy realtime provider, list-version refresh and server event repository |
| directMessages | editMessage, deleteMessage | BFF message PATCH/DELETE legacy callers |
| directMessages | listNotifications, watchNotifications, markNotificationsRead | BFF activity/notifications and legacy realtime notification subscription |
| directMessages | setThreadFollow, listThreadFollows | BFF thread follow actions and legacy room actions |
| directMessages | getNotificationPreferences, updateNotificationPreferences | BFF workspace notification preferences |
| channels | createChannel, listChannels | Repository/BFF channel creation/listing and legacy chat sidebar |
| channels | listReactions, setReaction, listPins, setPinned, listSavedMessages, setSaved | BFF room actions; legacy reactions/pins/saves panels |
| channels | searchWorkspaceChats | BFF workspace chat search |
| channels | deleteAllConversations | Repository/BFF bulk deletion |

## Local acceptance

- `npx vitest run --config vitest.config.mts convex/nativeRooms.convex.test.ts`
- Related collaboration edit, scope, list-version and remote-agent Convex tests.
- `npx vitest run --config vitest.unit.config.mts src/server/app-api/v1/conversations/message/send-replay.test.ts`
- Existing agent dispatcher/ask Node tests, TypeScript, targeted ESLint,
  web-complexity, tenant-boundary and on-prem-boundary gates.

No UI surface changes in Stage A. Hosted readiness/client QA belongs to the later
stages on the exact-head isolated PR preview, after the full marker and recency
backfill are deployed through the trusted release workflow.

## Stage B — room client and readiness plumbing

`NATIVE_COLLABORATION_FUNCTIONS_READY` is the single rollout flag. Stage E sets it
**true** now that CN-09..11 are implemented. Independently, uiSettings
advertises `native-collaboration-v1` only after the global recency migration has a
persisted positive completion timestamp. The minute cron kicks an idempotent
internal mutation; each 100-row page commits its cursor and schedules its
successor atomically. A stale scheduling lease lets the cron resume failed work.
The existing migration marker table stores this migration's cursor and lease;
`completedAt: 0` denotes incomplete progress for this dedicated key only.

The server probes the existing settings endpoint. Shell plumbing is additive,
inside the unchanged personal provider so a collaboration failure does not
discard the personal provider's state. Native collaboration is disabled until
both native auth and backend readiness are present. Once activated, query errors
or loss of readiness produce unavailable UI, not an implicit legacy rollback.

Native room sessions remount on account/workspace/room boundaries. Queries and
overlays additionally reject mismatched room, viewer and thread scopes before
rendering. A null room removes the transcript and drops pending overlays. The
main stream and selected thread use independent compound-cursor subscriptions;
permalink and old root anchors load independently. Convex's pagination hook does
not support nullable pages: getRoom gates subscription admission, and a raced
null message page fails closed through the native error boundary.

Native room lists feed ChatInlinePanel (including sidebar uses), mixed lists,
the archived route and Settings → Archived. Mixed legacy indexes may still read
personal/shared-personal rows, but their room rows are discarded before merging
native rows. DM/channel-only panels suppress the legacy list and list-version
refresh entirely. Native creates and edit/delete use identity-derived mutations.
Sends still use the BFF with stable nonce/turn retries; only pending sender rows
live in React and `mergeRoomMessages` reconciles them with canonical rows.

Room metadata actions, presence, notifications and combined list-version
infrastructure remain for CN-10/11. No legacy endpoint is removed in Stage B.

## Stage C — agent threads

`agents/nativeThreads` derives actors from identity and checks the chat policy,
capability, live workspace membership, agent visibility, live definition and
agent principal/membership. Exact access also requires both active room
participants. Foreign, removed and archived-agent deep links return null.
Lists paginate the workspace/agent/owner/recency index; main derivation bounds
related caller threads at 200 and fails closed above that limit. DTOs carry the
viewer and full scope so stale cached rows cannot authorize a new selection.

Native and legacy resolvers share the transaction that adopts the compatible
DM identity, skips caller-archived mains and creates a fresh main when needed.
Creation uses a caller-scoped request-id index. Archive remains caller-scoped;
delete retains the legacy global soft tombstone and last-active-thread guard.
No message history is physically removed by thread deletion, matching legacy.

The sidebar reads paginated native threads, not HTTP bundles. Its separate
`GET /agents/:id/automations` request retains automation metadata (the server
still delegates to the legacy bundle service). Pending destinations render a
shell while authorization/resolution finishes. Archive overlays remove only
their own settled operation; Undo restores the row without changing selection.
Native creation retries preserve request ids. Ready-path failures never use
the legacy resolver or legacy creation as fallback.
Pending destinations distinguish live operations from reload recovery; a
reloaded create replays its original request id. Completion replaces the
temporary destination so browser Back cannot become trapped in a pending shell.

Legacy thread server-secret functions remain for repository/BFF callers and
disabled clients. Archived Settings still uses its legacy archived-agent/thread
ledger until the remaining metadata/archive migration. The readiness flag
remained false at Stage C, pending CN-10/11. Stage E completes that gate below.

## Stage E — activity, read watermarks and rollout

The functions-ready flag is now true. The advertised revision still requires the
completed, persisted participant-recency backfill. No deployment, backfill run or
shared-backend mutation is part of this implementation.

Native activity paginates the recipient index and rechecks current room access
for every returned item. Destinations carry direct/channel/agent-thread, archive,
message and thread-root metadata; navigation does not resolve types over HTTP.
Removed participants' notifications disappear from lists and counts immediately.
Unread counters seek distinct conversation groups in the unread index, not a
notification page. Every displayed bucket is `{count, capped}` with cap 99.
`rooms` counts rooms with unread notifications. Kind counters categorize those
notifications. Loaded room badges subscribe to separate, at-most-100-ID indexed
count queries, so older rooms are not misreported because a global page omitted
them. Capped optimistic counters remain conservative until canonical counts land.

Room reads clamp the observed sequence to the latest event and take the maximum
with the stored cursor. Native rendering measures intersecting message DOM rows;
loaded but offscreen rows cannot advance the watermark. Notification reads only
affect owned IDs at or before the observed creation-time watermark. Room reads
also clear notifications through the observed event sequence, not newer arrivals.
Room and mark-all actions drain idempotent 100-write batches from the client with
the same watermark. No scheduler call site is added. Closing the client can leave
a partially completed read; repeating the action safely finishes the remainder.
Per-action overlays are removed independently; a failure does not undo later
successes or canonical writes. Observer attempt bookkeeping is not read truth.

Native activity, desktop badges and room badges use canonical indexed counts,
not permanently retained local read maps. Activity auto-read observes loaded
items; older pages remain available through Load older activity. The native path
does not emit collaboration read/notification invalidation events. External
delivery, preferences, mentions and moderation retain their existing boundaries.

List-version retirement was checked against all consumers: ChatInlinePanel is
the only consumer of the combined version (including its AppShell sidebar use).
Its room adapters own DM/channel lists; PersonalChatProvider owns personal lists;
the native thread provider owns agent sidebar lists. Archived room and personal
surfaces have their own subscriptions. Global archived agent/thread settings
remain an explicitly retained BFF ledger, not a list-version consumer. Workspace
list-version and legacy notification subscriptions are skipped whenever native
collaboration owns the scope. The independent personal version remains subscribed
when personal native ownership is disabled; native-disabled installations retain
both legacy subscriptions.

Anonymous workspace routes now use the existing sign-in-link convention with a
return destination. Settled guests cannot complete workspace resolution because
the workspace provider is disabled; workspace gates previously kept waiting on
that unresolved target. Both hydration and scoped-content gates check settled
anonymous auth before waiting. Unscoped personal/account/unknown routes keep their
existing behavior; pending authenticated workspace switches still preserve drafts.

### Native function inventory

| Module | Exact public functions |
| --- | --- |
| agents/nativeDirectory | context, bootstrapChiefs, list, get, create, update, restore |
| collaboration/nativeRooms | listRooms, getRoom, listMessages, getMessageAnchor, createDirectMessage, createChannel, editMessage, deleteMessage |
| agents/nativeThreads | listThreads, getThread, resolveMainThread, createThread, setThreadArchived, deleteThread |
| collaboration/nativeRoomState | getRoomState, listReactions, listSavedMessages, setReaction, setPinned, setSaved, setThreadFollow, setNotificationLevel, setRoomArchived, restore, addParticipant, removeParticipant |
| collaboration/nativePresence | heartbeat, watchPresence |
| collaboration/nativeActivity | listNotifications, getUnreadCounts, getRoomUnreadCounts, markRoomRead, markNotificationsRead, markAllNotificationsRead |

### Remaining legacy callers (current ledger)

All functions below remain public compatibility/server boundaries. Native-ready
room/thread/activity paths do not fall back to them after a failed native call.
The module prefix in every row is `collaboration/` unless explicitly `agents/`.

| Module | Exact functions | Remaining consumers |
| --- | --- | --- |
| directMessages | getAccessibleConversation, listAccessibleConversations, listArchivedConversations, listMessages, accessibleConversationIds, canAccessConversation | ConversationCollaborationRepository/BFF conversation reads, disabled web, external clients, retained global archive/search ledgers |
| directMessages | watchRoomMessages | ConvexRoomMessageSubscription for native-disabled room transcripts |
| directMessages | addMessage, addAgentMessage, enqueueMemoryExtraction | Authenticated BFF send, work assignments, agent orchestration/memory; no browser multi-write send |
| directMessages | startAgentTurn, startAgentMessage, recordAgentStartFailure, appendAgentMessageDelta, finalizeAgentMessage, failAgentMessage, sanitizeAgentMessageTextParts, completeAgentToolInvocation | Server-owned agent workflow/stream/tool lifecycle and repository callers |
| directMessages | createDirectMessage, listParticipants, addParticipant, removeParticipant, updateParticipantState, archiveConversationForEveryone, deleteConversationForEveryone | BFF/external callers and native-disabled web; physical deletion/moderation cleanup remains server-owned; legacy read cursor is monotonic |
| directMessages | upsertPresence, listPresence, watchPresence | Legacy BFF heartbeat and native-disabled presence consumers |
| directMessages | recordMessageActivity | Durable BFF admission fanout keyed by canonical message ID |
| directMessages | getConversationEventCursor, listConversationEvents | Server event repository and external event consumers |
| directMessages | watchConversationListVersion | Workspace legacy realtime only when native collaboration is disabled |
| directMessages | editMessage, deleteMessage | Legacy BFF mutation clients and disabled web |
| directMessages | listNotifications, watchNotifications, markNotificationsRead | BFF/external notification clients and native-disabled activity |
| directMessages | setThreadFollow, listThreadFollows, getNotificationPreferences, updateNotificationPreferences | Disabled thread-follow panels; BFF notification preference UI and server delivery preferences |
| channels | createChannel, listChannels, listReactions, setReaction, listPins, setPinned, listSavedMessages, setSaved | Repository/BFF callers, native-disabled rooms and retained global saved-message consumers |
| channels | searchWorkspaceChats, deleteAllConversations | BFF search and privileged bulk deletion |
| agents/agentThreads | createThreadByServer, resolveMainThreadByServer, listThreadsByServer, listArchivedThreadsByServer, setThreadArchivedByServer, deleteThreadByServer | AgentThreadService/BFF compatibility, disabled clients and global archived-thread settings |
| agents/agentThreads | listAutomationsByServer | Separate agent automation metadata endpoint |
| chat/conversations | watchPersonalConversationListVersion | Personal legacy list ownership only; retained even when collaboration is native |

### Local/preview acceptance

Run the new native Convex files, full `vitest.unit.config.mts`, changed Node seams,
TypeScript, web complexity, tenant/on-prem/shared-isomorphic gates, changed-file
ESLint, `docs:check`, production build and `git diff --check`. On an exact-head
isolated preview, verify two-client reactions and roster revocation, timer-only
presence expiry, archive/Undo after navigation, notification destinations and
watermarked reads. Confirm anonymous scoped URLs show Sign in and personal chat
still works. No preview/back-end deployment is authorized by a local commit.
