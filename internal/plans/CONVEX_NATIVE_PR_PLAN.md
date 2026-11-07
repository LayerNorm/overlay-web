# Overlay Convex-native migration: phased PR execution plan

Status: in progress as of 2026-11-06. CN-01 to CN-06 and CN-03P are merged to main; this does not by itself establish production activation or pilot acceptance. The personal-chat pilot is being stabilized and its old path contracted before any other domain continues. The other cards have no open PR. Merges and deployments follow the repository's release rules, not this document. The PR that lands the last phase deletes this plan.

| Card | PR | State on 2026-11-06 |
|---|---|---|
| CN-01 | #392 | Merged |
| CN-02 | #393 | Merged |
| CN-03 | #394 | Merged |
| CN-04 | #396 | Merged |
| CN-03P | #397 | Merged |
| CN-05, CN-06 | #408 | Merged |
| CN-07 to CN-11 | #403 | Closed unmerged, branch kept as reference |
| CN-12 | #402 | Closed unmerged, branch kept as reference |
| CN-20 | #398 | Closed unmerged, branch kept as reference |
| CN-21 | #401 | Closed unmerged, branch kept as reference |
| CN-25 | #400 | Closed unmerged, branch kept as reference |

Closed branches are source material, not accepted work. Reuse their Convex authorization code and tests only after reviewing them against current main.

This is the execution companion to the [Convex-native migration architecture plan](./CONVEX_NATIVE_MIGRATION_PLAN.md). It turns that plan's broad phases into **37 focused PR-sized change sets**, each with an explicit outcome, scope, dependencies, acceptance gate, and retirement work.

The numbering is a stable planning identifier, not a GitHub PR number. Dependencies define order; unrelated branches can proceed in parallel after the pilot. The count is a planning estimate, not a requirement to force oversized work into exactly 37 pull requests. Split an oversized card into suffixed parts, for example `CN-14a` and `CN-14b`, preserving its acceptance contract. Do not merge unrelated cards merely to reduce the number.

Repository basis: the same inspected `LayerNorm/overlay-web` revision as the architecture plan, `ff51317d57c07bc22aa1a457a523aeb8a2ea51fd`. Rebase and recheck affected paths against current main before implementation. Paths below are repository-relative; proposed function shapes are design intentions, not existing APIs.

## 1. Rules for every PR

### One outcome, not one architectural layer

A normal domain PR should include the authorized Convex operation, the web hooks, every UI entry point for that operation, optimistic/reconciliation behavior, focused tests, and deletion of the replaced web path.

Avoid separate project-wide PRs for “all queries,” “all mutations,” and “all UI changes.” They create long-lived incomplete features. The explicitly foundational and final retirement PRs are exceptions because they establish or remove shared infrastructure.

### Mergeable independently, releasable safely

- Each PR leaves main working. Its new path may be behind a short-lived rollout flag until the matching backend is ready.
- Use additive backend changes first. Preserve required old callers during the compatibility window.
- The new and old paths are mutually exclusive for a surface. Never run competing transcript owners or duplicate writers.
- A feature flag is rollout machinery, not a database-provider abstraction.
- Include rollback instructions. A UI rollback must not undo valid user data.
- Respect the existing release order: compatible web first with the path disabled, matching customer Convex deployment from clean canonical main, readiness verification, then activation.
- Validate on the isolated current-head PR Preview and its own Convex backend. No customer production testing or feature-worktree production deployment.

### Security travels with the operation

Every migrated operation must preserve actor identity, workspace/resource authorization, billing/admission rules where applicable, validation, idempotency, audit attribution, and secret handling. CN-03 supplies reusable primitives, not blanket approval that every domain is safe.

Existing server-secret functions are not browser APIs. Browser identity is derived from verified native auth. Retained external APIs use appropriately authenticated wrappers around canonical domain logic.

### Cleanup is part of the same change

Delete superseded **web callers and local ownership** in the domain PR. Retain an endpoint or repository temporarily only when it still has a named consumer or a bounded rollback requirement. Record that reason and the eventual retirement card.

Do not leave all cleanup to the final three PRs. Those remove shared remnants that cannot disappear until the last domain has migrated.

### Every domain finishes by contracting

These rules take precedence over any earlier scheduling or compatibility text in this plan, including its compatibility windows, rollout flags and readiness gates:

- The product has effectively no users, and Convex is the only supported backend for cloud and self-hosted deployments. Optimize for performance and reduced complexity, not backward compatibility.
- A surface's change replaces its old path in the same PR. Do not add flags, readiness gates, rollback windows or fallbacks for setups nobody runs. A regression that can be fixed forward is acceptable; a security, tenant-isolation or billing failure is not.
- Do not start the next surface until the old path is deleted, unless it has a named blocker.
- Every retained old path names a current consumer and the card that removes it. "Rollback" is not a reason.
- A finished domain should remove more production code than it added. Tests and domain authorization moved out of Next.js may be larger than what they replace; report production, test and docs lines separately, and explain any finished domain that stays net-positive in production code.
- Work on one surface at a time, with one implementer. Do not run parallel domain branches or combine several cards in one PR.
- Green CI is not acceptance. A surface is accepted only after current-head testing with two independent clients, its failure paths, and the permission cases its card names.

### Every implementation PR must provide

1. A short statement of the exact behavior improved.
2. A scoped diff and named non-goals.
3. Focused unit/Convex tests, targeted lint, applicable boundary checks, and repository typechecking. Avoid repeating subchecks already included by `typecheck` unnecessarily.
4. For interactive slices, current-head browser evidence, including two independent clients for shared-state changes and at least the relevant failure path.
5. Policy mapping and safe projections for newly browser-accessible functions.
6. A consumer/retirement ledger update and rollout/rollback notes.

The architecture plan's acceptance IDs `E01` through `E22` are reused below. No tests or measurements have been run as part of this planning document.

## 2. Phases and milestones

| Phase | PRs | Milestone |
|---|---|---|
| A. Foundation | CN-01 to CN-03 | We can measure the problem and access Convex natively without weakening policy. |
| B. Personal chat pilot | CN-04 to CN-06 | Personal chat list, history, send, streaming, archive, and recovery use one coherent state model. |
| C. Agents and collaboration | CN-07 to CN-11 | Agent threads, DMs, channels, collaborative metadata, and Activity synchronize across clients. |
| D. Files and knowledge | CN-12 to CN-15 | Files open immediately; metadata, outputs, Notes, and Memories stay current. |
| E. Work and automation | CN-16 to CN-20 | Work, scheduling, run history, and skills follow the native pattern. |
| F. Control plane and settings | CN-21 to CN-31 | Integrations, Computers, workspace management, billing projections, and background progress are reactive. |
| G. Cross-surface completion | CN-32 to CN-34 | Search, archives, and shell no longer bridge competing data paths. |
| H. Retirement and enforcement | CN-35 to CN-37 | Legacy browser auth and database portability are removed; regressions are structurally discouraged. |

**First approval/execution batch:** CN-01 through CN-06. Prove the pattern and the visible chat improvement before launching a broad parallel migration.

## 3. Phase A: establish a safe foundation

### CN-01. Add reproducible realtime and interaction baselines

**Outcome:** separate missing synchronization from click-response latency with repeatable evidence.

**Scope:** add reusable two-client test setup and narrowly scoped interaction instrumentation for send, archive, thread open, and file open. Produce an operation/consumer ledger and map the existing auth modes. Capture baseline behavior without fixing it.

**Anchors:** chat/agent/file interaction entry points identified in the architecture plan; existing QA tooling and architecture documentation.

**Depends on:** nothing.

**Acceptance:** the same scenario can be reproduced in two independent authenticated contexts; timing distinguishes local feedback, server completion, and remote rendering. No message bodies, content, or credentials enter telemetry. Existing defects are documented as baseline findings, not hidden by weakening assertions; regressions are added with their fixing PRs.

**Retirement/non-goals:** none yet. No new cache, auth migration, production analytics rollout, or UI redesign. Commit useful harness/instrumentation and documentation, not incidental recordings or generated logs.

### CN-02. Establish native Convex browser authentication

**Outcome:** new browser-direct functions can use verified native identity instead of an application token passed as a query argument.

**Scope:** add the native provider/token-refresh integration; prove current WorkOS identity mapping and supported alternative auth modes; implement loading/refresh/logout lifecycle. Validate authenticated server preload with a small real viewer query.

**Anchors:** `src/components/providers/ConvexAuthProvider.tsx`, token broker, session/token routes, `convex/auth.config.ts`, `convex/lib/auth.ts`.

**Depends on:** CN-01's auth-mode inventory.

**Acceptance:** login, forced refresh, expiration, sign-out, account switch, preview login, and native session handoff preserve identity and clear sensitive state correctly (`E09`, `E22`). No server signing secret is sent to the browser. The existing HS256 token is not passed unchanged to native auth.

**Retirement/non-goals:** legacy argument-token consumers remain explicitly supported until migrated. Do not delete their endpoint, change identity provider, or change application user IDs. Remove the temporary dual auth plumbing in CN-35.

### CN-03. Add native viewer and resource-authorization primitives

**Outcome:** browser-direct operations have a consistent, scope-safe entry point and can start without BFF-only authorization.

**Scope:** implement canonical viewer identity, requested workspace resolution, membership/resource access helpers, safe viewer/workspace projections, and structured errors. Move the pilot's necessary policy predicates into appropriate shared/Convex domain modules. Establish bounded query and optimistic-update conventions through real pilot needs.

**Anchors:** `convex/lib/resourceScope.ts`, workspace membership/auth helpers, authorization modules, web workspace/provider wiring.

**Depends on:** CN-02.

**Acceptance:** direct calls with another user's/workspace's IDs fail; membership revocation affects live queries; scope switching never flashes old data (`E18`, `E19`). New operations cannot accept a self-asserted browser actor or server secret.

**Retirement/non-goals:** replace only the viewer/scope bootstrap it actually owns. Do not build a generic database SDK or rewrite all workspace management. Each later card must migrate its own domain policy explicitly.

## 4. Phase B: complete personal chat first

### CN-03P. Preserve deployment-feature policy in native domain functions

**Outcome:** files, skills, MCP, external-agent eligibility and workspace-handle operations retain the deployment restrictions currently resolved by Next.js, without proxying ordinary application reads through Next.

**Scope:** master-owned, backend-bound Convex policy projection sourced from the actual resolved server configuration; authenticated server-only configuration transport; internal refresh/publication and reactive expiry; stale-callback fencing; shared capability-to-feature map; browser-safe availability without configuration secrets or rollout allowlists. A one-minute configuration heartbeat renews a three-minute lease. Missing, failed or expired policy fails closed. This is not browser data polling. Keep privileged Computer/credential cleanup in server orchestration.

**Depends on:** CN-02/CN-03 interfaces. Implement in a separate foundation branch based on the current CN-04 stack, without expanding personal-chat CRUD scope.

**Acceptance:** direct browser calls cannot supply or publish policy; revoked flags, expired leases, wrong backend/source and replayed callbacks cannot grant access; current workspace rollout is enforced; direct/group role checks remain required. Private configuration layering is preserved. Current-head isolated Preview validates the protected callback and subscription expiry. No production deployment or deployment-source-policy change.

**Integration:** required by CN-07, CN-12, CN-20, CN-21 and CN-25 handle writes before their final validation. Children may implement against the fixed helper contract concurrently, then merge the reviewed foundation revision. Their focused domain PRs should target `devin/cn-native-deployment-policy` once that branch is published, rather than duplicating the prerequisite in every diff against CN-04. The prerequisite itself targets the CN-04 branch. This is a parallel dependency branch, not a reason to serialize CN-05/CN-06 behind unrelated domain migrations. Account preferences remain CN-27. CN-04 conversation CRUD has no mapped deployment-feature gate and can continue independently.

### CN-04. Make personal conversation lists and archive/rename native

**Outcome:** the chat sidebar/list stays current and archive/rename respond immediately.

**Scope:** authorized paginated summary queries; title, archive/restore, and basic unread summary updates; optimistic updates across active/archive/detail metadata; deterministic post-archive selection and ordered Undo. Include the personal-chat archive subsection so there is not a stale second entry point.

**Anchors:** chat list/sidebar consumers, archive actions, `convex/chat/conversations.ts`, list-version consumers.

**Depends on:** CN-03.

**Acceptance:** two clients see rename/archive; local feedback precedes the round trip; rejection and early Undo behave correctly; archived state does not resurrect deleted records (`E04`, `E05`).

**Retirement/non-goals:** remove personal list HTTP ownership and corresponding title/archive/version-to-refetch events. Preserve any still-used external endpoints. Does not yet replace transcript ownership.

### CN-05. Make personal chat history and message submission canonical

**Outcome:** a new user message appears in every authorized client, including clients without a locally originating turn.

**Scope:** native paginated transcript and metadata; one canonical render projection; optimistic sends with stable nonce reconciliation; authorized idempotent persistence/admission; deep-link history loading and scroll preservation. Adapt the existing streaming transport to this projection rather than retaining its separate authoritative history.

**Anchors:** `useChatConversationLoader.ts`, `chatTransport.ts`, `useLiveConversationSync.ts`, `live-message-patching.ts`, personal chat runtime adapters, `convex/chat/conversations.ts`.

**Depends on:** CN-04.

**Acceptance:** remote user messages and persisted replies appear; retried sends produce one logical message; pagination has no gaps/duplicates; required modes, variants, attachments, and tool parts survive (`E01`, `E07`, persisted portion of `E08`). Existing direct streaming must continue to function during this PR.

**Retirement/non-goals:** remove HTTP snapshot history ownership and assistant-only patching for this flow. Do not rewrite the agent executor. CN-06 completes observer streaming/recovery, not the basic canonical transcript.

### CN-06. Reconcile live output and run lifecycle across clients

**Outcome:** sender, observer, reload, and reconnect all converge on one run and final transcript.

**Scope:** stable message/run/part IDs and sequences; bounded durable progress checkpoints; optional low-latency local overlay; final-result reconciliation; live run/queue status, stop/approval/input commands as required by personal chat. Preserve credit admission and durable execution semantics.

**Anchors:** active-stream/runtime adapters, `useAgentRunLifecycle.ts`, Convex chat/run domains, executor persistence boundaries.

**Depends on:** CN-05.

**Acceptance:** reload or close the sender after acceptance; observe from another context; drop/reconnect the stream; deliver repeated/out-of-order updates; cancel/fail a run (`E03`, `E08`, `E09`). No duplicate output, lost committed content, or per-character rendering regression. Measure checkpoint bandwidth and observer lag.

**Retirement/non-goals:** remove personal-chat run polling and competing terminal-state ownership. Keep appropriate execution/stream transports. No wholesale runtime rewrite.

**Pilot release gate:** CN-04 through CN-06 jointly pass the personal-chat acceptance suite, including basic read/unread behavior. Do not claim the pilot complete after only migrating the list or demonstrating one optimistic send.

## 5. Phase C: agents and collaboration

### CN-07. Subscribe the agent directory and profile editor

**Outcome:** agent identity/configuration changes appear everywhere without directory refresh events.

**Scope:** native scoped directory/detail, create/update/archive/restore, editor bootstrap, revision-aware autosave, and organization/picker consumers of agent summaries.

**Anchors:** agent-directory helpers, agent editor hooks, `convex/agents/profiles.ts`, safe connected-agent projections.

**Depends on:** CN-02/CN-03 interfaces for implementation. CN-06 remains the proven-pattern acceptance gate before integration/release; CN-07 can be authored in parallel now.

**Acceptance:** create/rename/archive in A updates B's directory/editor; dirty edits survive remote changes; default-agent/avatar semantics and access controls remain intact.

**Retirement/non-goals:** remove directory reload events and duplicate profile snapshots. Do not migrate Computer provisioning or provider account linking here.

### CN-08. Make room history, threads, and send native

**Outcome:** DMs/channels and their reply threads load and synchronize without an HTTP initialization gate.

**Scope:** native initial and paginated room history, thread-root/anchor access, send/edit/delete, participant read projections, canonical reconciliation adapted from existing room behavior. Preserve invocation/moderation policy.

**Anchors:** `DirectMessageExperience.hooks.ts`, `ConvexRoomMessageSubscription.tsx`, `room-message-view.ts`, `convex/collaboration/directMessages.ts` and `channels.ts`.

**Depends on:** CN-06.

**Acceptance:** same-user and different-member clients see main/reply messages, edits/deletes, and live runs; authorized data can render without waiting on redundant HTTP initialization (`E02`, `E07`, `E08`, `E19`).

**Retirement/non-goals:** remove room HTTP transcript ownership and loading gates. Participant administration and collaborative metadata are CN-10; preserve their current behavior until then.

### CN-09. Make agent thread navigation and archive immediate

**Outcome:** opening or archiving an agent thread no longer waits for a bundle/refetch/membership-list waterfall.

**Scope:** reactive agent-thread lists and main-thread pointer, authorized active-thread query, idempotent create/resolve semantics, native archive/restore/delete commands with correct selection behavior.

**Anchors:** `AppSidebarAgentsPanel.tsx`, `use-agent-thread-scope.ts`, `AgentConversationWorkspace.tsx`, `convex/agents/agentThreads.ts`.

**Depends on:** CN-07 and CN-08.

**Acceptance:** warm and cold thread opens show immediate destination feedback; unauthorized deep links remain blocked; concurrent main-thread creation deduplicates; archive/Undo passes in two clients (`E04` to `E06`).

**Retirement/non-goals:** delete bundle reloads, redundant client membership-list checks, HTTP main-thread resolution on every open, and blank pending content gates. Do not remove backend thread authorization.

### CN-10. Make collaborative room metadata and actions native

**Outcome:** participants, room settings, reactions, pins, saves, follow/mute, and presence reflect the same state across clients.

**Scope:** bounded metadata/presence subscriptions and corresponding permissioned mutations; optimistic reversible actions; explicit expiry handling for ephemeral presence. Include room archive/restore and its archived entry point.

**Anchors:** room action hooks and panels, collaboration Convex modules, presence UI.

**Depends on:** CN-08.

**Acceptance:** participant removal revokes access; concurrent reactions/pins converge; rejected operations roll back without clobbering later changes; stale presence expires; room archive/Undo is consistent (`E02`, `E05`, `E18`).

**Retirement/non-goals:** remove per-action HTTP refetches and local room invalidation events. Keep heartbeats and moderation audit semantics; heartbeats are not obsolete polling.

### CN-11. Make Activity, notifications, and read state native

**Outcome:** read state and badges synchronize across clients without silently swallowing failures or future arrivals.

**Scope:** typed Activity/notification queries and counts, monotonic read cursors, mark-visible/mark-all operations, safe destination metadata, optimistic read updates.

**Anchors:** `CollaborationRealtimeProvider.tsx`, `ChatActivityView.tsx`, list/notification version consumers.

**Depends on:** CN-04, CN-08, CN-10.

**Acceptance:** A marking read updates B; a new message arriving during mark-read remains unread if unseen; failure restores correct feedback; notification navigation needs no type-resolution HTTP round trip (`E10`).

**Retirement/non-goals:** remove local read maps used as permanent truth, notification invalidation events, and obsolete combined list-version refresh. Preserve external notification delivery.

## 6. Phase D: files and knowledge

### CN-12. Make file metadata reactive and open viewers immediately

**Outcome:** clicking a file opens the viewer shell before full text or bytes arrive.

**Scope:** native scoped file/folder metadata and detail queries; rename/move/archive/share; controlled reactive inputs to shared UI; immediate viewer selection; separate authorized content loading keyed by revision.

**Anchors:** `webKnowledgeSurfaceAdapters.ts`, shared `knowledge/surface-state.ts`, Files sidebar, `KnowledgeViewHost`, `convex/files/files.ts`.

**Depends on:** CN-02/CN-03 interfaces for implementation. CN-06 remains the pilot acceptance gate before integration/release; CN-12 can be authored in parallel now.

**Acceptance:** slow-content opening, quick A-to-B selection, remote rename/move/delete, and permission revocation pass (`E11` to `E13`). Shared UI still has no backend/private web imports.

**Retirement/non-goals:** delete fetch-before-selection and metadata event/refetch ownership. Keep content/download/signed-URL endpoints with genuine byte-transfer responsibilities. Upload orchestration is CN-13.

### CN-13. Unify uploads, outputs, attachments, and agent-drive publication

**Outcome:** uploading and publishing a file produces one durable item that every surface sees.

**Scope:** authorized reserve/transfer/finalize pipeline, idempotent metadata finalization, live ingestion/publication progress, shared attachment/output/agent-drive metadata consumers, incomplete-upload handling.

**Anchors:** upload adapters, Files/Outputs/attachment views, Convex artifact publication and agent-drive upload modules.

**Depends on:** CN-12 and CN-06.

**Acceptance:** interrupted upload/retry does not duplicate or falsely complete a file; another client sees publication; signed URL expiry and revoked access behave correctly; existing run outputs link to the same record.

**Retirement/non-goals:** remove duplicate attachment/output metadata stores and status polling. Keep object storage and local byte progress; no storage-provider migration.

### CN-14. Make Notes reactive with safe concurrent editing

**Outcome:** Notes stay current without overwriting a user's unsaved work.

**Scope:** use the existing canonical Markdown/file representation; native list/metadata/create/save/archive/delete; base-revision autosave and conflict handling; notebook run status integration.

**Anchors:** notebook feature, note/file adapters, existing notes-to-Markdown compatibility, shared editor host.

**Depends on:** CN-12, CN-13.

**Acceptance:** clean editor receives remote versions; dirty editor retains draft on conflict; delayed save cannot overwrite a newer revision; file and note representations remain consistent (`E14`).

**Retirement/non-goals:** remove duplicate note/file state ownership and HTTP reloads. No new rich-text storage format or CRDT collaboration project.

### CN-15. Make Memories and extraction status reactive

**Outcome:** memory edits and extraction results appear without refresh while retaining scope/provenance.

**Scope:** native memory list/detail/create/edit/delete, memory-profile projections, extraction lifecycle queries, all settings and picker consumers.

**Anchors:** knowledge/memory feature adapters, `convex/knowledge/memories.ts`, memory profile/extractor modules.

**Depends on:** CN-12.

**Acceptance:** two clients observe edits/deletes/extraction completion; personal/workspace access is enforced; provenance and error state survive retries.

**Retirement/non-goals:** delete memory invalidation events and HTTP list ownership. Keep inference/extraction execution where it belongs.

## 7. Phase E: Work, automations, and skills

### CN-16. Make Work list/detail/comments native

**Outcome:** tasks and comments are live across board/list/timeline/sidebar/peek consumers.

**Scope:** native bounded list/detail/context/events, task create and ordinary field edits, comments, archive/restore, optimistic updates. Replace permanent list/extras ownership while preserving draft UI.

**Anchors:** `WorkDataProvider.tsx`, Work hooks/sidebar/peek, `convex/work/workItems.ts`, `workItemEvents.ts`.

**Depends on:** CN-06. CN-07 is required if reusing its agent-picker projections.

**Acceptance:** remote edits/comments appear everywhere; direct links beyond the list window work; failed edits preserve later changes; role and scope denial remain enforced (`E15`, `E19`).

**Retirement/non-goals:** remove Work snapshot reload/event ownership for these operations. Existing move/assignment commands may temporarily remain explicitly classified HTTP commands against the same subscribed state; CN-17 replaces them.

### CN-17. Make Work ordering, dependencies, and assignment execution native

**Outcome:** drag/drop and assignment stay instant without losing rank, graph, or execution guarantees.

**Scope:** native move/rank mutations, dependency/parent validation, assignee/reviewer changes, assignment-to-run admission, optimistic board projections and revision-sensitive conflict handling.

**Anchors:** Work rank/state helpers, graph/permission logic, assignment execution integration, Convex Work domain.

**Depends on:** CN-16, CN-07, CN-09.

**Acceptance:** simultaneous moves converge; a failed move does not restore an obsolete whole board; invalid dependencies/assignments fail; duplicate submission cannot launch duplicate assigned work (`E15`, `E16`).

**Retirement/non-goals:** remove remaining browser Work CRUD commands and custom pending/reload bookkeeping. Keep canonical rank and execution state machines rather than inventing replacements.

### CN-18. Make automation definitions and schedule editing native

**Outcome:** schedule and enabled-state changes synchronize without reload.

**Scope:** native definition list/detail/create/edit/enable/disable/archive/delete, schedule validation, revision-aware editor drafts, optimistic reversible metadata changes.

**Anchors:** automations feature and chat automation panels, `convex/automations/automations.ts`.

**Depends on:** CN-06; CN-07 for shared agent selection.

**Acceptance:** A's schedule changes appear in B; stale form saves conflict safely; disabling/deleting has defined behavior for queued work; authorization remains intact.

**Retirement/non-goals:** remove automation-definition snapshots and reloads. Existing runner remains; run-now/history is CN-19.

### CN-19. Subscribe automation execution and run history

**Outcome:** a run can be followed across tabs and refreshes through actual durable progress.

**Scope:** idempotent run-now/cancel/retry commands as supported; paginated history/detail/milestones; projection of existing runner/projector state.

**Anchors:** automation run consumers, Convex runner/workflow events/projector modules.

**Depends on:** CN-18 and CN-06.

**Acceptance:** pending admission, execution, failure, retry, and terminal state synchronize; repeated submission does not duplicate work; disabled/changed schedules respect existing lifecycle policy (`E16`).

**Retirement/non-goals:** remove run-history/status polling. No replacement scheduler or workflow engine.

### CN-20. Make skill management and availability native

**Outcome:** creating or updating a skill updates every authorized management view and picker.

**Scope:** native list/detail/create/update/archive/delete and safe availability projections; revision-aware editing.

**Anchors:** `SkillsView.tsx`, skill drafts and chat consumers, `convex/integrations/skills.ts`.

**Depends on:** CN-02/CN-03 interfaces for parallel implementation; CN-06 pilot acceptance before integration/release.

**Acceptance:** remote changes update pickers; invalid/stale edits fail safely; permissions and archived availability remain consistent.

**Retirement/non-goals:** remove skill HTTP ownership and reload signals. Skill execution and external tool transport do not change.

## 8. Phase F: control plane and settings

### CN-21. Make MCP configuration, grants, and connection state native

**Outcome:** safe MCP metadata and connection state stay current across clients.

**Scope:** authorized server/configuration queries, grants, metadata edits, test/connect/disconnect command state. Preserve OAuth callbacks and credential storage.

**Anchors:** `McpServersView.tsx`, MCP settings/tool consumers, `convex/integrations/mcpServers.ts`, `convex/mcp/grants.ts`.

**Depends on:** CN-02/CN-03 interfaces for parallel implementation; CN-06 pilot acceptance before integration/release.

**Acceptance:** test/connect reports real pending/final outcomes; revoked grants disappear; queries never expose credentials. Failed actions do not optimistically claim a working connection.

**Retirement/non-goals:** remove MCP configuration/status snapshots and polling. Keep external protocol/OAuth. Token issuance/revocation UX is completed in CN-29.

### CN-22. Make integration and model-provider connection state native

**Outcome:** connected apps/provider changes update settings and composer model availability remotely.

**Scope:** sanitized connection/account/status queries; app-owned metadata mutations; observable connect/test/disconnect operations; picker integration; revision-safe configuration editing.

**Anchors:** integrations feature, provider/subscription connection dialogs/hooks, `convex/providers/*`, workspace connectors.

**Depends on:** CN-06; CN-07 where agent-provider account views share profile data.

**Acceptance:** external success/failure appears in both clients; disconnect removes availability; personal/workspace sharing is respected; no secret-bearing record is subscribed to.

**Retirement/non-goals:** remove stored-status HTTP polling and local success caches. Keep OAuth/provider/subscription runtimes and credential refresh infrastructure.

### CN-23. Make Computers and environment status reactive

**Outcome:** sidebar, agent panel, and settings agree about Computer/environment state without independent polls.

**Scope:** sanitized lifecycle/binding/enrollment queries; durable start/stop/provision/destroy/control intent; permission checks and pending UI; integrate all Computer entry points.

**Anchors:** Computer/environment settings, agent computer hooks, `convex/computers/computers.ts`, environment control plane.

**Depends on:** CN-07 and CN-09.

**Acceptance:** command acknowledgment is immediate but readiness is provider-confirmed; reconnect and duplicate commands are safe; desktop tickets never enter shared query records (`E16`).

**Retirement/non-goals:** remove UI polling of stored status. Keep provider acquisition/heartbeats and terminal/browser/desktop transports. No compute-provider replacement.

### CN-24. Make surface/channel bindings and extension-host status reactive

**Outcome:** surface bindings and execution status converge across the trusted web host.

**Scope:** safe surface/channel/binding/execution queries; binding CRUD; extension-host data inputs and feature-flagged views.

**Anchors:** agent surface hooks/fields, `convex/surfaces/*`, `/app/x/[...slug]` host.

**Depends on:** CN-07, CN-09.

**Acceptance:** remote bind/unbind updates views; execution status survives refresh; untrusted iframe code receives only its existing scoped contract, never privileged Convex credentials.

**Retirement/non-goals:** remove host metadata refetch loops. Keep external-channel events, extension APIs, and runtime protocols.

### CN-25. Make workspace directory and app-owned settings reactive

**Outcome:** workspace names, directory entries, and settings update without forcing other tabs to navigate.

**Scope:** complete native directory/settings queries and authorized create/rename/handle/app-setting operations; preserve local route selection and any necessary saved-workspace cookie update.

**Anchors:** `WorkspaceContext.tsx`, workspace client/directory/switcher/name/settings components, workspace Convex modules.

**Depends on:** CN-03. Implementation can run now in parallel with the pilot; integration still requires shared auth/scope compatibility and pilot acceptance.

**Acceptance:** remote rename/settings changes synchronize; handle/legacy links work; changing workspace in one tab does not hijack another; no old-scope flash (`E18`).

**Retirement/non-goals:** remove directory/settings HTTP ownership. Keep session-cookie and external organization orchestration. Membership administration is CN-26, billing is CN-28.

### CN-26. Make membership, roles, and invitations native

**Outcome:** access management updates every subscribed client and preserves external identity/delivery semantics.

**Scope:** authorized member/role/invitation queries and commands; canonical policy enforcement; durable external invite/org operations where needed; acceptance/revocation status.

**Anchors:** workspace management/invitation components, collaboration workspace/sharing and authorization modules.

**Depends on:** CN-25.

**Acceptance:** removal/role change revokes subscribed access; invitation retry/acceptance is idempotent; non-admin direct function calls fail; external failures are not rendered as success (`E18`, `E19`, `E22`).

**Retirement/non-goals:** remove member/invitation snapshots and refresh events. Do not remove the WorkOS/session boundary or weaken last-owner/role invariants.

### CN-27. Make account preferences and onboarding state native

**Outcome:** app-owned account choices and onboarding progress synchronize without overwriting local drafts or device settings.

**Scope:** determine actual current storage, then migrate profile/preferences/onboarding and safe catalog/entitlement inputs. Preserve identity-provider-owned fields and device-local preferences.

**Anchors:** `AuthContext.tsx`, `AppSettingsProvider.tsx`, preference/model catalog hooks, `convex/auth/users.ts`, onboarding and UI settings modules.

**Depends on:** CN-25; CN-22 for connection-aware model availability.

**Acceptance:** remote preference changes apply appropriately; dirty forms survive; account switch clears old state; local OS/dictation preferences remain device-local.

**Retirement/non-goals:** remove persisted-preference HTTP snapshots and unsupported repository placeholders once proven unused. Do not migrate a placeholder as though it were a working store. No sign-in UX redesign.

### CN-28. Subscribe billing, usage, and entitlement projections

**Outcome:** verified billing state updates across clients without status polling.

**Scope:** safe authorized subscription/balance/limit/usage queries, bounded aggregate projections, genuine configuration mutations where supported, and pending external-payment UI.

**Anchors:** workspace billing/usage/auto-top-up panels, subscription consumers, `convex/billing/*`, usage modules.

**Depends on:** CN-25 and CN-26.

**Acceptance:** webhook-confirmed changes update both clients; duplicate provider events cannot double-credit; payer access is enforced; no optimistic balance/paid entitlement (`E17`).

**Retirement/non-goals:** remove billing-read polling and duplicate UI calculations. Preserve ledger/settlement/admission rules, Stripe checkout/portal, and the existing Convex `/stripe/webhook`. No billing-engine rewrite.

### CN-29. Make programmatic credential management reactive

**Outcome:** API-key/MCP-token metadata and revocation are current without exposing reusable secrets.

**Scope:** safe paginated metadata queries; permissioned issue/revoke/rotate commands; one-time secret display; audit attribution; affected settings views.

**Anchors:** API-key/connected-app/MCP token settings, `convex/auth/apiKeys.ts`, MCP grants.

**Depends on:** CN-21 and CN-26.

**Acceptance:** revoked access is rejected by the actual programmatic path; second client sees revocation; secrets appear only in the intended one-time response, never list/history queries (`E22`).

**Retirement/non-goals:** remove metadata reload loops. Keep existing public auth/agent/service protocols and their security requirements.

### CN-30. Make webhook management and delivery history reactive

**Outcome:** webhook configuration and delivery/retry status are live and auditable.

**Scope:** native safe subscription/delivery queries, configuration commands, secret rotation response, redrive with existing retry/idempotency rules.

**Anchors:** webhook settings, `convex/webhooks/subscriptions.ts`, deliveries and runner.

**Depends on:** CN-26.

**Acceptance:** two clients see delivery transitions and config changes; unauthorized rotation/redrive fails; signing secrets are not query fields; retries preserve delivery semantics.

**Retirement/non-goals:** remove webhook settings/status refresh loops. No replacement delivery engine or public webhook protocol.

### CN-31. Subscribe imports and long-running ingestion progress

**Outcome:** import progress can be followed across clients and page reloads.

**Scope:** native job/status/result queries and authorized idempotent start/cancel/retry where supported; OAuth completion status where backed by durable records.

**Anchors:** `SlackImportPanel.tsx`, import/ingestion panels, `convex/imports/*`, existing job runners.

**Depends on:** CN-13, CN-22, CN-26.

**Acceptance:** refresh/reconnect retains actual progress; expired auth/provider timeout shows failure; repeated command does not duplicate an import (`E16`).

**Retirement/non-goals:** remove stored-job polling. Keep server-side provider polling where unavoidable and local popup-close detection where genuinely local.

## 9. Phase G: close cross-surface gaps

### CN-32. Make cross-resource search and pickers native

**Outcome:** lookup results respect live scope, availability, and permissions rather than stale snapshots.

**Scope:** debounced bounded Convex-backed search/mention/resource queries; shared picker consumers; file-link metadata resolution; stable destination metadata.

**Anchors:** `convex/search/mentions.ts`, composer/resource pickers, file-link resolver and shared lookup consumers.

**Depends on:** relevant source domains: CN-07, CN-12, CN-16, CN-20, CN-21, CN-22, CN-26. A source-specific slice may land earlier without claiming the card complete.

**Acceptance:** stale term/scope responses never replace newer ones; archived or access-revoked resources disappear; counts/suggestions cannot leak hidden resources; query sizes remain bounded.

**Retirement/non-goals:** remove duplicate HTTP lookup caches and full-workspace client scans. Preserve valid external search execution and current ranking semantics.

### CN-33. Complete unified archive, restore, and scope movement

**Outcome:** the unified archived/settings views are as reactive and correct as each originating feature.

**Scope:** finish mixed-resource archive projections, restore/permanent-delete and cross-scope movement entry points, canonical shared permission behavior, selection/Undo coordination.

**Anchors:** archived settings/actions/items, `use-scope-item-actions.ts`, `convex/lib/scopeMutations.ts` and sharing helpers.

**Depends on:** all affected resource cards, especially CN-04, CN-09, CN-10, CN-12, CN-14, CN-16, CN-18, CN-20, CN-26.

**Acceptance:** every resource's source list, archive list, and detail converge; rollback preserves later edits; restore chooses an authorized destination; delete retains confirmation/cascade rules (`E04`, `E05`, `E13`).

**Retirement/non-goals:** delete remaining resource-specific archive loaders and event plumbing. This is cross-resource completion, not permission to postpone ordinary archive support from earlier cards.

### CN-34. Retire shell snapshot bootstrap and database polling

**Outcome:** the app shell renders directly from the completed native domain queries with no hidden refresh system.

**Scope:** remove remaining internal HTTP route-data bootstrap, database capability branches, sidebar snapshot caches, obsolete global version/refetch managers; add selective preload only where measured beneficial; consolidate subscription lifetimes.

**Anchors:** `src/server/app/route-data.ts`, app providers, sidebars, `BackgroundPollManager.tsx`, capability and authorization providers.

**Depends on:** CN-04 through CN-33 for all consumers actually owned by the shared paths being removed.

**Acceptance:** cold/warm navigation and server hydration match native queries; no old-scope flash; subscription counts remain bounded after repeated navigation; no authoritative-data UI polling remains (`E06`, `E09`, `E18`, `E21`).

**Retirement/non-goals:** delete the shared snapshot/polling infrastructure now unused. Retain real feature/entitlement/runtime capabilities, auth refresh where required, device-local timers, presence heartbeats, and provider-side status acquisition.

## 10. Phase H: remove the obsolete architecture

### CN-35. Remove legacy browser argument-token authentication

**Outcome:** all application browser subscriptions and mutations use the native identity lifecycle.

**Scope:** confirm last consumer removal; delete the HS256 browser-token minting/verification/query-argument path and periodic broker plumbing that no longer serves a caller; simplify provider auth.

**Anchors:** browser token route/broker/provider, `convex/lib/browserConvexToken.ts`, migrated function validators.

**Depends on:** CN-34 and a zero-remaining-browser-consumer audit. Retained external consumers, if any, must first be explicitly migrated or separated.

**Acceptance:** login, expiration, forced refresh, logout, preview auth, supported self-hosted auth, and native session handoff all pass; builds cannot accidentally restore old query-token usage (`E09`, `E22`).

**Retirement/non-goals:** remove only browser auth infrastructure. Do not delete `INTERNAL_API_SECRET` or unrelated service authentication merely because the browser token previously used it.

### CN-36. Remove the remaining database-provider repository registry

**Outcome:** Convex is an explicit backend commitment in server code too, without breaking external API consumers.

**Scope:** migrate remaining pass-through server repository callers to typed Convex domain operations or explicit server domain clients; preserve trusted public bridges and policy; remove `AppDataRepositories`, provider selection, unused interfaces/classes, and unsupported placeholders after their consumers disappear.

**Anchors:** `src/server/app-data/*`, remaining `*Repository`/`Convex*Repository` pairs, server domain services and public API adapters.

**Depends on:** domain caller migrations through CN-34 and consumer ledger completion; coordinate with CN-35 where auth signatures overlap.

**Acceptance:** retained REST/native/agent/webhook writes still trigger the same browser subscriptions and obey the same policy; API contract tests pass; no server secret leaks or operator boundary regression (`E19`, `E20`).

**Retirement/non-goals:** remove persistence portability, not useful storage/runtime/provider boundaries or `@overlay/api-client` wholesale. If remaining callers span many unrelated domains, split this into domain-specific cleanup PRs rather than landing a giant registry rewrite.

### CN-37. Enforce the native architecture and close migration compatibility

**Outcome:** the migration is finished, not indefinitely dual-path, and ordinary development cannot quietly recreate the original problem.

**Scope:** remove expired rollout flags/unused internal-only routes after the agreed compatibility window; add narrow boundary checks against generic database-provider layers and unapproved ordinary web CRUD proxies; update architecture/contributor guidance and test ownership.

**Anchors:** boundary scripts/configuration, retired routes and API-client web usages, architecture documentation, native Convex and retained API contract suites.

**Depends on:** CN-35 and CN-36.

**Acceptance:** full surface ledger has no unclassified path; every retained HTTP endpoint has a real consumer/runtime reason; E01-E22 pass at the integrated revision; performance/cost budgets and supported client compatibility are reviewed. No boundary rule indiscriminately bans legitimate HTTP or timers.

**Retirement/non-goals:** delete obsolete provider-contract assertions only after preserving their domain/security guarantees in native/compatibility tests. No new product feature or visual redesign in this final PR.

## 11. Parallelism and critical path

```text
CN-01 -> CN-02 -> CN-03 -> CN-04 -> CN-05 -> CN-06
                                              |
                   +--------------------------+----------------------+
                   |                          |                      |
             agents/rooms                 Files/Notes             Work/automation
              CN-07..11                   CN-12..15                CN-16..20
                   |                          |                      |
                   +---------------- control-plane/settings --------+
                                  CN-21..31
                                        |
                           search/archive/shell CN-32..34
                                        |
                              retirement CN-35..37
```

The diagram above describes acceptance and integration gates, not a global implementation queue. The user approved starting five independent domain slices while the master session finishes the personal-chat pilot. Individual cards remain authoritative for domain dependencies.

### Parallel execution as originally planned

Superseded: the owners, pinned revision and stacked PR bases in this subsection and the next describe the original parallel plan, which has been stopped. The foundation has merged and the child PRs are closed. Use the status table and "Every domain finishes by contracting" for current practice. The security and backend-agnostic UI requirements below still apply.

| Owner | Work now | Boundary |
|---|---|---|
| Master session | CN-04, then CN-05, then CN-06 | Shared auth, scope/capability helpers, provider/shell composition, personal transcript and streaming |
| Child CN-07 | Reactive agent directory and profile editor | No agent-thread transcript, Computer provisioning or provider linking migration |
| Child CN-12 | Reactive file metadata and immediate viewer opening | Keep byte/download authorization and upload orchestration boundaries |
| Child CN-20 | Native skill management and availability | No skill execution/runtime changes |
| Child CN-21 | Native safe MCP configuration, grants and connection-state projections | Keep credentials, OAuth and external protocol server-owned |
| Child CN-25 | Reactive workspace directory and app-owned settings | Own WorkspaceContext, but not auth or shell composition; membership/billing stay separate |

Each child has an isolated VM/checkout and dedicated branch. The five units form one tracked parallel workflow, with structured outcomes and no automatic merge stage. They use the reviewed CN-02/CN-03 auth contracts as exposed by the CN-04 branch, pinned initially at `600ad912433d61d9381f0edb80bd27fb00e573e2`. CN-04 remains under review; starting from that revision is not acceptance of the pilot. Merge forward approved foundation fixes before final validation.

Sibling draft PRs target `devin/cn04-native-personal-lists` initially, keeping each domain diff focused. They are not a five-deep dependency chain. The master reviews their diffs and then coordinates dependency-aware integration with the existing stack. Do not manually retarget GitHub-managed stacked PRs or rewrite their history.

### Shared-file ownership and integration

**Approved audit prerequisite (CN-03P):** the initial child audits found that files, skills, MCP and external-agent operations depend on deployment-feature policy resolved in Next.js from defaults, config files, remote config and environment. Native role checks alone do not preserve those restrictions. The user approved a single master-owned, server-controlled, fail-closed Convex policy guard. All five existing children have been rebriefed to continue against its explicit interfaces and integrate the published foundation before final validation. Do not copy client flags or assume default-enabled Convex environment flags. CN-04 personal conversation CRUD has no corresponding route/runtime-feature mapping; model execution retains its existing server admission checks.

CN-25 is workspace-local directory and settings. Account-level AppSettingsProvider/preferences are explicitly CN-27. Its non-blocked directory/local-settings work can proceed; handle operations needing deployment policy stay on the existing authorized path until the shared prerequisite is integrated. Agent archive cleanup of Computers and credential/profile values remains genuine privileged server orchestration, not a metadata-only native mutation.

- Auth/token providers, native viewer and capability helpers, AppClientProviders, AppShellLayout and personal-chat infrastructure remain master-owned. Children may consume their interfaces, not redesign or weaken them.
- CN-25 alone owns WorkspaceContext and directory/settings hooks. Other children treat its public interface as stable and key all data by authenticated identity and workspace.
- Each child owns separate domain Convex modules, domain UI/hooks and focused tests. Shared schema/API generation changes must be additive and limited to that domain; generated API declarations are regenerated once at integration. Changelog entries are preserved, not overwritten.
- Cross-domain picker wiring must be through domain exports or separately reported integration patches, not concurrent edits to shared chat controllers or provider composition. Keep shared UI packages backend-agnostic.
- Report any shared-interface change or security ambiguity before broadening scope. Backend identity, resource authorization, membership revocation, billing admission and secret handling are acceptance requirements, not optional cleanup.

### Validation and landing gates

1. Children implement and run focused tests, changed-file lint, boundary checks and TypeScript. Each opens a draft PR, records exact SHA/results/limitations, then stops before merge or production deployment.
2. Master finishes and proves CN-04/CN-05/CN-06 together, reviews each child diff and resolves shared integration changes deliberately.
3. Main-targeted draft validation PRs provide exact-head isolated Previews where dependent PR bases cannot. No stale Preview acceptance and no deployment-policy bypass.
4. Each domain must pass its own two-client, optimistic rollback, permission and regression scenarios on the integrated revision. Pilot success does not automatically validate other domains.
5. Production merges/deployments remain separately authorized. No automatic merge is part of this parallel workflow.

CN-08 and other transcript/run consumers remain behind the established CN-05/CN-06 design. CN-09 still needs CN-07 and CN-08; later cards retain their dependencies. Shared repository/proxy retirement waits for the last real consumer. This changes scheduling, not architecture, security, or acceptance criteria.

## 12. Architecture-plan surface coverage

| Original workstream | Primary PRs |
|---|---|
| S01 Shell/navigation/bootstrap | CN-03, CN-34, CN-37 |
| S02 Workspace/membership/invitations | CN-03, CN-25, CN-26 |
| S03 Personal chats | CN-04, CN-05, CN-06 |
| S04 DMs/channels/threads | CN-08, CN-10 |
| S05 Activity/reactions/pins/saves/read state | CN-10, CN-11 |
| S06 Agent directory/editor | CN-07 |
| S07 Agent threads | CN-09 |
| S08 Runs/approvals/artifacts | CN-06, CN-08, CN-13, CN-19 |
| S09 Files/folders/outputs/drive | CN-12, CN-13 |
| S10 Notes | CN-14 |
| S11 Memories | CN-15 |
| S12 Work | CN-16, CN-17 |
| S13 Automations | CN-18, CN-19 |
| S14 Skills/tools/MCP | CN-20, CN-21, CN-29 |
| S15 Integrations/provider connections | CN-22 |
| S16 Computers/environments | CN-23 |
| S17 Surfaces/Extensions | CN-24 |
| S18 Search/mentions/pickers | CN-32, with source-domain consumers migrated earlier |
| S19 Account/preferences/onboarding/catalog | CN-27, CN-22 |
| S20 Billing/usage | CN-28 |
| S21 Webhooks/API keys/MCP tokens | CN-29, CN-30 |
| S22 Imports/ingestion/jobs | CN-13, CN-31 |
| S23 Archive/scope/sharing/deletion | Per-domain cards, completed by CN-33 |
| S24 External/native/agent/operator consumers | Compatibility in every card; CN-36 and CN-37 retirement gates |

## 13. PR description template

```markdown
## Outcome
CN-XX: [one specific product or architectural outcome]

## Scope
- Native query/mutation/action and canonical policy changes
- Web entry points migrated
- Optimistic/loading/reconciliation behavior
- Old ownership/plumbing removed

## Dependencies and non-goals
- Required merged cards
- Explicitly retained endpoint/consumer/runtime boundary

## Verification
- Focused tests, lint/typecheck, relevant boundary checks
- Isolated current-head preview and backend
- Two-client behavior and relevant failure/permission scenarios
- Latency/cost observations where applicable

## Rollout and rollback
- Additive schema/function changes and readiness gate
- Activation and rollback behavior
- Remaining compatibility consumer and retirement condition
```

## Recommendation

Approve this as the working PR roadmap, then execute **CN-01 through CN-06 first**. Review the complete chat pilot before scaling across domains. The subsequent cards provide a comprehensive queue, but their estimates and fine-grained splits should be adjusted using what the pilot actually establishes.

The standard for a completed PR is not “we now call Convex.” It is: **a specific user-visible behavior has one authoritative state path, is responsive, stays synchronized, handles failure correctly, and no longer needs its old web plumbing.**
