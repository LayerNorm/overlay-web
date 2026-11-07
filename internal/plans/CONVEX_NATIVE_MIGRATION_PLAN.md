# Overlay: Convex-native web application migration

Status: in progress as of 2026-11-06. This architecture is being executed through [the phased PR plan](./CONVEX_NATIVE_PR_PLAN.md), which tracks per-card progress. The foundation and personal chat are live in production, with partial acceptance recorded in that plan. Convex is the only supported backend, and the product has effectively no users, so the compatibility windows, rollout flags and dual-path guidance below are superseded by that plan's "Every domain finishes by contracting" rules. The PR that lands the last phase deletes this plan.

**Scope of this decision:** the architectural direction and the sequence below, not a big-bang implementation.

**Repository baseline:** `LayerNorm/overlay-web`, inspected at `ff51317d57c07bc22aa1a457a523aeb8a2ea51fd` on November 4, 2026. This is a code-grounded plan, not a production latency measurement or a completed security audit. File references are relative to the repository root. New function/hook names below are proposed interfaces, not claims that they already exist.

## 1. Executive decision

Make **Convex the explicit application database and reactive state layer**. Use **Next.js as the rendering, routing, session, and genuine server-orchestration layer**. Stop routing ordinary browser application reads and writes through a database-portability abstraction.

The normal application paths become:

```text
Read:
React domain hook -> authenticated Convex query -> rendered projection

Write:
UI event -> Convex mutation + optimistic query update
         -> authorized transaction -> subscribed clients reconcile

External work:
authorized command -> durable job/run record -> appropriate executor
                   -> authenticated progress/results -> Convex subscriptions

Initial rendering, where useful:
Next.js Server Component -> authenticated Convex preload
                        -> Client Component with the same reactive query
```

We retain boundaries that protect the product: authorization, domains, presentation, external providers, file storage, agent execution, public APIs, and operator administration. We remove boundaries whose only purpose is an interchangeable database or an internal HTTP representation of data the browser could subscribe to directly.

This is **not** a database migration. Most application records already live in Convex. It is primarily a migration of authentication, access paths, state ownership, transaction boundaries, and UI behavior, with additive indexes/projections where necessary.

### Non-negotiable outcomes

1. A message sent in one client appears in another authorized client without refresh.
2. Archive, rename, reactions, and similar reversible changes acknowledge the interaction immediately.
3. Navigation opens a useful destination shell immediately, even when content still needs loading.
4. Each persisted domain has one authoritative reactive read path, not HTTP snapshots plus independently maintained React copies.
5. Browser-direct operations preserve all existing security and business-policy enforcement.
6. Superseded plumbing is deleted as slices finish. There is no permanent legacy-versus-Convex mode.
7. External consumers and execution runtimes keep working. Convex-first is not permission to break the SDK, agent protocol, native clients, or webhooks.

## 2. What the code establishes

| Finding | Evidence | Consequence |
|---|---|---|
| The database abstraction is already Convex-only in practice | `src/server/app-data/capabilities.ts`, `repositories.ts` | Provider selection adds indirection without providing a requested product capability. |
| Personal chat subscribes but discards incoming user rows | `src/features/chat/components/chat/useLiveConversationSync.ts`, `live-message-patching.ts` | Replacing transport alone is insufficient. Transcript ownership and reconciliation must change. |
| Collaborative rooms already have a different live-message implementation | `src/features/chat/components/collaboration/ConvexRoomMessageSubscription.tsx`, `room-message-view.ts` | Preserve useful reconciliation behavior; do not attribute all chat symptoms to the personal-chat defect. |
| Room loading still waits on HTTP snapshots | `src/features/chat/components/DirectMessageExperience.hooks.ts` | Live data can arrive before the UI's loading gate releases. |
| Agent thread opening and archive have explicit network waits | `src/components/layout/AppSidebarAgentsPanel.tsx`, `src/features/agents/lib/use-agent-thread-scope.ts` | Remove client-visible waterfalls while keeping backend authorization. |
| Files wait for a complete record before selecting the viewer | `packages/overlay-modules-react/src/knowledge/surface-state.ts`, `src/features/knowledge/adapters/webKnowledgeSurfaceAdapters.ts` | Selection and viewer opening must not wait for full content. |
| Work already implements manual optimistic state around HTTP | `src/features/work/components/WorkDataProvider.tsx` | Preserve its responsiveness while replacing reload/version/ref bookkeeping with subscribed state. |
| Browser Convex auth currently uses an HS256 token in query arguments | `src/components/providers/ConvexAuthProvider.tsx`, `convex/lib/browserConvexToken.ts` | Native identity requires a deliberate auth migration, not simply calling `setAuth` with that token. |
| Native WorkOS JWT verification is configured separately | `convex/auth.config.ts` | There is a starting point for native identity, but configuration is not proof the current browser flow works through it. |
| Some Convex operations are privileged server entry points | `src/server/work/ConvexWorkRepository.ts`, `convex/work/workItems.ts` | They cannot simply be exposed to browser calls with their existing privileged arguments. |
| Shared UI packages deliberately prohibit Convex and web-private imports | `scripts/ci/ensure-module-presentational-boundaries.mjs` | Keep presentation reusable; remove data repositories from its ownership rather than pushing backend code into widgets. |

This inventory combines detailed inspection of the reported interactions with a broader scan of routes, features, API-client usages, providers, and Convex domains. Before deleting an endpoint, Phase 0 must establish its actual consumers; an absence of web callers is not evidence of no external users.

## 3. Architectural ownership

### 3.1 Convex owns persisted application state

- Conversations, messages, participant state, read cursors, reactions, pins, notifications.
- Agent profiles, thread associations, durable run state, approvals and pending input.
- File/folder metadata, content-version references, publication and ingestion status.
- Work items, assignments, comments, ordering, dependencies, activity.
- Automation definitions and durable execution progress.
- Workspace membership, resource scope, roles, invitations, app preferences.
- Safe integration configuration, connection status, skill/MCP metadata.
- Application billing projections, usage records, entitlements, limits, and job state where currently persisted there.

Convex is authoritative for the application's records. It does not make an external provider's payment settlement, computer readiness, or OAuth success true before that provider confirms it.

### 3.2 React and the router own transient interaction state

- Open dialogs, selected rows, expanded folders, active tabs, focus, scroll position.
- Search text, unsaved form drafts, unsent messages, upload byte progress.
- The current route and local selection. A workspace selected in one tab must not forcibly navigate another tab.
- Connection/retry notices and locally pending command indicators.

Do not copy an entire query result into `useState` just to render it. Derive view models from query results. Form drafts are a valid exception: track the base revision and dirty fields so a remote update cannot silently overwrite edits.

### 3.3 Optimistic state owns only pending intent

Use Convex mutation optimistic updates for changes to loaded query results. Keep a small pending-intent overlay only when the canonical query cache cannot yet represent an entity, such as a message before the first page loads.

The overlay must have a stable operation ID, owner/scope, reconciliation rule, error state, and removal condition. It must not become another permanent database.

### 3.4 Next.js retains useful responsibilities

- Server-rendered layouts, routing, redirects, public pages, metadata, and initial authorized data where it materially improves first paint.
- HTTP-only session cookies, sign-in/sign-out, token refresh endpoints, OAuth callbacks, native auth handoff.
- Public REST/SDK contracts and HTTP integrations that have real consumers.
- Request-specific execution, streaming, provider gateways, downloads, and signatures where that runtime remains appropriate.

It stops being a mandatory proxy for normal web-app CRUD and subscribed records. A Server Action that merely forwards a normal UI write to Convex is not the new default either.

### 3.5 Keep explicit external/runtime boundaries

Do not move file bytes into Convex solely to make metadata reactive. Do not move agent execution into a request handler. Do not rebuild a working provider integration merely because its status view moves to Convex.

Keep external adapters for object storage, inference, Computers, payment providers, email, OAuth, MCP transport, and agent execution. They write durable status back to Convex so every UI sees one truth.

## 4. Authentication and authorization foundation

This precedes expanding browser-direct access.

### 4.1 Target native browser identity

Use `ConvexProviderWithAuth` or the supported auth-provider integration so Convex verifies the browser token and handlers derive identity from `ctx.auth.getUserIdentity()`.

For the hosted WorkOS path, reuse the existing WorkOS identity and the configured asymmetric JWT verification. Keep the existing login/session product behavior. A session endpoint may supply a short-lived access token to the client; refresh credentials and server signing secrets remain server-only.

The current HS256 browser token is an explicit application-verified argument. **It must not be passed to native Convex auth unchanged.** Also, the fact that queries cannot fetch JWKS does not preclude native authentication: the Convex platform performs native JWT verification outside the query handler.

For other actually supported auth modes, including self-hosted configurations, preserve their identity mapping. Use a compatible provider-issued JWT or an asymmetric application token bridge with narrowly configured issuer, audience, and JWKS. This is auth compatibility, not database portability. Do not introduce another identity provider or change user IDs as a side effect of this project.

### 4.2 Foundation implementation checklist

1. Inventory deployed auth modes and map each subject to the existing application user ID. Test multiple issuers without accidental identity collisions.
2. Prove native browser queries/mutations, server preloads, forced refresh, expiration, logout, preview login, and native session handoff on an isolated backend.
3. Establish one identity helper for browser functions and explicit, separate service/API-key principal handling for external calls.
4. During transition, separate legacy wrappers from new native entry points. No silent fallback from failed native auth to a more privileged path.
5. Gate subscriptions until identity is ready. Distinguish loading, unauthenticated, forbidden, missing record, and disconnected.
6. Reset/detach old subscriptions and sensitive state on account changes or logout. Partition UI drafts by identity, workspace, and resource.
7. Remove explicit browser-token query arguments, periodic token plumbing, and the minting endpoint once their final consumer has migrated.

Success means token refresh does not remount the entire app, duplicate messages, clear valid drafts, or leave stale authorized data visible after a scope change.

### 4.3 Preserve policy, not just identity

Every public Convex function must enforce the relevant rules currently distributed across BFF authentication, workspace resolution, services, and repositories:

- Membership, personal/workspace scope, resource ownership, participant access, sharing grants.
- Role and action permissions, archive semantics, connected-agent authority.
- Subscription/credit/usage admission where required, quotas, rate limits.
- Runtime validation, idempotency, audit actor attribution, and abuse protections.
- Server-only secret handling and separation from operator privileges.

Resolve the actor from verified identity, never from a browser-supplied `userId`. A workspace ID selects a requested scope; it does not authorize it. A document ID is not a capability.

Read membership and permission records as query dependencies so revocation updates subscribed views, not merely future page loads. Recheck authorization in mutations. Preserve explicit safe projections instead of returning full database documents with secrets or internal fields.

### 4.4 Canonical business logic

Use domain-specific Convex helpers that receive a query/mutation context and a verified principal. Both browser functions and retained trusted server wrappers invoke that logic.

Pure validation, permission predicates, state machines, and formatting can live in `src/shared/`. Database work belongs in Convex domain helpers. Node-specific/external orchestration remains server-only or in appropriate Convex actions.

Next.js cannot call an `internalMutation` as an ordinary external HTTP client. A retained server path must use an appropriately authenticated public bridge or a supported server integration, with credentials isolated on the server. Internal functions are invoked from Convex actions/schedulers/functions. Do not solve access by distributing a deployment/admin key to ordinary application processes.

Keep admin separate: `apps/admin` and dedicated operator authorization do not become customer web features.

## 5. Function, query, and rendering conventions

### 5.1 Functions express product operations

Keep the existing domain-folder organization under `convex/`. Prefer operations such as `archiveThread`, `markRead`, `submitMessage`, `moveWorkItem`, and `completeUpload`, not a new generic browser `Repository<T>` or arbitrary document patch API.

Use generated `api`/`internal` references and generated argument/result types for application code. Share public SDK DTOs where they provide a real contract; do not force every internal query through an HTTP envelope.

- **Queries:** authorized reactive reads, indexed and bounded, without external I/O.
- **Mutations:** transactional state transitions, validation, counters, audit/outbox/job creation.
- **Actions:** external work or orchestration that cannot be transactional. Validate at the boundary and again when committing sensitive results.
- **Scheduled functions/workers:** durable jobs and retries, with idempotent effects and explicit lifecycle state.

Do not convert a transactional operation into a browser sequence of separate writes. Creating a message plus its run admission record should not leave half-completed state because the second request failed.

### 5.2 Domain hooks organize, not disguise, Convex

Suggested ownership: `src/features/<domain>/data/` or equivalent existing feature-local hooks.

Hooks may coordinate `useQuery`, `usePaginatedQuery`, `useMutation`, query arguments, projections, and optimistic updates. They must not recreate an interchangeable provider interface, manual polling cache, or generic invalidation bus.

Presentational packages receive data, loading/error state, and callbacks. The web host owns subscription lifetimes. For Files, specifically replace repository-driven loading in the shared surface with controlled reactive input from the host; merely implementing the old `get/list/subscribe` contract with another cache would preserve the original ownership problem.

### 5.3 Design query shapes for UI and cost

- Subscribe to a bounded list of summaries, and separately to the active detail.
- Include enough list data to navigate immediately, such as thread IDs, titles, scope, and safe destination type.
- Exclude message bodies, file text, credentials, and bulky run logs from sidebars.
- Add or adjust indexes for workspace/scope, membership, archived state, parent folder, conversation, and stable ordering as needed.
- Do not implement every list as `.collect()` plus a client filter.
- Avoid N+1 subscriptions for every agent/thread/card. Batch small related summaries where appropriate, without creating one enormous app-wide query.
- Separate high-churn streaming/presence data from low-churn metadata to avoid invalidating the entire shell on every update.
- Paginate independently where mixed entity types have incompatible cursor/order semantics. Do not silently cap a list and represent it as complete.

### 5.4 Next.js initial rendering

Use authenticated `preloadQuery` with `usePreloadedQuery` selectively for important initial views. The client must continue the same query with the same scope, not initialize a competing state array from a server snapshot.

Convex documents this integration as beta. Validate the installed Convex/Next versions before adopting it broadly. Plain client subscriptions with immediate skeletons remain a valid default.

`fetchQuery` in a Server Component is a snapshot, not realtime. Use it for actual server-only decisions, not as the permanent owner of interactive data. Independent server preloads do not guarantee the same database snapshot; combine tightly coupled initial data in a bounded query where consistency is important.

Do not statically cache private results or serialize privileged tokens. Do not let optional preload failure hold an entire route blank. Prefer a stable layout and independently loading detail panels.

### 5.5 Navigation and cache policy

- Navigate/select immediately using an already authorized list summary.
- Authorize the destination in its Convex query; remove redundant client-side fetches of an entire list just to determine access.
- Preserve available data within the same authorized scope. Never display the previous workspace's content while the next one loads.
- Reuse the stable Convex client and identical query arguments. Do not assume queries stay cached indefinitely after unmount.
- If profiling demonstrates a need for prefetching/retention, use a supported bounded query mechanism with explicit eviction, not another global normalized cache.
- Native browser back/forward, deep links, legacy redirects, and workspace URL semantics remain intact.

## 6. Mutation and optimistic-interaction contract

### 6.1 Reversible metadata edits

Archive/restore, rename, pin/save, reactions, assignments, task movement, and simple preferences should use optimistic query updates.

The update must affect all relevant **loaded** projections: list, detail, sidebar, archive list, and badges where applicable. Unknown/unloaded pages are not fabricated. Query reconciliation supplies the authoritative result.

Optimistic functions must be deterministic and safe to rerun. Allocate operation IDs/timestamps outside the updater and pass them in. Do not start network work, mutate React state, or emit toasts inside an optimistic updater.

On rejection, remove only the failed optimistic layer and show actionable feedback. Never restore a stale full-array snapshot over subsequent writes or remote updates.

### 6.2 Ordering and Undo

- Use explicit desired-state mutations, for example `setArchived(true)`, rather than ambiguous toggles.
- Sequence local commands on the same resource where ordering matters.
- Undo is a new authorized write, not an unconditional restoration of an old cached object.
- If Undo arrives before archive settles, queue the restore intent and reconcile in order.
- For actions vulnerable to conflicting remote edits, use a revision/expected-state precondition. A stale Undo must not resurrect a deleted item or overwrite unrelated metadata.
- If archiving the open thread changes navigation, choose a known accessible sibling or an immediate empty/detail shell. A failed archive restores data, but must not yank the user back after they deliberately navigate elsewhere.

### 6.3 Destructive, financial, and external operations

Do not optimistically claim a permanent deletion, a payment, an OAuth connection, or a provisioned Computer has succeeded. Show immediate pending feedback and disabled duplicate submission, then render durable progress and final confirmation.

Durable commands need application idempotency across retries, duplicate submissions, and worker redelivery. Convex transaction/retry behavior does not make external side effects exactly once.

### 6.4 Concurrent editing and offline behavior

- For document and configuration drafts, save against a base revision. On conflict, preserve the draft and offer reload/merge/retry; do not silently overwrite another author.
- Keep unsent drafts through transient network loss. Clearly identify unconfirmed messages/changes.
- Do not advertise durable offline editing as a free Convex feature. Browser reload survival requires an explicitly designed draft/outbox policy.
- On reconnect, let subscriptions recover authoritative state. Do not run an HTTP poller alongside a recovering Convex query.
- Distinguish refreshable auth failure, loss of authorization, and temporary transport failure.

## 7. Chat and streaming design

This is the first complete product slice and the template for later work.

### 7.1 One transcript projection

Render a canonical view derived from persisted Convex messages, valid pending local messages, and an optional active-stream overlay. Both personal chats and collaborative rooms use shared identity/order/reconciliation rules while retaining different product semantics.

Do not keep independently authoritative `actChat.messages`, `askChats`, HTTP snapshots, and subscription-patched arrays. Runtime chat libraries may still own the active transport session, but their history becomes an input/output adapter to the canonical projection rather than a second source of truth.

Preserve ask/act modes, response variants, tool parts, approvals, attachments, citations, edited/deleted messages, and historical compatibility. Do not flatten those distinctions merely to unify rendering.

### 7.2 Message submission and identity

1. Allocate a stable client nonce/operation ID and render the local pending message immediately.
2. An authorized mutation atomically persists the user message and necessary run/queue admission state. Validate access, credits, quotas, and attachments as appropriate.
3. Persist the nonce with the message and deduplicate retries transactionally using a scoped lookup/index.
4. Reconcile the optimistic row by nonce, then canonical ID, without appending a duplicate or changing its React key unnecessarily.
5. Trigger execution durably. A tab closing after send must not abandon an accepted run.
6. Other clients see the persisted user row without needing a locally originating turn.

Agent/DM/channel-specific semantics, including who is invoked by a message, remain explicit server rules.

### 7.3 Streaming

Keep the existing appropriate streaming executor/transport initially. Make Convex persist enough incremental output for observers, reloads, and reconnects to follow the same run.

- Use stable run/message/part identities and monotonic sequence/version markers.
- Batch durable progress into bounded chunks or checkpoints. Do not write the entire growing transcript on every token.
- Query only the active stream window/parts needed for the visible run.
- If the sending client receives a lower-latency direct stream, treat it as a temporary overlay. A committed sequence supersedes the corresponding local content.
- Ignore stale/out-of-order chunks; deduplicate resumed delivery.
- Terminal completion, failure, cancellation, and final message content reconcile without lost or doubled text.
- Coalesce complete markdown chunks to preserve the current no-flicker rendering requirement.

Choose checkpoint cadence after measuring bandwidth and remote-view lag. Rewriting all executors or installing a new streaming component is not a prerequisite for fixing the UI ownership problem.

### 7.4 Pagination and live history

Prefer one native paginated query for the transcript ordered by a stable server key, with loaded pages remaining reactive. Keep thread replies separate where product structure requires them.

Do not treat a fixed 200-row tail as complete history. If a separate tail must coexist temporarily with older pages, specify exact boundaries, deduplication, edits, deletions/tombstones, and eviction behavior before shipping it.

Deep links need an authorized anchor/window lookup so older targets can load without downloading the entire conversation. Preserve scroll position when prepending history. Auto-scroll only when the user is following the latest messages or sends their own, not whenever any subscribed row changes.

### 7.5 Runs, unread state, and presence

- Subscribe to current run state, queue state, approvals, and input requests. Mutations accept/decline/stop idempotently; the executor reports actual completion.
- Read cursors move monotonically. A stale tab must not move a cursor backward or mark unseen future messages read.
- Define read events around actually viewed content, preserving current product semantics.
- Compute unread summaries transactionally or with a deliberate projection, not a full transcript scan per sidebar item.
- Presence is bounded, ephemeral, and throttled. Heartbeats remain legitimate; UI polling of stored presence does not.
- Expiry needs scheduled cleanup or explicit client expiry rendering. A query does not rerun merely because wall-clock time passes.

## 8. Surface-by-surface migration inventory

Each workstream includes all entry points: main page, sidebar, detail panel, modal, picker, archive view, deep link, and responsive layout. A page is not migrated if its sidebar still uses a stale parallel path.

### S01. Application shell, navigation, bootstrap, capabilities

**Current anchors:** `src/components/providers/AppClientProviders.tsx`, `CapabilitiesProvider.tsx`, `AuthorizationProvider.tsx`, `BackgroundPollManager.tsx`, `src/server/app/route-data.ts`, layout components.

**Target:** stable authenticated Convex client; bounded reactive viewer/workspace/permission summaries; independent subscriptions for sidebar domains. Reuse domain query shapes between sidebar and main content.

**Behavior:** route transitions acknowledge immediately; permissions and badges update remotely; no full-app blank state during routine refresh.

**Retire:** database-provider selection/capability branching, duplicate BFF bootstrap reads, database pollers, version-to-HTTP-refetch loops. Keep real entitlements, deployment/runtime capabilities, and local navigation progress.

### S02. Workspace directory, switching, membership, roles, invitations

**Current anchors:** `src/contexts/WorkspaceContext.tsx`, `src/features/workspaces/lib/workspace-client.ts`, `WorkspaceDirectory`, `WorkspaceSettingsPanel`, invitation views; `convex/collaboration/workspaces.ts` and authorization helpers.

**Target:** live workspace directory, scoped membership/role queries, invitation status and app-owned settings mutations. Move/create/share/archive operations enforce scope in Convex.

**Behavior:** remote renames and membership changes appear immediately. Revocation closes access. Workspace switching changes local route/scope immediately without showing old data.

**Keep:** HTTP session/cookie updates where genuinely required for the saved active workspace; WorkOS/external organization actions and invitation delivery orchestration. Do not equate a local route choice with global navigation state.

**Retire:** management snapshots and local reload buses for Convex-owned records, once every tab and settings view has migrated.

### S03. Personal chat list and transcript

**Current anchors:** `useChatConversationLoader.ts`, `chatTransport.ts`, `useLiveConversationSync.ts`, `live-message-patching.ts`; `convex/chat/conversations.ts`.

**Target:** paginated conversation list and messages, reactive metadata/generated-output references, typed send/rename/archive/delete/read operations, canonical transcript from Section 7.

**Behavior:** remote user messages, assistant progress, final output, title changes, and archive state work across clients. Optimistic send and archive recover cleanly from rejection.

**Retire:** HTTP snapshot restoration as owner, assistant-only patching, competing message arrays, five-second fallback polling, chat-title/archive events used as database invalidation.

### S04. DMs, channels, threads, participants

**Current anchors:** `DirectMessageExperience.hooks.ts`, `ConvexRoomMessageSubscription.tsx`, `room-message-view.ts`; `convex/collaboration/directMessages.ts`, `channels.ts`.

**Target:** preserve useful existing subscriptions and nonce reconciliation; make initial loading, older history, thread roots/replies, participant lists, and metadata native too.

**Behavior:** no waiting for HTTP initialization when authorized live messages are available. Thread counts, participant changes, edits/deletes, and archived state converge remotely.

**Retire:** HTTP initial-loader gates, duplicate room state caches, manual reload after every participant/message operation. Preserve moderation/reporting safeguards.

### S05. Conversation lists, Activity, notifications, reactions, pins, saves

**Current anchors:** `CollaborationRealtimeProvider.tsx`, `ChatActivityView.tsx`, collaboration UI helpers.

**Target:** subscribe to typed lists and counters, not a version number that triggers HTTP. Native mutations for read/mark-all, follow/mute, reaction, pin, save.

**Behavior:** read markers synchronize across a user's clients; marking visible activity read does not swallow later arrivals; failures roll back instead of being silently ignored. Include safe destination metadata so clicking a notification need not first fetch its conversation type.

**Retire:** combined `Math.max` list-version invalidation and notification event/refetch plumbing after consumers migrate. Keep system/browser notification delivery as an external boundary.

### S06. Agent directory, profiles, editor, organization view

**Current anchors:** `src/features/agents/lib/agent-directory.ts`, agent editor/bootstrap/runtime hooks; `convex/agents/profiles.ts`, `connectedAgents.ts`; Work organization components.

**Target:** live scoped directory and detail, safe configuration mutations, reactive connected status. Create agent and necessary app-owned defaults transactionally where possible.

**Behavior:** names, avatars, model/configuration changes, archive/restore, and assignment availability synchronize. Autosave uses revision-aware drafts and does not overwrite incoming changes silently.

**Retire:** directory-changed events, imperative reloads, duplicated editor bootstrap records. Keep external account linking, provider tests, and provisioning commands outside ordinary CRUD.

### S07. Agent threads and agent conversation workspace

**Current anchors:** `AppSidebarAgentsPanel.tsx`, `use-agent-thread-scope.ts`, `AgentConversationWorkspace.tsx`; `convex/agents/agentThreads.ts`.

**Target:** reactive per-agent thread summaries, main-thread pointer/resolution, and authorized active-thread detail. Use an idempotent mutation for get-or-create semantics, never a query that writes.

**Behavior:** click opens the shell immediately; existing thread summary supplies destination ID; archive removes a row optimistically; an active archived thread navigates without a fresh list-fetch waterfall.

**Retire:** bundle reloads, client-side list-membership fetch gate, HTTP main-thread resolution on every open, blank pending workspace rendering.

### S08. Run controls, approvals, queue, progress, generated artifacts

**Current anchors:** `useAgentRunLifecycle.ts`, chat run actions; `convex/agents/remoteRuns.ts`, `convex/harness/runs.ts`, artifact domains.

**Target:** live run/queue/approval projections and authorized idempotent commands. Reuse existing durable state machines and recovery infrastructure rather than creating a second job system.

**Behavior:** sender and observers see the same running/waiting/failed/completed state. Approvals submitted twice do not execute twice. Cancellation displays requested until confirmed.

**Retire:** UI run-status polling and local terminal-state guesses. Keep executor callbacks, service authentication, and external streaming transports where needed.

### S09. Files, folders, attachments, Outputs, agent drive

**Current anchors:** web knowledge adapters, shared knowledge surface state, Files sidebar, `KnowledgeViewHost`; `convex/files/files.ts`, artifact publications, agent drive modules. The Outputs route redirects to the Files outputs view.

**Target:** bounded scoped metadata queries for lists/trees/detail, native rename/move/archive/share operations, live publication/ingestion state, content references with explicit revision.

**Behavior:** select and show viewer chrome from known metadata immediately. Fetch large text/binary content independently. Ignore late results for a previously selected file. Remote rename/move/delete updates list, breadcrumb, linked file references, and open viewer coherently.

**Uploads:** reserve/authorize -> transfer bytes -> finalize metadata with idempotency -> subscribe to processing. Keep byte progress local, metadata durable, and incomplete upload cleanup explicit.

**Keep:** signed URLs, downloads, range requests, storage adapters, authorized text-content endpoints where appropriate. Cache content by file ID plus revision, not filename; do not put large content in sidebar queries. Recheck access before issuing URLs and use appropriate short lifetimes.

**Retire:** repository `get` before selection, metadata polling, local file events as cross-client sync, duplicate Files/Outputs/attachment metadata stores.

### S10. Notes and notebook editor

**Current anchors:** `src/features/notebook`, note API-client paths, Files/Notes adapters, existing notes-to-Markdown migration modules.

**Target:** respect the existing canonical Markdown/file representation. Live note list/metadata and revision references, safe create/save/archive/delete commands.

**Behavior:** clean editors reflect remote versions; dirty editors retain drafts and surface conflicts. Autosave is debounced and version-aware. Notebook-agent activity follows normal run subscriptions.

**Retire:** independent note/file sources that represent the same entity and HTTP reload loops. Do not create a second rich-text storage model or promise character-level collaborative editing without a separate CRDT design.

### S11. Memories and knowledge extraction

**Current anchors:** knowledge adapters, Memories view/settings, `convex/knowledge/memories.ts`, memory profile/extractor modules.

**Target:** scoped reactive lists/detail and extraction status; authorized create/edit/delete and profile updates.

**Behavior:** remote edits/deletes and extraction results appear without manual reload. Preserve provenance and scope boundaries; large source content remains separately fetched.

**Retire:** memory mutation events and HTTP-only list ownership. Keep extraction execution and external inference separate.

### S12. Work board, list, timeline, peek, comments, assignment

**Current anchors:** `WorkDataProvider.tsx`, Work sidebar/task hooks; `convex/work/workItems.ts`, `workItemEvents.ts`.

**Target:** native scoped list/detail/context/events; typed mutations for create/update/move/assign/comment/dependencies/archive. Reuse existing rank and permission logic.

**Behavior:** drag/drop, title edits, and assignments remain optimistic; another client's movement/comments arrive live. Ordering conflicts converge to authoritative ranks. Detail links work for items beyond the loaded list.

**Retire:** refresh/load counters, extras used as an authoritative secondary store, stale-response suppression machinery, Work event buses. Keep only state genuinely necessary for drafts/pending interactions.

**Critical policy:** preserve graph validation, assignment authority, execution dispatch, actor attribution, and resource scope. Do not expose server-secret-backed functions unchanged.

### S13. Automations, schedules, workflow progress

**Current anchors:** `src/features/automations`, chat automation panels; `convex/automations/*`.

**Target:** reactive definitions, enabled state, next-run metadata, paginated run history, detail and milestones. Typed create/edit/enable/disable/delete/run-now commands.

**Behavior:** schedule changes synchronize; triggering a run immediately shows pending admission and then actual execution. Concurrent triggers deduplicate where required.

**Retire:** page polling and post-save full reloads. Keep existing durable runner/projector/webhook systems and explicitly reconcile edits/deletion with queued work.

### S14. Skills, tools, MCP servers and grants

**Current anchors:** `SkillsView.tsx`, `McpServersView.tsx`, tools route, MCP access settings; `convex/integrations/skills.ts`, `mcpServers.ts`, `convex/mcp/grants.ts`.

**Target:** live safe configuration/status lists and CRUD/grant metadata. Update tool/model pickers from subscribed results.

**Behavior:** another client's changes appear immediately. Test/connect operations show pending and verified outcomes, not optimistic success.

**Keep:** remote MCP calls, OAuth, credential storage, token issuance/revocation security. Secret values are never returned by ordinary list queries.

**Retire:** HTTP-only settings caches and directory invalidation events, not the external MCP protocol.

### S15. Integrations, connected apps, provider accounts, model connections

**Current anchors:** integration views, provider dialogs/rows/settings, subscription connection hooks; `convex/integrations/workspaceConnectors.ts`, `convex/providers/*`.

**Target:** sanitized connection/configuration/status subscriptions. Native app-owned metadata edits; explicit commands for connect/test/disconnect/refresh.

**Behavior:** connection changes update settings and composer availability remotely. Preserve user/workspace sharing semantics and provider-specific recovery.

**Keep:** external OAuth callbacks, credentials, refresh processes, provider calls, and subscription runtime infrastructure.

**Retire:** repeated GET polling of stored connection status and locally maintained success flags. Do not subscribe to raw secret-bearing records.

### S16. Computers and connected environments

**Current anchors:** `ComputerSettings.tsx`, `AgentEnvironmentSettings.tsx`, agent computer hooks; `convex/computers/computers.ts`, `convex/agents/environmentControlPlane.ts`.

**Target:** live Computer lifecycle, environment enrollment, bindings, capabilities, and permission projections; durable start/stop/provision/destroy/control requests.

**Behavior:** command acknowledgment is immediate; actual provider lifecycle remains authoritative. Sidebar, settings, and agent panel agree without independent polling.

**Keep:** provider provisioning, heartbeat ingestion, terminal/browser/desktop streams, and short-lived access tickets. Never persist or broadcast desktop bearer tickets in ordinary query results.

**Retire:** periodic UI reads of Convex-owned status. Provider health polling may remain server-side when the provider offers no events.

### S17. External surfaces, channel bindings, Extensions

**Current anchors:** agent surface hooks/fields, `convex/surfaces/*`, `/app/x/[...slug]`, extension host/package contracts.

**Target:** reactive safe surface/channel/binding/execution metadata; permission-checked binding mutations. Feed trusted host UI from Convex domain hooks.

**Behavior:** remote bind/unbind and execution status synchronize. Preserve feature flags and extension host navigation.

**Keep:** external channel events and scoped extension/agent APIs. Untrusted iframe code must not receive privileged tokens or arbitrary raw Convex access. Do not rewrite extension protocol contracts as part of a web read-path migration.

### S18. Search, mentions, pickers, cross-resource navigation

**Current anchors:** `convex/search/mentions.ts`, shared composer/model/resource pickers, file-link resolver.

**Target:** debounced authorized query subscriptions for Convex-backed lookup, bounded results, correct workspace/personal filtering. Native search/vector indexes where suitable; retain legitimate external search execution separately.

**Behavior:** results disappear when access is revoked or a record is archived/deleted. A stale search response cannot override a newer term or scope. Search UI never enumerates hidden resources through counts or suggestions.

**Retire:** duplicate lookup snapshots and whole-workspace client-side scans. Preserve ranking behavior and stable IDs.

### S19. Account, onboarding, user preferences, model catalog

**Current anchors:** `AuthContext.tsx`, `AppSettingsProvider.tsx`, model catalog/preference hooks, account/onboarding modules; `convex/auth/users.ts`, `onboarding.ts`, `convex/platform/uiSettings.ts`, `gatewayCatalog.ts`.

**Target:** reactive app-owned profile/preferences/onboarding progress and safe catalog/entitlement projections. Keep device-local preferences local when they really describe the current device.

**Behavior:** account-level choices synchronize without resetting an unsaved form. Catalog and connection availability update model pickers consistently.

**Keep:** sign-in, session refresh, identity-provider profile updates, native OS settings, local dictation polling, and external catalog refresh jobs where appropriate. Not every settings timer is a database poller.

**Retire:** provider capability indirection and HTTP snapshots for persisted preferences. Inventory actual storage before migration: the app-data factory has unsupported settings/onboarding placeholders, so do not assume every declared repository currently stores data.

### S20. Billing, usage, balances, subscription and spend limits

**Current anchors:** workspace billing/usage/auto-top-up panels, subscription settings; `convex/billing/*`, `convex/platform/usage.ts`.

**Target:** authorized live projections of balances, entitlements, limits, subscription state, usage aggregates, and payment processing state. Bounded/time-bucketed usage queries, not a scan of all events on every update.

**Behavior:** verified payment/webhook updates appear across clients. A submitted purchase is pending, never an optimistic credit balance or paid entitlement.

**Keep:** Stripe checkout/portal/payment calls and existing Convex `/stripe/webhook`, ledger and settlement rules, idempotent provider-event processing, payer/ownership checks. Do not create a replacement Next.js Stripe webhook.

**Retire:** billing-status HTTP polling and duplicate UI totals. The goal is a reactive projection, not a billing-engine rewrite.

### S21. Webhooks, API keys, MCP tokens, delivery logs

**Current anchors:** webhook and connected-app settings; `convex/webhooks/*`, `convex/auth/apiKeys.ts`, MCP grants.

**Target:** live safe metadata and paginated delivery history; permissioned create/revoke/rotate/redrive commands.

**Behavior:** revocation and delivery state synchronize. One-time secret display stays one-time, outside reusable query results. Redrive is auditable and idempotent where supported.

**Keep:** signing, outbound delivery, retries, public ingress, and programmatic authentication.

**Retire:** settings reload loops, not the public protocol or delivery runner.

### S22. Imports, ingestion, background jobs, durable activity

**Current anchors:** `SlackImportPanel.tsx`, import panels, ingestion views; `convex/imports/*`, file ingestion, existing outbox/job machinery.

**Target:** subscribed progress/error/result projections and explicit start/cancel/retry commands. Use existing durable runners.

**Behavior:** progress follows a job across tabs and refreshes; an expired OAuth popup or network failure does not appear as completed import.

**Retire:** three-second stored-job polling and popup polling where a durable callback/status record replaces it. Keep provider polling where required and local popup-close detection where it is genuinely browser state.

### S23. Unified archive, scope moves, sharing, deletion

**Current anchors:** archived settings/actions/items, `use-scope-item-actions.ts`, shared scope helpers; `convex/lib/scopeMutations.ts`, resource scope/sharing modules.

**Target:** typed archived queries per resource or a bounded unified projection, authorized move/share/archive/restore commands, consistent optimistic rules across every originating surface.

**Behavior:** archive list, source list, details, and badges agree; restore returns to the appropriate authorized scope. Permanent delete remains confirmed. Access revocation invalidates views and content issuance.

**Retire:** per-resource archive reload code and generic browser events used to repair stale state. Preserve each domain's retention and cascade rules.

### S24. Public, native, agent, and operator consumers

**Current anchors:** `packages/overlay-api-client`, `src/server/app-api`, native/agent packages, public API routes, `apps/admin`.

**Target:** keep required external contracts, backed by the same Convex domain operations. Native clients may migrate independently; their existing compatibility cannot be removed just because the web no longer needs HTTP CRUD.

**Behavior:** a write through REST, an agent, a webhook, or a background worker appears in the browser through its normal subscription. No extra web invalidation event is required.

**Retire:** internal-only routes and database repositories after their last consumer is migrated. Keep versioned external API boundaries and strict operator separation. Public/marketing/static routes need no artificial realtime conversion.

## 9. What to delete, reshape, and keep

| Existing layer | Disposition | Exit condition |
|---|---|---|
| `src/server/app-data/capabilities.ts` database-provider selection | Remove database portability branches/types | All callers use the explicit Convex architecture; retain unrelated runtime/product permissions. |
| `AppDataContext` / `AppDataRepositories` registry | Retire incrementally | Callers migrated domain by domain; no giant simultaneous constructor rewrite. |
| `*Repository` interfaces plus `Convex*Repository` wrappers | Delete pass-through persistence abstraction; retain or rename only genuinely useful server/domain clients | Browser and remaining server callers invoke canonical Convex operations; no duplicate policy implementation. |
| `unsupportedRepository` database placeholders | Remove when no consumer needs them | Real storage/feature semantics inventoried; absence is not mistaken for implemented capability. |
| `overlayAppClient` in ordinary web feature data paths | Replace with Convex hooks | Each call classified and migrated; legitimate command/content endpoints are explicit exceptions. |
| `@overlay/api-client` package | Keep for real HTTP consumers | Its continued existence does not force the web to use it for application data. |
| Next.js internal CRUD proxies | Delete selectively | Actual consumer inventory and contract checks prove retirement is safe. |
| Next.js `route-data` HTTP bootstrap | Replace/simplify | Reactive client queries or targeted preloads own the surface. |
| Local title/file/agent/Work invalidation events | Delete server-data synchronization use | All interested UI derives from subscriptions. Keep local focus/dialog/toast events. |
| Conversation-list version queries | Replace with direct list subscriptions | No list consumer uses version-to-refetch. Preserve versions still needed for a real external protocol. |
| Polling fallback managers | Remove stored-state UI polling | Reconnect/auth behavior and all consumers verified; provider heartbeats/status acquisition remain valid. |
| Shared UI/module packages | Keep presentation boundaries; reshape data-owning controllers | Widgets take reactive data/callbacks without importing web-private backend dependencies. |
| Contract/boundary tests | Reframe, not blanket-delete | Domain/authorization/external compatibility coverage survives; obsolete provider portability assertions are removed. |

Do not replace the old layer with `ConvexRepository`, a generic `DataService`, or a uniform query/mutation wrapper that hides native pagination, optimistic updates, or generated types. Small explicit domain helpers are useful; another lowest-common-denominator API is not.

## 10. Delivery sequence and dependency gates

The sequence is deliberately vertical. Each domain phase includes backend access, all UI entry points, optimistic behavior, tests, and cleanup. It is not “convert reads everywhere, then fix writes later.”

### Phase 0. Baseline, consumer ledger, and policy map

**Deliverables:**

- A per-operation ledger: surface, current read/write path, state owner, auth/policy checks, external consumers, target function, optimistic behavior, retirement condition.
- Controlled reproduction of the reported chat/archive/navigation/file symptoms in two independent authenticated contexts.
- Timing instrumentation separating click-to-feedback, data-ready, mutation completion, and remote convergence.
- Auth-mode and deployment compatibility matrix.
- Confirm which existing domain helpers can be reused and which BFF policies must move.

**Gate:** each pilot operation has an explicit authorization, billing/admission, idempotency, and audit mapping. No endpoint deletion based only on a source grep.

### Phase 1. Native identity and data-access foundation

**Deliverables:** native auth path; canonical viewer/resource authorization helpers; error taxonomy; stable scoped client/query conventions; additive indexes/functions; SSR/client loading rules; optimistic operation conventions.

**Scope limit:** establish the pattern through the pilot's real needs. Do not spend a phase creating generic infrastructure for every domain.

**Gate:** browser queries/mutations and server preloads are authorized correctly; logout/revocation/refresh/account switching pass; no server secret reaches the browser.

### Phase 2. Personal chat pilot, end to end

**Deliverables:** conversation list, transcript pagination, send and streamed reconciliation, rename/archive/restore/Undo, read state, run status, outputs metadata, navigation, all related sidebar paths.

**Gate:** acceptance E01-E10 below plus policy isolation. Delete the personal-chat HTTP ownership, partial patch path, and polling fallback for the migrated flow.

This phase should produce the first unmistakable product improvement, not just a technically direct data call.

### Phase 3. Agent threads, rooms, Activity, agent directory

**Deliverables:** S04-S08 plus profile/directory portions of S06 and shared list/notification infrastructure. Preserve existing remote-run state machines.

**Gate:** two-client personal/agent/DM/channel flows all pass; main-thread creation is idempotent; archive and thread opening have no list-resolution waterfall; participant changes revoke access correctly.

### Phase 4. Files, Notes, Memories, attachments and outputs

**Deliverables:** S09-S11; shared UI ownership change; upload/content-version pipeline; revision-aware editor drafts; consistent archive/share/move behavior.

**Gate:** immediate viewer opening; cross-client metadata updates; content refresh by revision; concurrent editing does not lose drafts; revoked access cannot obtain new content URLs; all Files/Notes compatibility tests preserved.

### Phase 5. Work, automations, tools and skills

**Deliverables:** S12-S14, reactive sidebar/organization views, automation run history, assignment/run integration.

**Gate:** remote board moves and comments synchronize; optimistic rank rollback preserves other changes; automation edits/triggers and skill changes converge without reload.

### Phase 6. Workspace/account/settings and external-status surfaces

**Deliverables:** remaining S02/S15-S22, Computers/environments, providers, billing projections, integrations, onboarding, imports, webhooks, API-key metadata, search/pickers.

The minimal workspace/permission queries already exist from Phase 1; this phase completes management and settings, not basic isolation.

**Gate:** status reads are reactive, secrets remain private, external work reports real progress, all non-migrated consumers retain compatibility. Financial and authorization tests receive separate focused review.

### Phase 7. Retirement and architectural enforcement

**Deliverables:** complete S23/S24 coverage; remove the central registry, unused database interfaces, obsolete events/pollers and internal-only routes; update architecture docs and boundary checks.

**Gate:** the ledger has no unclassified web data paths, no unowned snapshots, and no unexplained HTTP exception. All retained HTTP routes have a named consumer or runtime reason.

### Parallelism and PR sizing

After the auth/query conventions and chat pilot are proven, Files and Work can be developed independently against those conventions. Keep shared provider/auth/shell edits serialized to avoid conflicting ownership changes.

Split large phases into reviewable PRs, but cut them along complete behaviors. For example: agent list/thread archive can ship before the full editor; file metadata/viewer can ship before conflict-aware note editing. Do not leave two owners active for the same behavior.

## 11. Rollout, compatibility, and schema safety

1. Prefer additive functions/indexes/schema fields. Reuse current records and IDs.
2. Backfill only what is actually required: indexes need query validation, new denormalized fields need bounded resumable jobs and invariants. New writes maintain old-compatible fields during transition.
3. Use short-lived per-surface rollout flags, not database-provider flags. The old and new paths are mutually exclusive for a viewer, not concurrent dual writers.
4. During controlled comparison, shadow reads may compare sanitized projections; they must not drive UI or trigger duplicate mutations.
5. Keep old external/server callers functioning while new browser callers roll out. API compatibility and database portability are different concerns.
6. Roll back the surface flag if necessary. Do not silently fall back to privileged HTTP on auth failure. Do not undo valid user records to roll back presentation.
7. Retire legacy functions only after replacement callers are live and external/native version compatibility is established. Delete stale code promptly after the bounded rollback window.

### Repository release safeguards

Use isolated current-head PR previews and their explicitly scoped Convex backend. Do not deploy shared development or customer production from feature worktrees.

The repository requires matching production web to be live before customer Convex deployment from clean canonical main. Therefore, stage additive changes compatibly: deploy web code with the new path disabled, deploy its matching additive backend, verify readiness, then enable the cohort. New function names must not be invoked before that backend exists. An activation flag/function-version gate is temporary rollout machinery, not a resurrected database capability layer.

Destructive cleanup follows only after the replacement path is live and safe to roll back within its declared compatibility window. Use the existing main PR and release workflow; this planning task authorizes no merge or deployment.

## 12. Acceptance suite

Use two independent browser contexts as well as two tabs. Include the same user, different authorized users, and an unauthorized user. Test data belongs to isolated preview/development backends, never customer production.

| ID | Scenario | Required result |
|---|---|---|
| E01 | Send a new personal-chat turn in client A | B displays the user message and subsequent assistant output without refresh or a locally existing turn. |
| E02 | Repeat in agent thread, DM, channel, and reply thread | Correct audience and thread placement; no duplicates or unauthorized visibility. |
| E03 | Reload/close sender during an accepted run | Execution and observer progress continue; restored transcript converges to the same final result. |
| E04 | Archive open and closed threads | Local row/selection responds immediately; B's list/detail follows committed state. |
| E05 | Reject archive; invoke Undo before response; apply conflicting remote edit | Correct rollback/ordering; no stale snapshot overwrites, resurrection, or surprising navigation. |
| E06 | Navigate to cached, uncached, unauthorized, missing, and archived thread | Immediate destination feedback; correct loading/forbidden/missing state; no redundant membership-list waterfall. |
| E07 | Load older history while new messages arrive | No gaps/duplicates; edited/deleted historical rows update; scroll anchor remains stable. |
| E08 | Retry a send; reconnect mid-stream; receive out-of-order chunks | One persisted message/run per logical operation; monotonic rendering; one terminal result. |
| E09 | Token expires; session refreshes; temporary disconnection; tab resumes | Subscriptions recover without manual refresh, draft loss, or parallel HTTP polling. |
| E10 | Mark read in A while B receives new messages | Cursor never regresses; unseen future messages are not accidentally marked read. |
| E11 | Open large file on slow network | Viewer shell opens before full content arrives; loading/error states remain useful. |
| E12 | Select file A then B before A loads | A's late response cannot replace B; content cache is revision-scoped. |
| E13 | Rename/move/delete/share file remotely | Tree/list/breadcrumb/detail converge; access revocation prevents new content issuance. |
| E14 | Two editors modify same note/configuration | No silent overwrite; dirty draft retained; conflict resolution is explicit. |
| E15 | Concurrent task moves/assignment/comments | Board/list/sidebar/detail converge; failed optimistic move preserves subsequent valid changes. |
| E16 | Trigger automation, provision Computer, connect provider, import data | Pending feedback is immediate; lifecycle follows actual durable progress; duplicate command does not duplicate work. |
| E17 | Billing webhook updates subscription/usage projection | Authorized clients react; no optimistic financial success; duplicate webhook cannot double-credit. |
| E18 | Revoke membership/role while subscribed; switch workspace/account | Data access is removed; no previous-scope flash, stale query leak, or draft crossover. |
| E19 | Guess another user's/workspace's IDs and call functions directly | Server rejects consistently; no metadata/count/secret leakage; UI hiding is not the protection. |
| E20 | Perform write through REST, agent, webhook, worker, or supported native client | Web updates via its existing subscription; retained API behavior is compatible. |
| E21 | Unmount/remount/navigate repeatedly; open several tabs | Subscription counts and bandwidth remain bounded; no listener/poller leaks. |
| E22 | Logout, disabled user, expired share link, revoked token | Sensitive UI clears appropriately; reconnect does not restore unauthorized access. |

### Test layers

- Pure unit tests for canonical message reconciliation, optimistic operations, draft revisions, ranking, and read cursors.
- Convex tests for authorized queries/mutations, transactions, nonce deduplication, pagination, revocation dependencies, and cross-scope denial.
- Retained API contract tests proving external paths invoke the same business policy.
- Browser tests for actual rendered responsiveness and multi-client behavior. Two independent clients are essential; a single-tab optimistic test cannot prove realtime synchronization.
- Failure injection: rejected mutation, delayed response, dropped stream, expired token, retry, duplicate webhook, provider timeout, and route change mid-request.
- Performance checks for large histories, broad workspaces, many sidebar items, and multiple active clients.

### Existing checks to preserve or deliberately evolve

Run focused domain tests first. Use the repository's `npm run typecheck` and `npm run lint` after implementation, with targeted ESLint when documented unrelated full-lint failures apply. `typecheck` already includes chat transcript, file parity, and knowledge surface checks; avoid needlessly duplicating those runs.

Also retain applicable `check:module-boundaries`, `check:shared-isomorphic`, `check:domain-service-boundaries`, `check:tenant-boundaries`, `check:admin-separation`, and `check:on-prem-convex-boundaries` coverage. Update tests that enforce obsolete portability assumptions without weakening their underlying security/domain assertions.

The existing Convex integration scripts include app-data, room, knowledge, workspace/billing, skills/MCP, and connected-agent suites. Some load environment files and contact a configured deployment. Inspect and point them only at the explicitly authorized isolated backend before running. Port useful characterization assertions into native-function tests before retiring repository-level tests.

No implementation test results are claimed by this document.

## 13. Performance and observability

These are proposed acceptance budgets to validate against a controlled baseline, not measurements of the current application or guarantees under arbitrary network conditions.

| Measurement | Initial target |
|---|---|
| Click to visible feedback for archive/select/open | Within 100 ms at p95 on the agreed test device/profile, independent of server completion. |
| Warm navigation to already available authorized content | No intentional network gate before rendering it. |
| Commit to visible change in another connected client | Within 1 second at p95 in the controlled two-client test; record geography/network profile. |
| Accepted message reconciliation | Zero duplicated logical messages or lost committed messages. |
| Failed optimistic operation | No silent failure; correction and feedback when rejection is known. |
| Query/payload/subscription cost | Bounded by visible data and active operations, not total workspace history. |

Instrument separately:

- Interaction start, local feedback, query-ready, mutation-acknowledged, remote rendered.
- Active subscription count, reconnects/auth refresh failures, query executions, payload sizes.
- Run checkpoint lag, duplicate nonce/chunk reconciliation, pending-intent lifetime.
- External command admission, execution, retries, and final result.

Use correlation IDs and versions, not message bodies, file content, tokens, or secret-bearing arguments. Measure cross-client latency with coordinated tests or account for clock skew; naive subtraction of unsynchronized browser clocks is not reliable.

Watch costs as well as speed: avoid per-token full-message writes, unread scans, huge always-live collections, and subscription-per-row designs. Slow external execution should not be disguised as a slow click response.

## 14. Biggest risks and their controls

| Risk | Control |
|---|---|
| BFF-only security/billing checks disappear | Per-operation policy ledger; native authorization tests before browser cutover; canonical shared domain enforcement. |
| “Convex-native” becomes another abstraction layer | Generated typed functions and domain hooks; prohibit generic provider/repository interfaces in the web path. |
| Two transcript owners remain | Canonical projection and explicit stream overlay; delete old history ownership in the pilot. |
| Optimism corrupts concurrent state | Layered optimistic cache updates; scoped operation IDs; revision checks; no whole-state snapshot rollback. |
| Shared UI package rules are broken | Web host owns data; shared widgets remain presentational; refactor controller contracts explicitly. |
| Realtime becomes expensive | Indexed bounded queries, pagination, narrow projections, chunked streaming, cost measurements. |
| Native/mobile/SDK consumers break | Consumer inventory, contract compatibility, separate retirement gate. |
| Auth migration invalidates identity or leaks tokens | Existing subject mapping, native JWT proof in preview, strict safe projections, logout/revocation tests. |
| Deployment order invokes missing functions | Additive disabled web path, matching backend rollout, readiness gate, delayed cleanup. |
| Entire project stalls on peripheral runtime rewrites | Keep existing executors/storage/providers; migrate their app-owned status before reconsidering infrastructure. |

## 15. Definition of done

The migration is complete only when:

1. Every interactive web surface has a documented authoritative source and no unclassified data path.
2. Convex-backed application records are rendered from subscriptions, including first load, pagination, sidebar/detail views, and reconnect.
3. Reversible high-frequency interactions have consistent optimistic behavior and correct failure/Undo handling.
4. Thread/file navigation responds before content network work completes.
5. New messages, edits, archives, membership changes, work updates, files, and relevant settings synchronize across authorized clients.
6. Native browser identity and backend authorization replace reliance on BFF-only checks.
7. Provider-selection scaffolding, pass-through persistence repositories, obsolete HTTP ownership, and data-invalidation buses are gone from migrated paths.
8. Remaining HTTP endpoints have a specific external-consumer, content-transfer, session, or execution justification.
9. Shared presentation, server-only execution, public contracts, storage/runtime adapters, and admin separation remain disciplined.
10. Acceptance, performance, cost, rollout, and compatibility gates pass, and temporary cutover flags/dual paths are retired.

**The architectural test:** adding a new persisted interactive feature should naturally start with an authorized Convex query/mutation and a focused React hook. It should not require inventing a repository interface, an HTTP endpoint, an API-client method, a refresh event, and a polling loop before the UI can stay current.

## 16. Reference material

Official documentation reviewed for this plan:

- [Convex Next.js server rendering](https://docs.convex.dev/client/nextjs/app-router/server-rendering): preload/reactive hydration, server helpers, authentication, snapshot consistency, beta status.
- [Convex optimistic updates](https://docs.convex.dev/client/react/optimistic-updates): temporary local updates, rerunning, reconciliation and rollback.
- [Convex custom auth integration](https://docs.convex.dev/auth/advanced/custom-auth): native provider integration and forced token refresh.
- [Convex with WorkOS AuthKit](https://docs.convex.dev/auth/authkit/): platform JWT verification and identity integration.
- [Convex best practices](https://docs.convex.dev/understanding/best-practices): bounded queries, indexes, validators, access control, and function organization.

Repository guidance to follow during implementation: `AGENTS.md`, `internal/develop/convex-workflow.md`, `internal/develop/agentic-development.md`, `internal/develop/admin-console.md`, and `internal/develop/convex-native-chat.md`.
