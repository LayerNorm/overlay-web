# Native collaboration (CN-07–CN-11)

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
