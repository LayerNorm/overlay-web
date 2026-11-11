---
title: "API Routes As Source Of Truth"
description: "Why the web app owns backend route contracts and how other surfaces should consume them."
---
The web app owns HTTP backend route contracts. Desktop, mobile, Chrome, and external consumers use `/api/v1/*` through `@overlay/api-client` rather than copying route-specific fetch logic. Migrated browser application state uses native Convex queries/mutations directly; HTTP remains the contract for retained consumers and genuine server orchestration, not a required database abstraction.

Native browser scope derives the viewer from verified Convex identity and checks
current workspace membership and resource ownership inside the Convex function.
Mobile device push registration is native Convex, not an HTTP endpoint:
`notifications/tokens.register/unregister` derive the owner from verified identity.
Notification producers schedule internal Expo delivery; token storage, preference
filtering and receipt revocation are server-owned. See [Mobile push](mobile-push.md).

The personal-chat pilot uses `convex/lib/nativeViewer.ts`; see
[Convex workflow](convex-workflow.md#native-browser-scope). Scope checks alone do
not replace domain write policy, billing admission, audit or idempotency.

Personal browser list, summary, transcript and execution state use typed native
Convex queries when the server advertises exact list-v1, transcript-v1 and
execution-v1 readiness markers. `chat/personal:getExecution` exposes only the
current public run and thread-compatibility snapshot for the verified viewer,
workspace and conversation; its query subscription is not copied into a second
client cache. Approval, input and stop remain existing BFF commands, and model
execution, billing and harness admission stay server-owned. Missing readiness
uses the guarded legacy path for web-first rollout/rollback; a native
authorization or subscription failure does not fall back to HTTP.

Browser chat streaming shares the app client's session-recovery broker and route
workspace targeting. It retries once only for the BFF's pre-dispatch 401 with a
bare `WWW-Authenticate: Bearer` challenge, preserving the original body, turn,
request ID and idempotency key. Provider errors, ambiguous failures and started
streams never trigger chat-session replay. Explicit bearer requests and
cross-origin requests remain outside browser cookie recovery.

On an isolated protected Preview, server-side workspace-tool requests to that Preview's
own `/api/` routes add the existing Vercel automation hosting header. The configured PR
origin must match exactly; redirects are refused. Overlay's bearer/service identity,
workspace checks and idempotency keys remain required. Other origins and Production
never receive this hosting credential.

An explicit active-workspace header remains an access boundary after membership
removal: inaccessible targets return 404, just like workspace route targets,
without falling back to another workspace.

## Route catalogs

The API documentation generator also checks each v1 filesystem route against
`src/shared/schemas/api-boundary.ts`. A route must have a public boundary
definition or an explicit exclusion with its authorization and contract status.
Agent permanent deletion and workspace automatic top-up policy are accounted
for in that narrower registry; their behavior remains documented in the full
route catalog and enforced by their existing services.

Drive credential renewal uses the bridge protocol's request/response schemas in
that registry. Its explicit public-route exception replaces app-session authority
with device signatures, method-scoped host credentials and current execution checks.

The filesystem under `src/app/api/**/route.ts` is authoritative for route existence and exported HTTP methods. Use the [full web API route catalog](./api-route-catalog.md) for behavior, authentication boundaries, and implementation files, or the [compact API route catalog](./compact-api-route-catalog.md) for a one-line inventory. `npm run docs:health` verifies that both catalogs match every route entry point. The generated OpenAPI document intentionally covers a narrower public contract set.

## Rules

- Add or update endpoint contracts in `@overlay/app-core`.
- Add transport wrappers in `@overlay/api-client`.
- Keep route behavior backward compatible unless a real bug is found.
- Prefer parsed typed methods when callers only need data.
- Add `*Response` methods when callers need status codes, streaming bodies, redirects, or custom error handling.
- Browser reads and ordinary writes go through native Convex queries and mutations (`ctx.auth` identity). HTTP from the browser is for server work only: model and media runs, stop/approval/input, billing and checkout, OAuth and credentials, email, validation-heavy or audited writes, provider calls and file bytes. `npm run check:native-architecture` (CI, Lint and boundary checks) holds every browser `overlayAppClient.<resource>.<method>` call in `scripts/baselines/browser-http-calls.json`: a new call fails until it is native or deliberately added (with the reason in the PR), and a removed call must leave the baseline. The same check rejects the retired database-provider capability names and the HS256 browser token.
- Browser HTTP reads that stay on purpose (everything else the browser reads is native):
  - `integrations.get` / `getResponse` (connected accounts and the connector catalog) and `surfaces.listChannels` ask the integration provider (Composio, Slack); only the provider knows the answer.
  - `sharing.get` / `sharing.impact` (Share dialog): per-resource-type manager checks and the who-gains-or-loses-access disclosure run in `WorkspaceSharingService` right before the server-checked grant or revoke.
  - `conversations.participants` (deleting an archived room): a read immediately before the server-audited delete, which decides between leaving the room and deleting it.
  - `workspaces.list` on the OAuth consent page (`/oauth/authorize`): that page sits outside the app shell and has no Convex client.
- Stream chat directly through `/api/v1/conversations/act`. Disconnect recovery comes from persisted conversation state; `/api/v1/conversations/stream-auth` and an external replay relay are not public contracts.

Interactive browsing uses the Computer API and `computer_browser` tool on the
bound machine. The separate `/api/v1/browser-task` endpoint and
`ChatAuxClient.browserTaskResponse` have been removed; old clients receive the
ordinary missing-route response. Historical usage rows remain readable.

Automation workflow status and SSE reads resolve the workflow ID to its stored
automation/run and apply the parent resource's scope, current membership and
active workspace before accessing Workflow SDK data. Direct Convex event
subscriptions apply the same rule. Unknown or deleted parents fail closed.
Terminal run settlement queues the completion/failure webhook in the same Convex
transaction. The stable run/event ID deduplicates retries and older emitter calls;
delivery remains asynchronous through the existing signed, retrying outbox.
Delivery history and redrive accept the app's workspace context and enforce the
parent subscription's owner and workspace, including legacy delivery rows.

## Work (tasks)

Work routes (`/api/v1/work`) follow the same layering as other scoped content: thin route files, `WorkService`
(`src/server/work/`) over a `WorkRepository`, and Convex (`convex/work/`) as the owner of the rules. Convex refuses a
change with `WORK_INVALID:<reason>`; `src/shared/work/errors.ts` turns the reason into the plain message and status
the API returns (400, or 409 for an archived task or stale revision), and `Unauthorized` becomes 403.
`PATCH /api/v1/work/[id]` accepts an optional `expectedUpdatedAt` and can combine fields, status and scope atomically.
Convex checks the revision before writes, reuses the shared scope-move rules and rolls back all changes on refusal.
Combined scope requests preserve the shared `resource.move` audit, including denials; audit failure remains best effort.
Explicit scope-only moves, archive and restore also use `POST /api/v1/scope` with `resource: 'work'`. The wire types
(`WorkItem`, `WorkEvent`, `WorkContext`, and the request bodies) live in `@overlay/app-core`; `@overlay/api-client`
exposes them as `client.work`.

Personal task owners may be the creator, a live workspace-visible agent, or the
creator's own creator-only agent. Workspace tasks accept only workspace-visible
agents. Creating or changing an assignment to a usable agent starts its existing agent-turn pipeline through `WorkService`. A transaction prepares one persisted thread/message/turn identity per assignment generation; unchanged assignments and human assignments do not start another run. Startup failures can follow a saved task and return an explicit error; inspect the agent thread before clearing or reassigning an uncertain start. Context hides other people's
creator-only agents and includes creature appearance metadata. Scope moves keep
only assignees allowed in the destination and record any cleared assignee.

Task revisions advance monotonically for edits, comments, status/rank moves, scope changes, archive and restore, including
affected descendants. Expected conflicts use Convex application-error data so Production redaction preserves
the API's `409 work_conflict`. Task tools use these routes; service-authenticated agent attribution affects
activity only and never replaces the human caller's permissions.
Work scope, archive and restore mutations also require server authentication; a browser token cannot bypass
the web capability/runtime checks or supply an agent activity actor directly to Convex.

## Agent directory

Browsers read agents through the live Convex queries `agents/directory:list` and
`agents/directory:get` (`src/hooks/use-agent-directory.ts`). They authenticate with native
Convex identity and port the service's rules: creator-only agents are visible only to their
creator, `canEdit` follows the creator or a workspace owner/admin (personal chiefs: their owner),
guests cannot create, and non-members read `null`. `agents/directory:ensureChiefs` provisions a
member's chief agents once per workspace load, which the list and get BFF routes used to do as a
read side effect. Every consumer shares one subscription, so there is no directory refresh event.

Writes (create, update, archive, restore, delete) stay on `/api/v1/agents*` because they run
server-side policy and side effects: harness and external-agent policy, model support, teams,
connected-agent bindings, computer provisioning and config-profile cleanup. Desktop, mobile and
agent tools also call these routes. The live queries reflect each write in every client.
Settings → Archived lists archived agents and threads over HTTP until the settings phase (Phase F)
makes that whole page live.

Agent threads are native too (`agents/threads`): `bundle` (the member's threads and automations
for one visible agent, live), `archived`, `resolveMain` (adopts or creates the main thread once;
concurrent opens resolve the same thread), `create`, `setArchived` and `remove`. Each applies the
directory's visibility rule before the shared thread logic in `agentThreads.ts`. The sidebar opens a
live thread list without a request, and the conversation verifies a deep link against that same
list. The `/api/v1/agents/[agentId]/threads|bundle|main-thread` routes remain for server and API
callers such as onboarding.

## Connected-agent drive

The bearer-only `/api/agent-drive` transport is separate from app-session APIs and defaults off.
Convex owns scope, edit policy, quota, revisions and immutable upload receipts. The web service
issues staging uploads, verifies full size/SHA-256 and seals the verified byte buffer at a
server-only object key before asking Convex to publish the Files pointer. A mutable staging key
never becomes a canonical file. Retries use the same intent and commit result; newer revisions
produce conflict copies. The configured object-store contract supplies bounded reads and server
writes for both R2 and S3-compatible storage. Hosted acceptance remains required before enabling
the drive. Superseded versions are retired
atomically with replacement; the authenticated artifact-cleanup tick checks indexed Files
references and confirms deletion before releasing retained quota. Staging and abandoned final
keys are registered before upload, then collected after the full run deadline plus one day;
a referenced committed final is preserved. Upload and metadata receipts and budgets remain for
two days past the hard deadline, with bounded migration for older metadata receipts.

Drive credential issuance/renewal uses a device-signed host endpoint and the current persisted
run/session/attempt. The host cannot choose actor or scope. Credentials expire within one hour
and the hard deadline; execution-bound file grants survive renewal while live authority remains
required on every operation. The credential method is advertised only to drive v1 hosts.

The bridge protocol package owns public drive wire schemas; server validators re-export those
schemas and retain private storage records locally. The host client requires complete framed
manifests and verifies full download hashes across bounded ranges. Token renewal preserves the
execution and scope, while ambiguous write responses retain their durable journal identity.
The runtime hydrates the dedicated approved cache before prompting, synchronizes in the background
after actions and periodically, and awaits a final save before forwarding successful completion.
Failed final writes preserve local recovery data and report an unsaved failure. Bounded saved-file
summaries project separately from provider text and link to authorized Files rows.
R2/S3 constrained uploads bind the digest in the signed checksum header sent by the host,
rather than duplicating a query-hoisted checksum in headers. Message persistence accepts the
drive status data part so an upload failure can be projected without wedging the event outbox.

## Memory profiles

Compiled profiles are read through `knowledge/memoryProfileStore:getProfile` in
the default Convex runtime. `knowledge/memoryProfiles` owns the Node compilation
action; it does not expose profile queries. Conversation context repositories
must target the store when loading a profile.

## Expected backend errors

Carry expected Convex failures as `ConvexError` data and preserve `errorData` in
the server HTTP adapter when `throwOnError` is requested. Production Convex hides
developer error messages; string matching alone cannot enforce an HTTP contract.
Note revision conflicts carry `NOTE_REVISION_CONFLICT`, mapped to the existing
`409` response without exposing internal failures. Legacy message matching remains
for web-first deployment overlap with older backends.

Conversation history remains readable for recorded retired native runs. The single-conversation
and `messages=true` forms of `GET /api/v1/conversations` include authenticated
`nativeThreadCompatibility` metadata: `{ readOnly: false }`, the tracked-retirement
projection `{ readOnly: true, code: "native_runner_retired", message: "The harness has changed. Start a new thread to continue." }`,
or the deployment-overlap projection `{ readOnly: true, code: "native_thread_compatibility_unavailable", message: "Thread safety checks are temporarily unavailable. Your history is preserved. Please try again shortly." }`.
The optional `threadRootMessageId` query parameter selects a shared-room root; list responses
do not fan out this check.

Before querying the newer compatibility function, the web server reads the server-owned
`nativeThreadCompatibilityRevision: "tracked-native-v1"` marker from the existing authenticated
`platform/uiSettings:getByServer` query. If an older backend omits the marker, history reads still
succeed with unavailable metadata and the web does not call the absent compatibility function.
The check is not cached; authorization and query failures propagate. New message, edit/delete,
and native-admission calls covered by the web repository gate fail before invoking their backend
mutation when the marker is absent; human-facing HTTP handlers return `503`, code
`native_thread_compatibility_unavailable`, and `Retry-After: 10`.
Once available, the new backend's tracked-run classifier is authoritative and rejects retired
threads with HTTP `410` and `{ code: "native_runner_retired", error: "The harness has changed. Start a new thread to continue." }`.
New human sends, including sends in connected-agent threads, pause during this overlap; connected
remote AgentRun admission, progress, cancellation, and already-admitted execution callbacks are
not readiness-gated.

Retired-thread UI offers an explicit new-thread action with a bounded, editable,
unsent handoff; generated cards become read-only. Untracked historical transcripts
and deployed-worker drain remain follow-up work.

## Bootstrap

`/api/v1/bootstrap` returns the canonical serializable frontend registry:

- brand config
- navigation
- settings sections and panels
- feature flags
- feature modules
- tool and integration registry metadata
- model provider metadata
- policy gates
- theme metadata
- models, user, entitlements, defaults, and UI settings

Surfaces should use bootstrap first, then render their native shell from those registries.

`GET /api/v1/model-catalog` returns the authorized live AI Gateway catalog for
language, image, and video models. Clients register only media entries whose
Gateway pricing shape is supported by Overlay's reservation calculator; unpriced
media models stay unavailable instead of creating unreconcilable usage. The
settings model catalog uses this route for chat enablement and image/video defaults.

## Agent environments

Connected-agent prompt context limits preserve complete UTF-16 characters. Both
per-message history and the total context envelope must avoid splitting surrogate
pairs; otherwise Convex rejects the next command before its handler executes.
Canonical transcript bytes are preserved separately from bounded prompt context.

`/api/v1/agent-environments/**` is the only public control plane for connected hosts. Browser
clients use `AgentEnvironmentsClient` for list, enrollment creation, approval, root-scope changes,
and revocation. The retired managed `Overlay Cloud` creation route returns 410; historical records
remain readable and cleanup-only. The portable host uses the bridge protocol for BYOM enrollment,
credential issuance and refresh, heartbeat, capability refresh, command polling/acknowledgement,
and event batches.

Browser mutations require the signed-in workspace owner or admin. Host routes accept no browser
cookie authority: a redeemed one-time code establishes a pending environment, initial credentials
require an Ed25519 proof, and every later request is bound to the exact environment, workspace,
audience, allowed method, expiry, request body, timestamp, and single-use nonce. Raw enrollment
codes, proof challenges, credentials, and request nonces are never persisted.
Enrollment-session creation opts out of BFF response idempotency because its response contains the
only copy of the code; retrying creates a new short-lived code instead of persisting that secret in
the idempotency store.

`GET`, `PUT`, and `DELETE /api/v1/agent-bindings` list, upsert, and disable the workspace-owned mapping from an Overlay
agent to one approved environment, advertised ACP adapter, and granted working directory. A bound
agent follows the ordinary `POST /api/v1/conversations/message` mention path; no second remote-chat
endpoint or transcript exists. `POST /api/v1/conversations/run/remote` is the narrow browser
control for Cancel, Retry, Resume, and Start fresh. `POST /api/v1/conversations/run/remote/request`
resolves a pending permission or structured elicitation only after rechecking the human's current
workspace and room authority. `GET /api/v1/conversations/run/remote/artifacts/:artifactId`
authorizes the current participant before redirecting to a short-lived object-store URL. Hosts
create and complete scoped artifact uploads through the environment's `artifacts` subresource;
only checksum-, type-, size-, malware-, tenancy-, and retention-validated objects may be projected
into the transcript. These controls are authenticated and workspace-scoped through
`@overlay/api-client`. The internal-secret-only
`POST /api/v1/agent-environments/artifacts/cleanup` endpoint lets the Convex scheduler request
object deletion from the BFF without moving object-store credentials into Convex.
The same internal-secret boundary protects
`POST /api/v1/agent-environments/operations/reconcile`: the Convex scheduler keeps run supervision
durable while the BFF performs provider-credentialed machine metering and cleanup. PostgreSQL runs
the equivalent work through its application-data maintenance scheduler.

## Cross-Surface Adoption

Desktop and Chrome can use the React DOM packages directly where practical. Mobile should use `@overlay/app-core`, `@overlay/api-client`, and pure controllers from `@overlay/app-core/modules`, while keeping React Native rendering in mobile-specific components.

## Workspace Memory

`GET /api/v1/memory` is workspace-scoped. It returns all memories in the authorized active workspace by default and accepts `memberPrincipalId` to filter by one active human member. Each row exposes the creator's workspace identity and whether the authenticated member may delete it. Human `POST` requests write both the active `workspaceId` and authenticated creator `userId`; an authorized agent turn instead uses the opaque `agent-memory:<agentId>` owner. Update and delete remain creator-only.

Persistent chat context and hybrid retrieval both resolve memories by `workspaceId`, so memories created by one member or agent are available as shared context to other members of that workspace. Files remain owner-scoped during hybrid retrieval. Provider repositories must preserve the distinction: `workspaceId` owns memory context, while the legacy-named `userId` field stores an opaque human-or-agent owner for attribution and mutation ownership. PostgreSQL therefore must not foreign-key memory or memory-index ownership to the human `users` table; application cleanup plus the `users_cleanup_human_memory_owner` compatibility trigger preserve human account deletion across rolling upgrades and rollback.

## Account workspace entry

The browser reads the account's workspaces natively: `collaboration/directory:workspaces` lists active memberships (personal first) with member counts and routing handles, the saved active workspace (falling back to the first, without writing), and pending, unexpired invitations for the email on the account record, for active workspaces only. It never creates a Personal workspace. `collaboration/directory:resolveHandle` resolves `/w/<handle>` links for active members, and `collaboration/directory:policy` returns the sharing policy (defaults when none is stored) with `canManage`. The workspace provider, the account page and the sidebar's New buttons subscribe to these, so renames, icons, handles, membership loss and policy changes reach every tab; the route still decides each tab's workspace, so switching in one tab does not move another. Workspace settings tabs (people, guests, teams, roles, agents), chat mentions, the channel and direct-message pickers, the memories owner filter and the Slack import diff read `collaboration/management:view({ workspaceId, view })` natively. It returns the same `WorkspaceManagementResponse` rows as `GET /api/v1/workspaces/[workspaceId]/management`: active members with names and photos resolved from each account, pending invitations (expiry applied on read) and guest grants for owners and admins only, teams, role counts, and agents with the avatars of agents the viewer may see. Losing membership returns null at once. Inviting, resending (both send email), cancelling, role changes, removal, ownership transfer and team edits stay on the server.

`POST /api/v1/account/workspaces` uses an account-scoped BFF context and requires a signed browser session. Creation reuses the existing workspace validation and free-workspace limit, activates the created workspace, and sets the active-workspace cookie. Invitation acceptance is also account-scoped so accepting an invitation does not bootstrap Personal. `/api/v1/settings` is account-scoped without a session-only restriction to preserve its existing API authentication methods; the web app reads settings natively (`platform/uiSettings:mine`) and only writes through `PATCH`. The account profile is read natively too (`auth/accountBrowse:identity`); `/api/v1/account/profile` keeps only `PATCH` and the photo routes.

## Conversational onboarding

WorkOS session resolution initializes the authenticated user through `UserService`
before exposing that session to app handlers. This covers password sign-in and
retained cookies as well as OAuth, so a newly invited user has durable profile
and onboarding state before starting the flow. Concurrent initialization reads
coalesce; successful writes are cached for one minute in a bounded process cache.
Failed writes propagate and are retried, rather than caching a missing profile
or marking onboarding complete. No plan or membership is granted by this sync.

New owner sessions use `flowVersion: 2` and revision-checked name, about, team, website, and daily-work questions. Invited members skip owner questions and native employees; sessions without a flow version keep the legacy sequence. Back is limited to profile questions before side effects. Optional work-tool connections, external agents, Personal context, invitations, and the first Work task remain separate steps; solo owners skip invitations. Onboarding answers use the durable transcript outbox and completion is recorded only after the task is verified. Unfinished profile drafts are scoped to the workspace and user-owned run and step in session storage. Chat and agent questionnaires use the bounded `present_generated_ui` `questionnaire` kind: suggestions edit the composer but do not submit, authorize, or pause a tool call.

## Collaboration message contracts

- Personal and organization workspaces expose the same collaboration routes.
  Personal lifecycle mutations reject archive, ownership transfer, promotion of
  another owner, and removal, suspension, or demotion of the creating owner.
  Other Personal members may be invited, managed, and removed normally.
- `POST /api/v1/conversations/message` returns the persisted `messageId`. Agent-invocation callers use that ID directly; transcript refetch state is not an identity source.
- `POST /api/v1/conversations/message` accepts an optional `memoryEnabled` turn preference. Saving an agent-triggering room message opens the durable agent run server-side; the retired browser-held `/api/v1/conversations/agent-reply` path is not a public contract. Hosted and connected turns load bounded workspace memory and room context only when the preference is enabled. The provider-neutral collaboration repository schedules validated human- and agent-message extraction, while Convex enforces room, author, owner, and idempotency rules. Extraction-model context is separately bounded to messages from the target human or exact agent principal; other room participants are not sent to that additional provider call.
- Convex room transcript append, finalize, failure, and sanitization writes require a linked supported native Harness or connected remote AgentRun. The unowned `startAgentMessage` mutation and unmarked buffered agent posts are retired; native streaming uses the assistant message admitted by `startAgentTurn`, and startup failures are persisted directly as terminal errors. This does not grant tool-effect authority or reconcile uncertain receipts; late tool receipts may still be retained on a completed message without reopening execution.
- Serialized collaboration messages may include `editedAt` and `editHistory: Array<{ content, editedAt }>`. Convex appends the replaced body before an edit.
- Browsers read Activity through `collaboration/activity:notifications` and the DM/channel list
  through `collaboration/roomList:list`, both with native identity. Each notification
  carries `conversationType`, so opening one routes without looking the room up. Read state goes
  through `collaboration/activity:markRead`, which takes the notification ids the member has seen or
  one open room's id; a notification that arrives meanwhile stays unread, and an already-read row keeps
  its first read time. The browser applies it optimistically to the live list, and room unread badges
  are derived from that list, so there is no local read map or read event. `/api/v1/conversations/events`
  remains a long-poll fallback for non-realtime clients and must not be mounted as a browser subscription path.
- Room transcripts are native. Browsers read DM and channel history through
  `collaboration/rooms:access`, `:messages` (paginated, main timeline or one thread, indexed by
  thread root) and `:message` (permalinks and thread roots), and edit or delete through
  `:editMessage` and `:deleteMessage`, all with native Convex identity. `requireActor` accepts that
  identity only through `nativeRoomActor`, never from client arguments. Send stays on
  `POST /api/v1/conversations/message` because it starts agent runs and mention email; its optimistic
  rows reconcile against the live query. `GET /api/v1/conversations?messages=true` and the message
  PATCH/DELETE routes remain for desktop and API clients. Room and thread writability is the live
  `collaboration/rooms:compatibility` query (read through `useRoomCompatibility`), so opening a room
  or focusing the window fetches nothing; send still enforces it on the server. The former
  thread-safety-changed event and response observer are removed.
- Room metadata is native too. `collaboration/rooms:state` returns the room's participants, channel
  facts, reactions, pins, the member's saves and followed threads in it, and presence, or null once
  the member is removed, which closes the room in every open client. Actions are native mutations
  (`setReaction`, `setPinned`, `setSaved`, `setThreadFollow`, `updateMyState` for mute and read,
  `addParticipant`, `removeParticipant`, `heartbeat`) with optimistic updates applied to that query,
  so a rejected action rolls back and concurrent changes converge. Presence rows older than two
  minutes read as offline; every open client's 45-second heartbeat re-runs the query so stale
  sessions expire. Room archive and delete (self or everyone) stay on HTTP because they also update
  the conversation lists, which CN-11 moves.
- Personal chat creation is deferred until the first send. Newly created DMs and
  channels are client-side drafts until their first message succeeds: they are not
  inserted into the sidebar list, and navigating away removes the current member
  from the empty room (falling back to a self-archive when the room must retain a
  human participant). A successful or remotely observed first message commits the
  draft and emits the ordinary conversation-created event.

## Personal Chat AgentRun contracts

Connected-agent public resources are reserved under
`/api/v1/agent-environments/**` and `/api/v1/agent-bindings`; they remain
unmounted while the default-off control-plane flags are disabled. Both database
providers use `ConnectedAgentRepository` for durable command claims and ordered
event acknowledgement. Provider-branded sandbox identifiers and reusable host
credentials are never public contract fields.

- `POST /api/v1/conversations/act` exposes one personal Chat experience. Eligible
  authenticated personal calls use the Overlay Harness when the backend reports
  that capability; a successful readiness response from an older backend selects
  the existing durable `personal-chat-work` workflow instead. Readiness errors
  fail closed and never select a direct tool loop. Both paths generate durable
  turn and client IDs when omitted, create new AgentRuns with `mode: "chat"`, and
  retain the same authorization, approvals, billing, and usage limits.
- The optional `personalChatMode: "chat" | "work"` request field is deprecated,
  accepted for compatibility, and ignored. Old stored preference values are not
  read by the client; existing AgentRun modes and engine ownership remain
  readable and unchanged. Automation, service-auth, and room execution paths
  retain their separate behavior.
- Both personal streams preserve provider-native `source-url` and
  `source-document` UI parts. The transcript adapter owns compatibility with the
  legacy `source` shape and projects incomplete tool/reasoning part states to a
  terminal state once their response is completed, cancelled, interrupted, or failed.
- `GET /api/v1/conversations/run?conversationId=<id>` returns an active
  `AgentRun` when any model slot is non-terminal, otherwise the most recent
  terminal run. Clients use this response—not `conversationMessages.status`—to
  decide whether Stop or Send is available after refresh.
- `POST /api/v1/conversations/stop` atomically transitions active AgentRuns to
  `cancelled`, projects the interrupted state into their assistant messages,
  and best-effort aborts ToolLoop executions running in the same server
  process, and cancels attached Workflow runs. Assistant-message status is a
  display projection and is never consulted to decide whether Stop is active.
- `POST /api/v1/conversations/run/approval` accepts the active conversation,
  AgentRun and hook token plus an approve/deny decision. It rejects stale tokens
  and resumes only the current `waiting_for_approval` run for its initiating user.
  Owner-matching waits on retired non-remote runs return 410 with
  `native_runner_retired` and new-thread guidance without resuming the old workflow.
- `POST /api/v1/conversations/run/input` resumes a personal or native Harness
  input wait for the initiating user, exact active run and hook token. Native
  rooms require current workspace participation; creator ownership alone is
  insufficient. Owner-matching retired non-remote waits return 410 with
  `native_runner_retired` and new-thread guidance without resuming the old workflow.
  Replies remain in the existing work artifact.
- `GET /api/v1/conversations/run/metrics?from=<epoch-ms>&to=<epoch-ms>&limit=<n>` returns
  per-runner observations with explicit sample counts. It reports latency,
  provider cost, Workflow step/storage observations, disconnect and recovery
  outcomes, tool reliability, cancellation timing, and stale-run frequency. It
  deliberately returns no runner recommendation.
- `POST /api/v1/conversations/run/metrics-event` records the active browser's
  `disconnected` or `reconnected` lifecycle observation for an exact AgentRun.
  It cannot reliably observe every abrupt network loss, so report denominators
  remain explicit.
- `@overlay/api-client` exposes `conversations.currentRun()` and
  `conversations.stopResponse()` plus `conversations.submitRunApproval()`,
  `conversations.runMetrics()`, and `conversations.recordRunMetricEvent()` for
  these contracts. Convex repositories must preserve identical
  strict lifecycle transitions and metric merge behavior.
- The retired `conversationMessageDeltas` table, delta hydration queries,
  stream-auth route, and Cloudflare relay are not part of the API contract.
  Both runners persist one terminal assistant-message snapshot.

## Files, notes and memories in the browser

Browsers read files natively; the file HTTP routes remain for agents, outside apps, desktop and
byte transfer.

- `files/browse:list` is the live file tree (files, folders, notes, outputs) for one workspace
  and view, shared by the Files page and the sidebar (`src/hooks/use-file-tree.ts`). Rows are
  summaries: no text and no storage keys (`browserFileSummary`). Non-members read `null`.
- `files/browse:get` returns one readable file with its inline text (`browserFile`). The Files
  viewer opens from the list row at once and loads full text through
  `GET /api/v1/files?fileId=…&fullText=true`, which reads text kept in object storage. The notes
  editor subscribes to `get` (`useLiveNote`) so saves made elsewhere reach a clean editor.
- `files/browse:rename` and `:move` run the shared `updateFileFor` with native identity and apply
  optimistically to every cached tree. Create, delete, uploads, ingestion, text saves and note
  saves stay on the server: they place large text in object storage, clean up objects, and
  canonicalize and sanitize note Markdown.
- `files/browse:forConversation` is a thread's live Library (the agent drive panel).
- `knowledge/memoryBrowse:list` is the live Memories list with the server's rules: owner-only
  memories reach only their author, attribution covers active members and agents the viewer can
  see, and an owner filter accepts a member or agent principal. Memory writes stay on
  `/api/v1/memory` (dedupe, segmentation, indexing).

There are no file or memory change events: the shared knowledge surface takes its list from the
host (`liveFiles`) and cannot fetch or broadcast lists itself.

## Work, automations and skills in the browser

These read natively behind the same checks as their routes: an active membership, the role capability
(`work.use`, `automations.use`, `skills.use`) and the deployment feature from the native policy snapshot
(`requireNativeCapability`). Reads answer `null` without access.

- **Work** (`work/browse`): `list`, `get` (tasks outside the list window by link), `context`, `events`, and
  native `create`, `update`, `move` and `addComment` with optimistic updates
  (`src/features/work/lib/use-live-work.ts`). They share handlers with the server functions (`listWorkFor`,
  `updateWorkFor`, `moveWorkFor`, `createWorkFor`, `addWorkCommentFor`), and tasks are projected by
  `src/shared/work/projection.ts`. Assigning a task and changing its scope stay on `/api/v1/work`: assignment
  checks the budget and admits and starts the agent's turn idempotently (`prepareAssignment` claims one
  generation).
- **Automations** (`automations/browse`): `list`, `get` and `runs` are live (`src/hooks/use-live-automations.ts`).
  Writes stay on `/api/v1/automations` because enabling checks billing, pausing cancels the scheduler workflow,
  and edits append a note to the automation's thread. Resolving which automation a chat belongs to is still an
  HTTP read in the chat controller.
- **Skills** (`integrations/skillsBrowse`): `list`, `create`, `update` (with an `expectedUpdatedAt` guard for
  stale forms) and `remove`, all native (`src/hooks/use-skills.ts`). `/api/v1/skills` remains for agents and
  outside apps; mention pickers still list skills over HTTP until cross-resource pickers (CN-32).

There are no Work, automation, skill, MCP or extension change events.

## Archived items in the browser

Settings → Archived combines each resource's own native query, so every kind keeps its own access rules:

| Kind | Query |
| --- | --- |
| Rooms (archiving is per person) | `collaboration/archive:rooms` |
| Files, folders and notes | `files/browse:list` with `view: 'archived'` |
| Skills | `integrations/skillsBrowse:list` |
| MCP servers | `integrations/mcpBrowse:servers` |
| Automations | `automations/browse:list` |
| Tasks | `work/browse:list` |
| Agents | `agents/directory:list` with `includeArchived` |
| Agent threads | `agents/threads:archived` |
| Personal AI chats | the native chat list |

A source the person cannot read returns null and is reported as unavailable; the rest still show. Archives, restores and deletes made anywhere appear at once, so the page has no reload after actions and no workspace-change refetch. Restore and delete stay on their server routes, which write the audit log, delete stored objects, cancel automation workflows and handle cascades.

## Webhooks in the browser

Settings → Webhooks reads `webhooks/browse:subscriptions` and `webhooks/browse:deliveries` live for the active workspace. Both need an active membership and `webhooks.manage`, and `CAPABILITY_FEATURE` now maps that capability to the `webhooks` deployment feature for the server and native paths alike. Neither query returns the signing secret or `payloadJson`. Create and update stay on `/api/v1/webhooks` because they resolve the endpoint address for SSRF checks. Rotate, delete and redrive also stay on the server, and the HTTP list remains for API clients.

## Connections in the browser (MCP, providers, Computers, environments, surfaces)

Browsers read connection state natively; every write stays on its route because it encrypts credentials, checks
network addresses, runs OAuth or device flows, calls a provider, or checks billing.

- `integrations/mcpBrowse:servers` (membership, `mcp.use`, `mcpServers` feature) uses the credential-free
  `mcpServerSummary`; members who cannot edit a shared server get its URL without userinfo or query.
  `:connections` lists the viewer's active MCP grants for Settings → Connected apps; the endpoint is the page origin
  plus `/api/mcp`.
- `providers/browse:connections` (membership, `modelRouting`) returns personal connections plus workspace-shared
  subscription connections via `stripSecrets`. `useByokModels` feeds its cache and the model registry from it and
  calls `GET /api/v1/providers/connections` only to seed a missing default gateway (catalog data is server-side).
  Integration connected state stays on `/api/v1/integrations`, because the integration provider owns it.
- `computers/browse:list` (membership, `computers`) mirrors `ComputerService` visibility and drops provider
  references; `agents/environmentsBrowse:list` (members) drops public keys and adds the verification phrase for
  pending environments; `:bindings` is for owners and admins. The online window lives in
  `src/shared/agents/environment-status.ts` and is applied in the browser on a local clock, because a stale
  heartbeat writes nothing to re-run a query.
- `surfaces/browse:forAgent` returns an agent's workspace surface connections, bindings and `canBind` with the
  `SurfaceService` rules. Channel listing, binding and Slack OAuth stay on `/api/v1/surfaces`.

There is no connection polling in the browser.

## File listing

`GET /api/v1/files?page=true&limit=<n>&cursor=<cursor>` returns the standard `{ data, nextCursor, hasMore }` envelope. `@overlay/api-client` exposes this through `files.getPage()`. Calls without `page=true` retain the historical array response, backed by the same bounded first page, so older web/desktop consumers remain compatible during rollout. Convex serves pages through `files/files:listPage`; the legacy `files/files:list` query is capped and exists only for compatibility and internal adapters that have not adopted cursors yet.

## Database pagination (Phase B)

Convex list queries for conversations, notes, and automations now accept `limit` and cursor parameters (`beforeLastModified` for conversations, `beforeUpdatedAt` for others). The default page size is 100 (down from unbounded/200/300). Over-fetch is bounded at 3x the page limit to account for in-memory filters. The BFF `paginateArray` helper still handles final client-facing pagination on the merged result.

`watchMessages` now accepts an optional `limit` parameter. When provided, it watches only the most recent N messages (the "tail") instead of the entire transcript. The client passes `limit=200` by default; older history is loaded on demand via `getRecentMessages`.

## One-time migrations

Legacy migration-on-read patterns (e.g. knowledge-base workspace binding) are being replaced with one-time migrations tracked by the `migrationMarkers` Convex table. Each migration is identified by a `key` (e.g. `kb_personal_workspace_binding`) and scoped to a user or workspace. The BFF checks `platform/migrations:isComplete` before running the migration and calls `platform/migrations:markComplete` after. Subsequent requests skip the migration entirely.

## Rate limiting

The rate limit provider is selected at bootstrap. Redis is preferred when configured (TCP or Upstash REST), falling back to Convex. The Convex `takeManyByServer` mutation no longer prunes expired windows in the request path — pruning is handled by a periodic cron job (`pruneExpiredWindowsInternal`, every 5 minutes). This eliminates N extra deletes per authenticated BFF request.

## Realtime and shared resource state (Phase C)

### Conversation lists

Personal and workspace AI chat lists are native live queries (`chat/personal:list`). The DM and channel
sidebar list is `collaboration/roomList:list`: the viewer's active, unarchived rooms, newest activity
first, without agent threads or automation chats, a page at a time (`limit`, with `hasMore`) after every membership is sorted. A new message, rename, join, leave or archive updates
every open sidebar; there is no browser list cache, version signal or delta refetch. Archived rooms come
from `collaboration/archive:rooms`. `GET /api/v1/conversations` remains for API clients.

### Presence subscription

Presence and typing are part of `collaboration/rooms:state` and are written by the native
`collaboration/rooms:heartbeat` mutation every 45 seconds and on typing. There is no polling fallback.
The state query returns null for a member who lost access, so archive or removal never throws into a
React error boundary.

### Indexed mention and workspace search

Convex search indexes have been added to:
- `conversations.search_title` (searchField: `title`, filterFields: `userId`, `workspaceId`, `deletedAt`)
- `files.search_name` (searchField: `name`, filterFields: `userId`, `workspaceId`, `deletedAt`)
- `notes.search_title` (searchField: `title`, filterFields: `userId`, `workspaceId`, `deletedAt`)
- `automations.search_name` (searchField: `name`, filterFields: `userId`, `workspaceId`, `deletedAt`)
- `skills.search_name` (searchField: `name`, filterFields: `userId`, `workspaceId`)
- `mcpServers.search_name` (searchField: `name`, filterFields: `userId`, `workspaceId`)

`search/browse:mentions({ workspaceId, query })` (in `convex/search/browse.ts`) uses these indexes for chats, files and notes, automations, skills and MCP servers, returning at most ten per category. An empty query returns the newest items. It is used natively by the chat composer's @-menu, the notebook editor, Cmd-K and the Work context picker.

**Rules it applies:**
- Each category needs its capability: `conversations.read`, `files.read`, `automations.use`, `skills.use`, `mcp.use`.
- Other members' items appear only when shared with the workspace and readable.
- Archived and deleted items, folders, disabled skills, and automation or archived chats never appear.
- MCP results carry names and descriptions only.

**What stays on HTTP:** connectors come from the integration provider (`/api/v1/integrations`), and the query's `connectorsAllowed` flag says whether to show them. The old `/api/v1/mention-search` route and `search/mentions:searchMentions` are removed.

Relative links in markdown files resolve through `files/browse:children`, which lists one folder at a time under the tree's read rules.

`searchWorkspaceChats` (in `convex/collaboration/channels.ts`) now uses the `conversations.search_title` index for title matching instead of iterating all participant conversations. Message content search is still scan-based but limited to accessible conversations with a reduced message scan window (50 instead of 200).

## Agent and workflow efficiency (Phase D)

### Summary + unsummarized tail context loading

`ActContextService.buildMessagesForModel` now loads the conversation context summary first (via `getContextSummary`), then loads only messages at or after `summarizedThroughCreatedAt` using the new `getMessagesSince` Convex query. This replaces the previous behavior of loading the full conversation history via `getMessages` every turn and then compacting it. The summary is injected by `compactMessagesForContext` as before, but the initial load is bounded to the unsummarized tail.

New Convex query: `chat/conversations:getMessagesSince` — accepts `sinceCreatedAt` and returns only messages at or after that timestamp. Falls back to full history when no cursor is provided.

### Token-budgeted memory and skill context

Memory context is now bounded by `MEMORY_CONTEXT_CHAR_BUDGET` (2,000 chars / ~500 tokens). The top-10 memories by importance + recency are selected, then truncated to fit the budget.

Skill context uses a lightweight directory (name + description only, no full instructions) bounded by `SKILL_DIRECTORY_CHAR_BUDGET` (1,500 chars / ~375 tokens). The agent loads full instructions on demand via the existing `list_skills` tool.

New Convex queries:
- `integrations/skills:listDirectory` — returns `_id`, `name`, `description`, `enabled` only (no `instructions`)
- `integrations/skills:getInstructions` — returns full instructions for a single skill on demand

### Durable document ingestion jobs

Document ingestion is now asynchronous via durable jobs instead of synchronous in the request path:

1. Client requests a presigned upload URL via `POST /api/v1/files/presign`
2. Client uploads the file directly to R2
3. Client creates an ingestion job via `POST /api/v1/files/ingest-jobs` with the r2Key + metadata
4. A cron-triggered Convex action (`files/ingestion/runner:runMinuteTick`) picks up queued jobs and calls the BFF processing endpoint
5. The BFF downloads from R2, extracts text, creates file records, and updates the job status
6. The client subscribes to job status via `files/ingestion/jobs:watchIngestionJob` or `watchIngestionJobs` Convex subscription

New Convex table: `documentIngestionJobs` with indexes `by_userId_status`, `by_userId_createdAt`, `by_status_createdAt`.

New BFF routes:
- `POST /api/v1/files/ingest-jobs` — create a job after presigned upload
- `GET /api/v1/files/ingest-jobs?jobId=<id>` — get job status
- `POST /api/v1/files/ingest-jobs/process` — internal endpoint for the Convex runner

The synchronous `POST /api/v1/files/ingest-document` endpoint remains for backward compatibility (FormData upload flow).

### Durable workflow step events

Workflow step events are projected into Convex by `automations/workflowEventProjectorRunner:runProjectionTick` every ten seconds. The action calls the deployment-secret protected `POST /api/v1/automations/project-events` bridge on its own web deployment: Workflow SDK state and credentials belong to that host. Preview callbacks use the canonical PR origin and existing hosting bypass.

The bridge reads ascending SDK pages of at most 100 events without input/result payloads. Convex commits the page with its opaque SDK cursor, deduplicates source event IDs and preserves SDK timestamps; it resolves completion names through the step correlation ID. It re-reads the last page while a run is active, rather than comparing ingestion timestamps with source timestamps. Recent terminal runs are included so short executions finishing between ticks are projected; completed projections leave the pending set. Each tick visits at most twenty runs and rotates active runs by their last successful projection time. Terminal catch-up covers the previous 24 hours.

Clients subscribe through `automations/workflowEvents:watchWorkflowStepEvents` or `watchAutomationRunStepEvents`; both enforce the parent automation's current access. The member-authorized SSE endpoint remains a fallback. Projection failures produce sanitized diagnostics and retain the cursor for retry. The source event ID and correlation indexes supplement the existing workflow/user/automation timestamp indexes.

### Legacy cron removal

The legacy automation scheduler cron (`automation_scheduler_legacy`) has been removed. Durable automations are now always enabled and use the sleep()-based workflow (`workflows/automation-schedule.ts`) for scheduling. The `OVERLAY_FEATURE_DURABLE_AUTOMATIONS` feature flag has been removed.

## Workspace Handles

The workspace `slug` is the canonical handle; `workspaceId` remains the immutable identity and authorization key. `GET /api/v1/workspace-handles/:handle` is browser-session authenticated and membership-gated, returning `{ workspaceId, canonicalHandle, canonical }` with `Cache-Control: private, no-store`. `PATCH /api/v1/workspaces/:workspaceId/handle` accepts `{ slug }`, is owner-only, and returns `{ workspace }`. Canonical and historical aliases are stored in the indexed `workspaceHandles` registry. Backfill is bounded, resumable, idempotent, and supports a read-only preview; handle writes remain gated until registry readiness and the write activation flag are enabled.

## Workspace Billing

Workspace billing is exposed only through authenticated `/api/v1/workspaces/:workspaceId/billing*` routes. The transport contract lives in `@overlay/workspace-contracts` and `WorkspacesClient` provides summary, initialize, subscription checkout, top-up, portal, and verification methods. Summary responses expose rollout eligibility, credit buckets, subscription status, and manager-only operational data but not the billing-account identifier. Route handlers resolve membership before invoking `WorkspaceBillingService`; only owners/admins can initialize, fund, subscribe, or open the portal. Clients never submit or select a billing-account identifier.

Paid feature routes also never accept a billing-account identifier. The BFF resolves the authorized workspace and derives an API-key or resource subject; `BillingPayerResolver` chooses the account server-side. Convex hybrid search receives the already-resolved account only over the server-secret boundary, while Convex background indexing independently resolves the source workspace. The static owner-funded boundary check and `billable-feature-coverage.test.ts` are the source of truth for launch completeness.

`GET /api/v1/subscription` and `GET /api/v1/bootstrap` expose the effective payer entitlement for the active workspace. An eligible organization workspace returns its workspace billing-account plan and remaining budget to every active member; personal workspaces and organizations outside the rollout retain personal entitlements. Clients send `x-overlay-workspace-id` on workspace-scoped entitlement reads so the model picker and the server-side charge path resolve the same payer. Billing settings, checkout, top-up, and portal mutations remain personal or workspace-manager operations and never become member-authorized merely because entitlement reads are shared.

Task archive/restore/move requests preserve optional `actingAgentPrincipalId` through the scope request schema. The scope handler forwards it only for service-authenticated Work operations; browser callers retain human attribution and permissions.

## Desktop web shell

The desktop now loads the web application, so its chat/agent/file routes use the
same client and cookie session directly. Native-only server operations (session
verification and cloud transcription) use the persistent window partition, with
bounded timeouts and the existing API authorization/billing checks. Main does not
store or refresh a second WorkOS session or run a parallel provider client.

### Growth attribution

File/note creation and edits carry `byAgent` for agent tools and API-key/service
callers. Convex stores `createdByAgent` for creations; Harness binary publication
and agent-drive uploads set it directly. These records count as work produced
without crediting the owner as a human active user. Existing ownership, quota and
revision checks still apply.

All AI chats (personal, workspace-filed and automation threads) use native Convex
queries and mutations in the browser, with no readiness probe or HTTP fallback. Model
execution, streaming, stop, approval and input response stay on the server path.
