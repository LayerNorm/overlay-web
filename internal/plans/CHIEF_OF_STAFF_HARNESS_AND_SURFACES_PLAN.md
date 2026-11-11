# Chief of Staff Harness and Surface Implementation Plan

Status: In progress in [PR #409](https://github.com/LayerNorm/overlay-web/pull/409). Phases 1–3 are implemented and the native web scenarios below are accepted, with explicit hosted-verification limits. Latest hosted acceptance is at `8095ca45efe3be3faca284179156fa516147e825`; results not retested there are carried forward from `abb2d2b` / `3e2b8e994e71c6fc18f72ae9f360b6abef11615e`, not claimed as exact-head retests. Phase 4 items 1–5 are implemented, but hosted connected Slack acceptance remains unverified at the install callback; Phase 4 items 6–7 and Phases 5–6 have not started. See [Progress](#progress). The revised web/Slack mockup is the visual reference.

## Progress

Legend: `[x]` implemented in PR #409, `[~]` partially implemented, `[ ]` not started. Implementation checkboxes are not blanket hosted acceptance.

| Phase | State | Summary |
|---|---|---|
| 1. Assignment and authorization contracts | Implemented; listed web scenarios accepted | Personal discovery, isolated assignments, same-thread revision, restricted-member/revocation and shared-room memory privacy including follow-up passed. Private files/credentials and unauthorized attempt-ID redaction are not separately hosted-verified. |
| 2. Native Chief orchestration | Implemented; listed web scenarios accepted | Two-specialist delegation, actual reads/acceptance, follow-up/revision, blocked-child wait/resume/accept, active-child parent Stop cancellation, waiting-parent recovery deferral with one launch and Chief read/accept, and recoverable bad-attempt feedback passed. Early pending reads have narration, not authoritative call traces. |
| 3. Web experience | Implemented; listed web scenarios accepted | Work grouping, 40px rows, keyboard, attempts, no-match, channel links, search, archive/Undo, read markers, light/dark and 390px passed, as did the dirty-note warning. Pagination and Slack-origin browser interactions remain unverified. |
| 4. Chief-only Slack | Items 1–5 implemented; hosted connection acceptance blocked at callback | Workspace-scoped settings, verified identity linking, Chief-only admission, normalized inbound turns and durable delivery are implemented. Migration and scope-reauthorization work remains; hosted connection acceptance has not passed. |
| 5. Personal-Chief contributions | Not started | Cross-owner personal-Chief delegation is refused until grants exist. |
| 6. Connected agents and transports | Not started | External and connected agents are rejected before any assignment is written. |

### Hosted acceptance

Canonical preview: `https://pr-409.preview.getoverlay.io`, isolated backend `content-bobcat-927`. Latest accepted deployment: `dpl_Bi9N9PY2zp2vMgiLADW2jiHXUMyn`, exact revision `8095ca45efe3be3faca284179156fa516147e825`. Earlier recovery used `dpl_EsENUkVwMmFyM4vg3jWBseRw7atb` at `3e2b8e99`. The hosted QA record across the revisions above accepts:

Phase 4 connected Slack acceptance remains unverified. The recorded install consent callback at `17:31:05.623Z` redirected with `account_mismatch` and created no connection, identity, turn or thread. A separate test-harness-delayed-consent retry established only a reachable expired-WorkOS-access-token case: the read-only callback lookup rejected it, while a normal session request refreshed the same principal. **Test harness delayed consent so original17:31 cause still unknown; do not claim original diagnosed.** This change uses the existing refresh-aware helper; no new OAuth acceptance attempt was made.

- Personal discovery and two-specialist delegation, actual result reads and one consolidated Chief response.
- Follow-up and revision in the same assignment thread.
- A genuinely blocked child: durable parent wait, child resume and result acceptance.
- Parent Stop while a child is active: cancellation propagates to the executing child.
- Waiting-parent recovery deferral, followed by exactly one child launch and the Chief's actual read and acceptance.
- Recoverable malformed/stale attempt-ID feedback followed by a correct retry.
- Shared-room memory privacy, including follow-up; restricted-member access and revocation.
- Work UI: assignment group separate from editable tasks, 40px rows, keyboard navigation, attempts, no-match state, channel-parent links, search, archive/Undo, read markers, light/dark and 390px layout.
- Clean navigation without an empty-composer warning, while genuine dirty notes still warn.

The latest recovery fixture used parent `workspace:rh7dxm5em6kjwmm12fvbctg7018hyny7`, assignment `assignment_e57eff504874df3117091a507a6e2548f2ad71eab45f834dfc8c9b348f34848f` and tool-call ID `qa-recovery-8095-1`. Three cron cycles left its intent pending, attempts/generation at zero and `nextAttemptAt` unchanged, with no child while the parent waited. After Continue, persisted admission at 17:05:44.035 UTC on November 10, 2026 created child `workspace:rh7f06bpwedybvrjynk2x8mdyx8hy505`. Completed-read evidence at 17:06:23.702 records its actual reply containing `RECOVERY_OK`; resolution evidence at 17:06:38.109 records acceptance of the exact current attempt.

The earlier `3e2b8e99` fixture launched one child but the Chief misinterpreted an early invalid-child rejection and excluded its later completed result. That is not accepted Chief follow-through; it motivated assignment-ID reads, explicit launch-state context and corrective nonfatal child feedback. Earlier failed blocking-join and projection runs likewise remain historical failures, not retrospectively successful tests.

### Not hosted-verified / evidence limits

Local unit/contract coverage is not a substitute for these outstanding hosted checks:

- Never-launched assignment under a terminal parent projecting cancelled: unit-tested only.
- Unauthorized attempt-ID redaction in recoverable feedback: unit-tested only.
- Early `harness_read_child({ assignmentId })` returning `launch_pending`: unit-tested; hosted narration only. Pre-admission checkpoints at 17:05:03.242 and 17:05:33.761 describe pending reads but are explicitly `unverifiedNarrative`. Pending returns do not record evidence, control-tool inputs/results are omitted from public transcripts, and deployment-log searches found no matching calls. The completed bound read is proven, but its original argument (`assignmentId` versus `childRunId`) is not persisted.
- Private files and credentials separately from memory: no separate hosted privacy acceptance; authorization tests do not establish that broader claim.
- Slack-origin threads and web/Slack parity: not hosted-verified, deferred to Phase 4. Existing privacy contracts/tests do not constitute Slack execution acceptance.
- Pagination interactions: not yet browser-verified.

### Nonblocking observations and retained boundaries

- The recovered specialist (`openai/gpt-4o-mini`) misused `present_generated_ui` with `{ kind: 'draft.text', prompt: 'RECOVERY_OK' }`. Validation correctly returned a nonfatal failure: required `body` missing and `prompt` unrecognized for that variant. It then returned prose containing `RECOVERY_OK` and completed. This is specialist model misuse, not a Chief/recovery failure; the broad multi-variant advertised schema may permit confusion.
- A manually built Work URL missing `scope=workspace` stayed on the skeleton. Normal navigation worked. This is an unresolved deep-link observation, not a successful loading check or a failure of normal navigation.
- Mainline owner-funded accounting and agent limits remain intact; no pre-call funding holds or removed resource-wait APIs were restored. Assignment dispositions do not bypass outstanding usage reconciliation or child execution checks.
- Shared-room and Slack-origin privacy restrictions are implemented through assignments and follow-up tool calls; hosted privacy acceptance above is specifically shared-room memory, not all private resources or Slack-origin execution.


## 1. Outcome

Make Overlay's workspace Chief of Staff the single front door to an agent workforce. A person asks for an outcome on the web or in Slack. The Chief selects authorized agents, delegates bounded assignments, follows through, gathers their results, and delivers one consolidated answer.

**Build this as an extension of the existing Overlay Harness, not a Slack-specific orchestration loop or a new agent framework.**

The core acceptance criterion is:

> Starting the same authorized task on the web or in Slack produces the same Chief behavior, assignment threads, execution state and result structure. Only origin, audience and delivery destination differ.

Equivalent behavior does not require identical model wording.

### Scope

- First release: native web orchestration and Chief-only Slack for authorized workspace members and Overlay Harness specialists.
- Full design: permissioned contributions from members' personal Chiefs, followed by connected external agents.
- Future adapters: Teams, iMessage or other supported platforms. Their actual platform capabilities must be qualified separately; this plan does not promise that every platform supports every interaction.
- Retain ordinary direct conversations with specialists inside Overlay. Chief-only applies to external surface entry points, not all web navigation.

### Design references

- [Approved-direction mockup](mockups/chief-of-staff-surfaces.html)
- [Mockup source](mockups/chief-of-staff-surfaces.tsx)
- [PR 405 sidebar UI/UX](https://github.com/LayerNorm/overlay-web/pull/405)
- [Existing Harness reliability plan](LONG_RUNNING_HARNESS_RELIABILITY_PLAN.md)
- [Existing decision to remove Harness verification](REMOVE_HARNESS_VERIFIER_PLAN.md)
- [Slack integration setup](../develop/surfaces-slack-app.md)

Use PR 405's single-line thread titles, curved indentation, activity icons, collapsed-agent summaries, actions and narrow-screen drawer. Integrate against its actual landing state when implementation begins; do not independently replace the sidebar.

## 2. Non-negotiable architecture

1. One workspace Chief identity, resolved by the `workspace_chief` role, not by its display name.
2. Many concurrent outcome threads. The Chief is not one global conversation or a serial workspace worker.
3. One assignment, one dedicated agent thread. Revisions to that assignment remain there; a different assignment gets a new thread.
4. One execution engine for web, Slack and future surfaces.
5. Specialists contribute internally. Only the Chief's parent conversation publishes to the external destination.
6. Access never expands merely because an agent delegates. The Chief does not inherit another person's private credentials, conversations or files.
7. Persist execution and results before projecting them to web or external transports.
8. Run status and delivery status are separate. A completed result can still be awaiting Slack delivery.
9. The Work view projects the same run and assignment records. Do not introduce another independent task queue or task-state system.
10. Simple questions can receive direct answers. Do not force a plan or delegation for every message.

**Review means Chief synthesis, not a new verifier subsystem.** The existing repository decision removes mandatory final-answer verification and evidence gates. Preserve structural checks for unresolved work and running children; do not restore a mandatory verifier model, proof-per-action policy or compulsory plans. Users may explicitly request an independent reviewer agent.

## 3. Existing foundations and actual gaps

These observations are from the checked-out code, not a live Slack installation.

| Area | Already present | Required change |
| --- | --- | --- |
| Chief identity | Workspace and personal Chief roles; workspace Chief uniqueness | Resolve surface entry by role and enforce it server-side |
| Slack connection | One installable app with per-team OAuth state | Move channel setup from individual agents to workspace settings |
| Slack routing | Agent-name routing, thread ownership, single-binding fallback | Route all new authorized requests to the workspace Chief |
| Slack execution identity | Binding creator starts the turn; author membership is display metadata | Verified sender mapping must become an authorization gate |
| Named delegation | `list_agents`, `ask_agent`, `read_agent_reply`, native named child runs | Dedicated assignment threads and unified durable assignment results |
| Child orchestration | `harness_delegate`, `harness_read_child`, parent/root lineage, reservations | Connect named assignments to the canonical thread/read model |
| Collaboration conversations | Participant-identity DM reuse | Do not reuse a group DM for unrelated assignments |
| Surface conversations | Persisted conversation with external thread mapping | Canonical Chief conversation with authorized two-way continuation |
| Web surface UI | Read-only surface mirror | Clear destination label, authorized replies and parent/child navigation |
| External agents | Native named-child dispatch rejects external targets | Separate capability-gated integration, not a silent fallback |
| Completion | State-based completion checks already exist | Extend those checks for assignment dispositions without judging answer quality |

### Primary implementation seams

- Identity: `src/shared/agents/chief-identity.ts`, `convex/collaboration/agents.ts`.
- Conversation creation: `convex/agents/agentThreads.ts`, `convex/collaboration/directMessages.ts`.
- Delegation: `src/server/agents/agent-asks/AgentAskService.ts`, `src/server/tools/tools/build.ts`, `src/server/harness/native-tool-steps.ts`.
- Harness state: `packages/overlay-agent-runtime/src/harness-state.ts`, `src/server/harness/control-tools.ts`, `convex/harness/runs.ts`.
- Surface admission: `src/server/surfaces/SurfaceService.ts`, `slack-inbound.ts`, `surface-authors.ts`, `src/server/harness/surface-access.ts`.
- Surface orchestration: `src/server/workflows/surface-agent-turn.ts`, `surface-harness-steps.ts`, `src/server/surfaces/surface-conversations.ts`.
- Persistence: `convex/schema.ts`, `convex/surfaces/surfaces.ts`, `convex/harness/nativeDelivery.ts`.
- UI: `src/features/chat/components/DirectMessageExperience.tsx`, `src/components/layout/AppSidebarAgentThreads.tsx`, `AppSidebarAgentsPanel.tsx`.
- Settings migration: `src/features/agents/components/AgentSurfacesField.tsx`, `use-agent-surfaces.ts`, and existing surface binding/connection API routes.

## 4. Canonical data model

The names below are proposed logical contracts. Extend existing tables and services where possible instead of creating a parallel persistence system.

### 4.1 Chief conversation and run

A Chief conversation is an ordinary agent conversation owned by the workspace Chief. It has:

- Workspace, Chief agent, participants/audience policy and provenance.
- An optional surface link.
- Many turns and runs over time.

Continue to use existing Harness run IDs and parent/root lineage. A follow-up starts or resumes work in the same conversation, not a new outcome conversation by default.

Every admitted turn records the verified requester, acting agent, authority scope and origin. Agent identity is not the same thing as the human authorization principal.

### 4.2 Assignment

Add a durable assignment record linking:

- Assignment ID, parent conversation ID, parent run ID and root run ID.
- Assigned agent ID and assignment conversation ID.
- Creating tool-call idempotency key.
- Brief, expected deliverable, relevant context references and dependencies.
- Scoped authorization reference and policy version.
- Revision/attempt identifiers and child run IDs.
- Structured result references and the parent's disposition of that result.

Create the assignment, fresh conversation, participant access and launch intent atomically, then launch the child idempotently. A crash between persistence and launch must be recoverable.

Do not replace all `createDirectMessage` behavior. Introduce a dedicated assignment-creation path and use it for named delegation. Leave ordinary DMs and intentional `post_message` room collaboration intact.

Assignment lifecycle projects the existing child run lifecycle: queued, working, waiting, completed, failed or cancelled. Avoid two independently writable statuses. Parent dispositions such as accepted, revision requested or explicitly excluded are coordination metadata, not another execution status.

An assignment retry or requested revision reuses its thread and creates a new attempt linked to the same assignment. A new scope of work gets a new assignment. Late results from old attempts cannot overwrite the current attempt.

### 4.3 Structured assignment result

Return a typed envelope containing:

- Assignment and attempt IDs; terminal status or typed blocker.
- Summary and artifact references, with provenance and access metadata.
- Optional supporting tool/result references.
- Failure reason or question when applicable.
- Usage and relevant execution references.

References help inspection and synthesis; they are not mandatory evidence gates. A returned failure must not become a success simply because text was produced.

### 4.4 Surface link and delivery

Separate these concepts:

- **Connection:** workspace installation of a platform.
- **Channel policy:** allowed channel, Chief routing and audience rules.
- **Thread link:** platform/team/channel/thread identity mapped to one canonical conversation.
- **Delivery record:** canonical event/message version, destination, attempts, external receipt and delivery state.

Scope external IDs by connection/team and channel. Do not key a conversation only by a timestamp or assume identifiers are globally unique.

Reuse existing surface connection and execution records where appropriate. Persist the new link independently of the old agent binding so rebinding cannot create a second canonical conversation.

### 4.5 Read state

PR 405's green ready check means a completed result has not been reviewed by that viewer. The muted check means reviewed. This is per-user read state, not a transition from completed to another execution status.

## 5. Shared execution contract

```text
Web / Slack / future adapter
          |
Verified event + authorized requester + destination policy
          |
Canonical conversation and turn admission
          |
Workspace Chief on the existing Overlay Harness
          |
Named assignment threads and child runs
          |
Durable results, revision requests and blocker handling
          |
Chief synthesis persisted in the parent conversation
          |
Web subscriptions + authorized external delivery
```

### Chief behavior

1. Understand the outcome and clarify consequential ambiguity.
2. Discover authorized agents by capabilities, ownership and execution support.
3. Handle simple work directly; plan only when useful.
4. Delegate self-contained briefs with expected outputs and relevant context.
5. Run independent assignments concurrently and dependent assignments in order.
6. Wait durably for child completion or actionable blockers.
7. Read results, reconcile disagreements, request targeted revisions or exclude work explicitly.
8. Produce a single consolidated parent answer with deliverable links and honest limitations.

Keep the public tool vocabulary small. Extend `ask_agent` with structured assignment identity and optional revision semantics; return assignment/conversation/child handles. Route `read_agent_reply` and `harness_read_child` through consistent persisted results instead of competing polling and completion semantics. Preserve existing callers during migration.

Keep `harness_delegate` for bounded internal helpers where appropriate. Temporary helpers need not appear as permanent workforce agents. Named workforce assignments must be visible threads.

### Durability and concurrency

- Different Chief conversations can run concurrently.
- Within one conversation, serialize execution ownership. Persist incoming messages while busy; apply them at safe boundaries or queue the next turn.
- Do not silently change an active run's principal when a second person replies. Revalidate that person's input; new authority requires explicit admission or a scoped approval.
- Resume the same run after child completion, approved input or recoverable interruption. No browser tab or HTTP request should be required to stay open.
- Use durable launch intents and child settlement receipts to recover lost acknowledgements.
- Reconcile duplicated or out-of-order callbacks by assignment, attempt and run identity.
- A parent cannot finalize while required work is unresolved. Failed/cancelled work must be retried, reported as a blocker or explicitly excluded with a reason.
- Parent cancellation propagates to outstanding children and prevents new dispatch. Already published results and audit history remain.
- Preserve workspace billing, actual usage accounting, optional explicit limits and cycle/depth controls. Do not add default task-lifetime deadlines, arbitrary tool-count caps or a second budget system.
- Qualify child and surface authority against the reliability plan's known gaps before enabling it. Do not advertise multi-day reliability solely from a happy-path demo.

## 6. Authority and privacy

### 6.1 Slack requester identity

Persist `surfaceRequesterIdentities` with `workspaceId, connectionId, externalTeamId, externalUserId, userId, principalId, verifiedAt, revokedAt?, version`; uniquely resolve `(connectionId, externalTeamId, externalUserId)` within its validated workspace. Link only from an authenticated Overlay session through the uncommitted `slack-identity-oauth.ts` helpers (`sealSlackIdentityState`, `exchangeSlackIdentity`, `verifiedSlackIdentityClaims`): signed expiring state binds user/workspace/install/team, OIDC validates issuer/audience/team/sub/nonce, and a server-stored one-use nonce prevents callback replay. The helper alone does not persist nonce consumption, routes or mappings. Require authenticated confirmation, active non-guest membership and active installation; conflicting account links require explicit unlink/reconfirmation, never email matching or installer fallback. Each Slack event and resumed/sensitive action rechecks mapping version, member/channel/thread access and source audience. Unlink marks the identity revoked and bumps its version; membership removal immediately invalidates execution even before cleanup; uninstall revokes all connection mappings/pending link sessions and blocks admission/resume/delivery. Reinstallation never silently restores revoked authority. Stop or authority-pause affected outstanding runs/queued turns, preserve safe audit/history, and do not retract legitimate prior messages or send results to a fallback destination. Phase 1 adds this specification; OAuth routes, identity persistence/UX and inbound/delivery enforcement ship with Phase 4, not as Slack enablement here. Delivery records also remain Phase 4.

Before launching work:

1. Verify the platform event using the existing Slack verification path.
2. Resolve the installation and permitted channel.
3. Resolve a stable `(teamId, externalUserId)` mapping to an active Overlay member.
4. Check workspace membership, thread participation and channel policy.
5. Admit a run under the verified requester and explicitly allowed workspace capabilities.

Email can help account linking but must not be the sole runtime identity proof. Linking requires authenticated confirmation tied to the external identity. Unlinked users get a safe account-linking instruction, not a run under the installer. Invited-but-inactive, removed and unauthorized users cannot execute.

Revalidate access before sensitive tools, after durable waits, and before external delivery. OAuth uninstall, membership revocation and channel removal must stop further unauthorized work.

### 6.2 Audience policy

Proposed first-release default:

- Only explicitly allowed, non-Slack-Connect workspace channels with linked active members.
- Private channels, DMs and shared channels remain disabled until their audience checks and tests are implemented.
- An eligible channel still does not authorize arbitrary private resource retrieval. Restrict results to resources approved for that destination audience.
- Web viewers need authorized conversation participation and the applicable source-audience check, not just workspace membership.
- Assignment summaries, counts, search results, notifications and artifacts must obey the same visibility rules.
- If current audience access cannot be established, fail closed. Do not trust an indefinitely cached channel-member list.
- Output attachments retain their access control; do not create public URLs merely to make Slack links convenient.

This is a conservative launch boundary, not a permanent prohibition on private Slack conversations. Expand supported audience types as separately tested capabilities.

### 6.3 Personal Chiefs

A workspace Chief may request a contribution from a personal Chief only through an explicit collaboration grant.

- Grant scope: requesting workspace/Chief, task, permitted inputs, permitted output audience, expiry and revocation.
- Request permission privately when the owner's private resources are needed.
- The personal Chief uses owner-authorized access within the grant; it does not impersonate the workspace requester.
- Return only the approved contribution, never the personal transcript, memory or credentials.
- Do not automatically give parent-thread readers access to the personal assignment thread.
- Private specialists remain behind their personal Chief.
- Approval to consult a private resource is distinct from approval to publish its contents.

Until this protocol exists, discover only eligible workspace-visible targets and explain unavailable personal contributions. Do not weaken creator-only visibility to make the demo work.

### 6.4 Input and approvals

External messages and child results are untrusted content, not policy instructions. Tool authorization is enforced in code. Bind each approval to its run, action, approver, audience and current version; reject unauthorized or stale approvals and consume duplicate callbacks only once.

## 7. Web and Slack experience

### Web

- Parent outcome thread under Overlay; assignment threads under their named agents.
- Original request attributed to the actual sender, with a small Slack origin/link when relevant.
- Compact delegated-assignment list in the parent, with progress and links.
- Assignment thread shows the Chief's brief, parent backlink, work, blocker and returned result.
- Clear distinction between internal assignment discussion and shared parent conversation.
- Linked parent composer says **Replies also appear in #launch**.
- Continuing a linked thread uses the same admission and audience rules as Slack.
- Private discussion requires a separate private conversation, not a hidden mode inside the shared transcript.
- Preserve PR 405 navigation, title truncation, status accessibility labels, archive/delete affordances and automations.
- Archiving is a navigation action, not cancellation. Prevent destructive deletion of active orchestration records or require explicit cancellation first; preserve lineage/history for referenced assignments.
- Mobile uses the same sidebar content in a drawer. Light/dark and keyboard behavior match the approved mockup.

### Slack

- Workspace Settings > Slack: install once, connect the Chief, configure allowed channels.
- Remove binding controls from specialists and personal Chiefs.
- Mentions of specialist names are instructions to the Chief, not direct routing.
- One acknowledgement, meaningful progress/approval prompts and the Chief's consolidated result.
- Include an authenticated Open in Overlay link.
- Specialists do not post independently to the Slack thread.
- Web-authored parent messages are delivered with clear human attribution; bot echoes are never re-ingested as new human requests.

### Delivery reliability

Use a transactional outbox or equivalent persisted delivery intent, keyed by canonical message/event version and destination. Reuse existing placeholder/update mechanisms where safe.

On a confirmed retryable failure, retry delivery without rerunning the Chief. On an uncertain external post, reconcile the receipt/message before reposting. Do not promise strict exactly-once delivery across Slack and the database; target durable deduplication and explicit handling of unknown outcomes.

Show delivery pending/failed separately from execution. A Slack outage must not erase a successful result in Overlay. Revoked access blocks delivery rather than triggering fallback to another channel.

## 8. Implementation sequence and exit gates

Each phase should be a reviewable change set. The boundaries below are implementation work packages, not instructions to start parallel sessions now.

### Phase 1: Canonical assignment and authorization contracts

- [x] Define assignment, attempt, result, surface-link and authority contracts. Legacy assignments retain a read projection only, without lazy attempt creation.
- [x] Add indexed, backward-compatible persistence and authorization checks.
- [x] Implement idempotent fresh assignment-thread creation.
- [x] Add ACL-aware parent/child queries and stable deep links.
- [x] Specify requester mapping, audience checks and revocation behavior before exposing Slack execution. Section 6.1 specifies linking and revocation; execution remains Phase 4.

**Exit gate:** two assignments to the same agent produce distinct threads; replay produces only one assignment; unauthorized callers cannot discover either thread or its artifacts.

### Phase 2: Native Chief orchestration

- [x] Wire named delegation to assignments and existing Harness child admission.
- [x] Unify persisted result handles and durable child waits. Both reply tools read the same persisted per-attempt envelope and full final reply. A terminal child with an unpublished reply stays publication-pending; current-run Convex finish checks enforce resolution before completion.
- [x] Add Chief instructions for discovery, briefing, follow-through and synthesis.
- [x] Implement revisions, failure dispositions, cancellation and queued follow-ups. `ask_agent` uses assignment/expected-attempt CAS for revisions; `resolve_assignment` accepts successful published results or excludes/cancels with a reason. Cancellation reuses Harness subtree and workflow cancellation. Native Chief and assignment queues retain each requester's identity and fresh authorization.
- [x] Recover persisted-but-unlaunched children and duplicate settlement events. Assignment launch intents share the continuation dispatcher and authenticated callback; generation winner claims fence billable execution. Recovery replays the original dispatch identity and repairs terminal publication from persisted transcript state without restarting tools.
- [x] Keep structural completion checks without restoring answer verification. Only current attempts belonging to the finishing coordinating run count. Reasoned exclusion completes the coordination milestone without changing failed/cancelled child execution status or bypassing usage reconciliation.

**Exit gate:** a native web request dispatches independent specialists, survives an interrupted worker, handles one blocked child and yields one parent result without duplicate execution.

### Phase 3: Web experience

- [x] Implement parent assignment list and dedicated specialist threads.
- [x] Apply PR 405's sidebar treatment and per-user read status.
- [x] Surface the same execution in Work without duplicate task records. Read-only execution rows subscribe to the assignment records and require Work capability, active membership and both conversation ACLs. Archive state removes the viewer's row without cancelling execution.
- [x] Add origin/destination labels and artifact permissions. Origin is projected only through authorized ancestry and a non-revoked connection; result/artifact access uses the same assignment boundary.
- [x] Keep linked-thread composition disabled until the shared admission and delivery path is ready. The notice explicitly says the web mirror is read-only; bidirectional composition belongs to Phase 4.
- [x] Validate desktop/mobile, themes, keyboard use and restricted viewers. Hosted acceptance includes desktop/390px, light/dark, keyboard, read markers, archive/Undo and restricted-member/revocation scenarios; earlier reload/cross-tab results are retained. Slack-origin and pagination interactions remain untested in the browser; see the scoped acceptance record above.
- [x] Investigate and fix empty-composer navigation warnings without removing safeguards. Memoized room args and optimistic read-marker callbacks stop repeated writes on unrelated renders. The regression fails against the old implementation; hosted navigation is clean and genuinely unsaved notes still warn.

**Exit gate:** the approved mockup's Working, Needs you and Completed flows are backed by persisted state; reload and cross-tab updates remain correct.

### Phase 4: Chief-only Slack adapter and migration

- [x] Build verified account linking and enforce sender authorization.
- [x] Move connection/channel controls to workspace settings; enforce Chief-only binding in the API.
- [x] Replace named-agent routing with canonical Chief admission.
- [x] Normalize Slack inbound messages into canonical turns and enable bidirectional parent messages.
- [x] Add durable delivery intents, echo suppression and receipt reconciliation.
- [ ] Migrate eligible connections with an admin-visible dry run and conflict report.
- [ ] Update setup documentation and check whether OAuth scope changes require reauthorization.

**Exit gate:** a separate development Slack app on the exact isolated PR Preview passes the web/Slack parity and authorization matrix. No production app is repointed for testing.

### Phase 5: Permissioned personal-Chief contributions

- [ ] Add explicit grants, private consent and revocation.
- [ ] Separate personal execution access from shareable contribution output.
- [ ] Support private follow-up questions without exposing private threads.
- [ ] Exercise cross-owner and cross-workspace negative tests.

**Exit gate:** the workspace Chief receives only the approved contribution, and neither it nor other parent participants can read private source data.

### Phase 6: Connected agents and additional transports

- [ ] Add capability-gated dispatch through the established connected-agent control plane.
- [ ] Preserve host ownership, cancellation, durable receipts and artifact access.
- [ ] Return an honest unsupported/unavailable state for ineligible agents.
- [ ] Implement each additional surface against the shared admission/delivery contract.
- [ ] Qualify platform-specific identity, audience, approval and threading behavior.

**Exit gate:** adding a transport does not introduce another planning, delegation or synthesis loop.

## 9. Migration, rollout and rollback

1. Ship additive schema/contracts and tests first.
2. Enable assignment creation and native web orchestration in an isolated preview.
3. Gate workspace Chief orchestration and Chief-only surface admission independently, while keeping one underlying execution engine.
4. Inventory old bindings by workspace, installation and channel. Resolve duplicate or conflicting bindings explicitly.
5. Keep old mixed group-DM history intact. Never guess assignment boundaries and automatically split historical conversations.
6. Preserve old surface threads under their original audience rules. Do not silently attach their entire history to the Chief.
7. Drain existing runs under their original admitted policy. For legacy threads, provide a link to a fresh Chief thread rather than rerouting subsequent messages invisibly.
8. After cutover, block new specialist bindings in both UI and server. Retire name-routing only after legacy work is drained.
9. Roll out to opted-in workspaces after isolated preview QA, then expand.
10. Rollback disables new admission or returns affected threads to read-only. It must not restore creator-based execution, broaden permissions, discard completed work or delete delivery receipts.

Production release follows the repository's main/preview and Convex safety rules. Customer production Convex is never deployed from this feature worktree. Schema cleanup happens only after old readers/writers and in-flight runs are drained.

## 10. Validation plan

### Required scenarios

| Scenario | Required result |
| --- | --- |
| Same request from web and Slack | Same canonical execution model and assignment structure |
| Same agent receives two distinct assignments | Separate threads, no unrelated context reuse |
| Duplicate webhook/tool dispatch | One turn/assignment/child launch |
| Worker dies after assignment creation | Existing launch intent is recovered, not duplicated |
| One child finishes, one blocks, one fails | Correct states; Chief requests input or reports exclusions honestly |
| Child revision arrives late | Old attempt cannot overwrite latest result |
| Parent cancellation races completion | No new child dispatch; consistent terminal state and accounting |
| Follow-up while working | Persisted and applied/queued without concurrent owner conflict |
| Slack post succeeds but acknowledgement is lost | Receipt reconciliation, no blind repost or model rerun |
| Slack is unavailable | Result survives on web; delivery failure is separate |
| Unlinked/removed sender or unauthorized approver | No privileged execution or approval consumption |
| Binding/channel/grant revoked mid-run | Sensitive tools and delivery revalidate and fail closed |
| Different workspace or restricted viewer | No conversation, sidebar, search, notification or artifact leakage |
| Personal Chief contributes | Only approved output crosses the boundary |
| Completed thread opened by one user | Only that user's ready indicator becomes reviewed |
| Narrow screen and keyboard navigation | Drawer, focus, names and status labels remain usable |

### Commands and checks for implementation

These are planned checks, not tests claimed to have run for this Markdown deliverable. Run the narrowest relevant suite after each phase, then the applicable repo/CI gates once for the completed change set.

Existing Node-test seams:

```sh
NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs npx tsx --test \
  src/server/agents/agent-asks/AgentAskService.test.ts \
  src/server/surfaces/SurfaceService.test.ts \
  src/shared/agents/agent-lineage.test.ts

npx tsx --test packages/overlay-agent-runtime/src/harness-state.test.ts
```

Existing Vitest seams:

```sh
npx vitest run \
  src/server/harness/native-named-child-launch.test.ts \
  src/server/harness/surface-access.test.ts \
  src/server/harness/surface-orchestration.test.ts \
  src/server/harness/surface-wait-delivery.test.ts \
  convex/surfaceBindings.convex.test.ts \
  convex/surfaceHarnessDelivery.convex.test.ts
```

Add focused assignment-creation, audience-policy, delivery-outbox and migration tests alongside those seams. Use the repository's active test configuration and setup documentation when executing.

Run targeted ESLint on changed code, `npm run typecheck`, `npm run check:shared-isomorphic` for shared contracts, and the relevant UI/package tests. Build and run the exact-head isolated preview for hosted acceptance. Document any pre-existing unrelated failures rather than hiding them.

Browser/Slack QA must cover: Agents parent thread, specialist assignment thread, Work projection, Workspace Settings > Slack, an authorized Slack channel and an unauthorized requester. Verify the preview's actual web SHA and its own backend before running.

## 11. Observability and completion

Correlate workspace, conversation, root/parent/child run, assignment/attempt, inbound event and delivery IDs without logging private message bodies or credentials.

Track admission failures by reason, stuck/queued assignments, child launch recovery, duplicate suppression, unresolved blockers, delivery latency/failure/unknown outcomes, cancellations and usage settlement. These are operational signals, not automatic grading of model answer quality.

### First-release definition of done

- A web or Slack task reaches the workspace Chief under the real requester's authorized scope.
- Delegated native specialists receive isolated, navigable assignment threads.
- The Chief durably follows through and returns one consolidated answer.
- Permissions survive delegation, waits, reloads and cross-surface continuation.
- PR 405 sidebar behavior and the approved mockup are reflected in the real app.
- Delivery retries do not rerun completed work.
- Legacy history remains accessible only to its original authorized audience.
- The security, failure-recovery and cross-surface acceptance scenarios pass on the isolated preview.

Personal-Chief grants, connected-agent dispatch and each additional adapter have their own release gates. Do not describe the entire workforce vision as shipped when only the first release is complete.
