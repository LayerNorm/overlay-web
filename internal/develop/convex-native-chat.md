---
title: "Convex-native personal chat"
description: "Reproducible realtime baselines, retained consumers, and migration security requirements."
---

Workflow stream transport behavior and provider-free regression coverage are
documented in [Convex and Vercel Workflow](./convex-workflow.md#workflow-stream-transport).

## CN-01 baseline protocol

### Parallel transcript reads

Web-first releases keep the old summary-gated request shape until the existing live `platform/uiSettings:mine` query advertises `personalChatParallelReadsRevision: parallel-reads-v1`. The query is already used by account synchronization, so identical subscriptions share Convex's query cache. Older backends never receive the new optional argument during rollout. Once the matching backend is synchronized after web deployment, the marker enables parallel reads. For rollback, revert the frontend optimization while retaining the additive backend argument for already-open clients. Do not remove that contract while cached clients can still send it; newly mounted clients without the marker use the legacy path.

The personal-chat hook requests `getSummary` and the first `getMessages` page together for a well-formed route ID. `getMessages` accepts optional `unavailableAsEmpty: true` for this route bootstrap: authenticated, capable workspace members receive an empty exhausted page for an inaccessible/deleted/non-personal conversation. Authentication, workspace membership and capability failures still reject, and callers omitting the option retain strict rejection. The hook does not expose rows, execution or stream subscriptions until the live summary matches the current conversation and workspace. Parallel loading is independent of the recent-transcript cache below.

### Recent-transcript cache and hover prefetch

`usePaginatedQuery` (convex 1.42) adds a per-instance pagination id to its first-page arguments, and `ConvexReactClient.query` unsubscribes after its first result. A hover query therefore cannot seed the destination's paginated hook or the room's `collaboration/rooms:state` subscription. Instead, `src/shared/chat/transcript-cache.ts` is a bounded in-memory cache (32 entries, 100 newest items per entry to match the backend page cap, 8 MiB estimated, 30 minutes) that the transcript hooks read first. Keys carry kind (`personal` or `room`), user, workspace, conversation and variant (a room stores its timeline and its live state as two entries). `TranscriptCacheScopeProvider` (mounted inside `PersonalChatProvider` from the signed-in user and active workspace) clears every entry and bumps a generation on logout, account switch or workspace switch; a prefetch result from an older generation is discarded.

- **Readers.** `usePersonalConversationTranscript` (chat route and note panel), `ConvexRoomMessageSubscription`, `useRoomTranscript` and `useRoomState` (DMs, channels, agent threads) paint the cached snapshot until their live query answers, mark it `restored`, and size the live first page to the snapshot's row count so the live page replaces it without a jump. The first live room page replaces restored rows rather than merging them. A live `null` summary/access/state evicts the entry and the transcript shows as unavailable. Cached data is display-only: every action still goes through an authorized mutation, and `loadMore` waits for the live query.
- **Write-back.** Each reader snapshots its live settled data and writes it back when the reader leaves the conversation, not on each streamed update.
- **Scroll.** `ChatMessageList` and `useRoomTranscript` save the first visible exchange/message and its offset (or "following the newest") on scroll, rAF-throttled, and restore it once on a revisit; a missing anchor falls back to the newest message.
- **Prefetch.** Chat and agent-thread sidebar rows call `useTranscriptPrefetchIntent` on pointer enter and focus; after 120 ms without leaving, `prefetchTranscript` issues one-shot queries only (personal: summary, then first page of 50; room: access, then state and first page), at most two at once, four queued, a 10-second slot timeout, and skips draft ids and snapshots under 20 seconds old. It never mutates and never leaves a subscription running.

### Directory rendering and agent navigation

Chat sidebar, archived indexes and route-scope probes consume `usePersonalChatDirectory`, not the transcript/execution context. Keep active/archived list values stable on stream-only updates, and publish genuine list, selection, access and command changes. Disabled and error-boundary paths must provide the same directory context contract.

Agent sidebar navigation uses the existing no-thread agent route when its live bundle has no eligible thread; the destination owns main-thread resolution and retry. Late results must not override a newer navigation intent.

In the current DoubleSidebar and UnifiedSidebar, DM/channel headers collapse their independent lists and individual room rows navigate directly with an ID. The legacy `buildChatPanelNav` room lookup is not a visible room-selection flow in these shells. Keep that compatibility path unchanged rather than adding destination-resolution machinery or new controls to justify a speculative optimization.

This harness measures the existing behavior, not a fix. A remote convergence
failure must remain a failing sample. Do not change an assertion to make the
baseline pass. CN-02 through CN-05 migrate auth, authorization, personal lists
and canonical history. CN-06 adds bounded durable progress checkpoints and a
scoped execution/lifecycle projection while retaining server-owned execution;
none is implemented by the harness.

CN-06 browser lifecycle reads use the public, viewer/workspace/conversation-
scoped `chat/personal:getExecution` projection. The browser does not replace
agent admission, billing, approval/input authority or streaming with a local
run cache. Native ownership is unconditional; an unavailable native query stays
unavailable rather than falling back to HTTP.

Use the isolated current-head PR Preview. Follow [Preview QA](./worktree-staging-qa.md)
to verify the READY deployment SHA and its exact PR-scoped Convex backend before
running. The SHA argument records that independently verified revision; the
harness does not verify the hosting control plane. Never use production or shared
development. The runner rejects noncanonical Preview origins.

1. Sign into the Preview with the existing sandbox credentials. Verify a paid-ready
   workspace and selected supported paid model before the send sample. A send is
   one real, billable QA inference. Do not change the model or retry a stalled run.
2. Create a disposable **personal** chat titled `CN01 QA <unique suffix>`, not an
   agent thread, DM, channel, or temporary chat. Complete its initial run first.
3. Save authenticated Playwright storage state outside the checkout with mode
   `0600`. This is a credential, never an attachment or committed fixture.
4. Run each scenario on a fresh disposable chat. Record the browser version,
   selected model, network conditions and cold/warm navigation separately. The
   runner creates two independent browser contexts with the same sandbox identity.

```bash
CN01_PREVIEW_ORIGIN=https://pr-123.preview.getoverlay.io \
CN01_PREVIEW_SHA=<verified-full-head-sha> \
CN01_STORAGE_STATE=<private-storage-state-path> \
CN01_CHAT_PATH=<relative-personal-chat-url-with-id-query> \
CN01_CHAT_TITLE='CN01 QA <unique suffix>' \
CN01_SCENARIO=send \
node scripts/qa/personal-chat-realtime.mjs
```

Repeat with `CN01_SCENARIO=rename` and `CN01_SCENARIO=archive` on separate fixtures.
Rename changes the disposable title; archive removes it from the active list.
Neither scenario automatically retries or cleans up, which would obscure the
measurement. Restore/archive these synthetic fixtures manually after inspection.
Set `PLAYWRIGHT_EXECUTABLE_PATH` only if using an existing Chromium installation.
The runner does not export cookies, prompt text, titles, IDs, headers, response
bodies, raw errors, screenshots, or traces. Its JSON is safe numeric/status evidence.

### What the numbers mean

| Field | Measurement | Limitation |
| --- | --- | --- |
| `queryReadyFromNavigationMs` | Navigation start to the personal Convex message query's first non-undefined result, including an empty array | Includes auth, navigation and automation overhead. Not a send acknowledgement or transcript paint. |
| `localFeedback.ms` | Before the Playwright click/key action to the expected local DOM visibility change | Includes actionability and automation overhead, not an exact hardware click or paint timestamp. |
| `mutationAcknowledged.ms` | Same start to a successful matching HTTP response for rename/archive | Client-observed acknowledgement, not isolated server execution time. Unavailable for send: streaming response headers do not prove persistence. Replace this observer when these mutations move to Convex. |
| `remoteVisible.ms` | Same start to the expected remote DOM visibility change without reload/refetch | Must be observed in the second independent context. The sender's optimistic row is insufficient. |

Each observer is armed before the action. All interaction elapsed times use one
runner monotonic clock, so clocks from different clients are never subtracted.
Unavailable/failed observations have `null`, never zero. The 30-second convergence
window is a timeout, not a performance SLO. Do not report a p95 from one run or
combine failures with successful latency samples. Run repeated samples explicitly
when percentile evidence is needed; preserve failures separately.

The query marker is bounded to the latest entry and exists only after the runner
installs `overlay:baseline:enabled`. It sends no telemetry. The observer is allowed
to receive a query result while still failing to display the remote user message:
that distinction is the original personal-chat defect. The send scenario waits
up to five minutes for the sender to leave generation and does not cancel/retry.
If generation does not settle, the sample records `generationSettled: false` and
the browser is retained rather than closing an active stream. Stop and inspect;
do not invoke another scenario while it is active. Setup failures emit only a
fixed `no-sample` status and phase, never an exception or private page text.

Query readiness is not sidebar readiness: the runner separately waits for the
fixture row before asserting uniqueness and selection. Sent-message observations
are scoped to `[data-chat-transcript]`, so an unsent composer draft cannot count
as local feedback. Rename/archive acknowledgements match the exact conversation and submitted
title/archive value; read cursors and unrelated writes cannot satisfy them.
Acknowledgement failures also fail the run.
Terminal correctness and reconnect/duplicate-run tests belong to CN-06.

### Thread and file opening

Use `scripts/qa/navigation-baseline.mjs` for read-only navigation in two independent
contexts. Set the same Preview, SHA and private storage-state variables as above,
then set `CN01_START_PATH` to a different personal chat (for thread opening) or the
Files list in list layout with its viewer closed (for file opening). Supply
`CN01_FIXTURE_NAME`, `CN01_RESOURCE_ID`, and `CN01_SENTINEL` for a disposable fixture.
Names and sentinel text must start with `CN01 QA `. Use a `.txt` file containing
exactly the synthetic sentinel, or an existing personal chat containing that
unique sentinel as one user message. No generation is started by this runner.

Run once with `CN01_SCENARIO=open-thread` and once with `CN01_SCENARIO=open-file`.
The fixture must not already be open. The two contexts each perform their own
navigation; this is not a remote mutation-convergence test. Samples separate:

- `localFeedback`: target sidebar selection or file viewer shell becomes visible.
- `readAcknowledged`: the matching target HTTP read fully completes successfully.
- `contentVisible`: the known synthetic message/file contents render.

These are DOM/automation timings, not compositor paint or isolated server CPU
times. Cached reads without an HTTP response remain `not-observed`, not a fake
zero-millisecond backend sample. Record cache conditions externally. All fixture
values stay private; emitted JSON contains only revision, scenario, status and
timings. This complements, rather than replaces, the query-ready measurement.

## Retained consumer and policy inventory

| Current path | Consumers / responsibility | Migration constraint |
| --- | --- | --- |
| `ConvexAuthProvider`, `native-convex-token-broker`, `/api/auth/convex-token` | Every browser query and mutation | Native identity only. The HS256 query-argument token was removed in CN-35. |
| `convex/auth.config.ts` | WorkOS custom JWT verification | Native provider config currently covers WorkOS, not every supported Overlay auth mode. |
| `src/server/auth/providers` and `bootstrap.ts` | WorkOS, OIDC, Better Auth; NoOp is unauthenticated | Preserve application user IDs and supported private deployments. Preview's sandbox login and native session handoff must be tested, not assumed to yield a WorkOS JWT. |
| `ChatInlinePanel.tsx`, `ChatArchivedView.tsx` | Chat and room lists, archived-chat reader (`/app/archived?id=`) | Native: `chat/personal:*`, `collaboration/roomList:list` and `collaboration/archive:rooms` (which can `include` a linked archived room by id). No HTTP list reads remain; a malformed `?id=` is treated as not found without querying. |
| `packages/overlay-api-client/src/chat/conversations-client.ts` | Shared public HTTP client, including native/external consumers | Do not delete public endpoints or the package when one web caller migrates. |
| `src/server/app-api` and `convex/chat` | Existing session, scope, admission, persistence and run orchestration boundaries | Port authorization and transactional policy, not just transport. Execution/provider calls need not move into Convex. |

Before any endpoint deletion, search every call site again, including desktop,
mobile, agents, scheduled execution and public SDK consumers.

`npm run check:native-architecture` (CI) enforces this inventory from the browser side. Every browser
`overlayAppClient.<resource>.<method>` call is listed in `scripts/baselines/browser-http-calls.json`. A new
browser HTTP call fails until it is native or added on purpose with its server reason in the PR (model runs,
stop/approval/input, billing, OAuth, email, validated or audited writes, provider calls, file bytes), and a
call that disappears must leave the baseline (`--update`). The check also rejects the retired provider
capability names and the HS256 browser token.

Native functions must derive the viewer from verified identity. Test another
user's resource IDs, missing/revoked membership, workspace switch, logout/account
switch, roles and participant scope. Preserve billing/admission, rate limits,
idempotency, audit attribution and operator/customer separation. No browser
function may receive a server secret or trust a supplied actor ID as authority.

### Native personal scope

The native viewer guard checks active workspace membership, personal ownership
and participant access. It excludes shared, agent, external and automation chats.
Legacy automation rows can reference a conversation without its `isAutomation`
flag, so the guard also checks nondeleted automation bindings using the additive
`automations.by_conversationId_deletedAt` index. Deleted bindings do not exclude
an otherwise eligible chat. Keep this index through rollout and rollback; no
document backfill is required. The scope helper is shared with the subsequent
personal-list migration rather than delaying this authorization rule until it.

### Native personal transcript

Native Convex owns the browser's personal-chat transcript, preference summary,
and initial user-turn write. The browser paginates canonical messages directly;
the existing scoped HTTP execution path remains responsible for provider
streaming, memory, billing, and server-side assistant persistence. Native submit
must pass the retired-thread write guard before reusing or inserting a turn.

Transcript pages are capped at 100 rows. Generated outputs are authorized with
`files.read`, capped at 100 per turn using a 101-row sentinel, and exposed only
through the existing authorized file-content URL. Missing or stale output
policy suppresses file metadata without suppressing text history.

### Unified durable public streaming

Every new root Harness run carries immutable `publicStreamVersion: 1`, in every
workspace including ones created later. The server-only
`OVERLAY_UNIFIED_STREAMING` variable is the kill switch: unset, empty or `on`
enrolls new roots; `off` (or any other value, so a typo fails toward the legacy
path) admits new roots on the legacy message-row path. Personal chat,
workspace-scope chat, workspace agents (rooms and work) and automations all
admit through `personalHarnessPolicy`. Child runs never inherit the version:
their policy is derived from the parent without it, and the stream writer
accepts only roots. Existing roots keep the publishing path recorded in their
admission policy when the environment changes, so flipping the switch never
moves an in-flight run. Rollback is setting `OVERLAY_UNIFIED_STREAMING=off` on
the web deployment and redeploying; Convex reads no setting.

The former exact-ID allowlist `OVERLAY_UNIFIED_STREAMING_WORKSPACE_IDS` is
retired and ignored; it cannot keep specific workspaces enrolled while the
switch is off. Delete it from deployments at any time.

The versioned path publishes filtered response text from the executor's secure
model boundary. It does not publish reasoning, child/summary/verification output
or raw tool payloads. Convex active output is provisional and distinct from
settled transcript checkpoints. Active rows are limited to one stream per root;
each segment is at most 8 KiB UTF-8 and visible text is capped at 160,000
UTF-16 code units without splitting a surrogate pair. Truncation is explicit.
Settling a transcript step atomically writes its checkpoint identity
`(runId, generation, receiptId, invocation)` and retires that invocation's
active segments. Every enrolled chat kind must settle through this projection
(personal and owner-only workspace-scope chats, automations, rooms and work);
a kind it skips keeps live text on screen beside the legacy progress copy.
Only chat deliveries share one turn id between the person's message and the reply;
agent threads (room and work) give the person's message its own turn id, so the
projection matches only the reply's turn there. Requiring both once skipped every
agent-thread reply, which then showed tool rows and only the latest sentence.
The browser places live stream text before the trailing tool rows that native tool
progress stores for the running call (they have no part `id`; settled transcript
parts do), so a sentence stays ahead of the tool it starts.

Every thread kind reads live text through one hook, `useLivePublicStreams`
(`src/components/providers/useLivePublicStreams.ts`), and projects it with
`projectActivePublicStreams`: personal and workspace chats, automation threads
(both through `usePersonalChatTranscript`) and agent threads, DMs and channels
(`ConvexRoomMessageSubscription`). It subscribes only while a reply is generating.
Reads are incremental: `chat/personal:activePublicStreamUpdates` and
`collaboration/rooms:activePublicStreamUpdates` take a cursor per reply (run,
generation, invocation and last segment index held) and return the segments from
that last, still-growing segment onward. The cursor carries no sequence, so it only
changes when a new segment starts: while a segment grows the reader keeps one
reactive subscription and each re-run reads that segment (an older client's
`sequence` is accepted and ignored). Readers wait for `uiSettings` before reading,
so they never switch from whole to incremental reads mid-reply. A cursor from
another run, generation or invocation is ignored and
the whole stream comes back; segments from another attempt are never returned. The
client joins segments in `src/shared/chat/public-stream-updates.ts`, keeps on-screen
text while a re-read loads or after a gap (and re-reads from the first segment), and
keeps object identity when a read brings nothing new. Both queries apply the same
viewer, run, delivery, checkpoint and generation checks as the whole-stream readers
(`readableActiveStream` in `convex/lib/publicStreamRead.ts`). The run's metadata
JSON is still parsed on each read: it is written from several harness paths, and a
denormalized copy that one path forgot would show a retried generation's stream.
Settled transcript steps store `hasOutput` and `outputLimitReached` beside their
JSON, so the continuation check no longer parses up to ten step snapshots per read;
older rows without the fields are still parsed. During a web-first rollout the hook
uses the incremental query only once `platform/uiSettings:mine` advertises
`livePublicStreamRevision: incremental-v1`, and reads whole streams before that. Keep
both whole-stream queries for already-open clients and server readers.

Model-step checkpoints can precede native tool execution and temporarily contain
the missing-result fallback. Final delivery reconciles only an explicit later
tool outcome for the same call ID and original receipt/step, updates that
checkpoint before delivery, and preserves its text, order and part IDs. Actual
errors and denials remain terminal; missing results stay errors or pending
approvals. Native result envelopes are unwrapped in both `content` and
`toolResults` before classification so explicit `success: false` remains an
error. The conversation trace reads these updated durable rows.
Stop does not read an actively written stream row in its initial mutation:
`cancelAgentRuns` cancels the exact authorized run and schedules
`settleTerminalAgentMessage` with the run id, terminal state, workflow id and
terminal update version. The settlement revalidates that identity before reading
retained text or cleaning streams, so a stale job cannot settle a restarted run.
Retrying Stop for an already-terminal exact run schedules the same idempotent
repair. Cancellation keeps partial text and adds the interruption notice;
completed replies remain completed, while failed replies retain their terminal
error diagnostic without an interruption notice. Targets without an authorized
run fail explicitly rather than being reported as success. Native delivery
settlement checks agent-authored replies against the run's agent principal;
personal chat/work replies without an agent principal remain bound to the run's
initiating user. Native delivery
finish does not call Stop reconciliation from its terminal snapshot: a retried
workflow could otherwise cancel a fresh run for the same message. If native
finish leaves a terminal run linked to a generating message, recovery is through
an authorized exact-message Stop; there is no automatic repair without that
targeted request. Finalize, failure and cancellation paths preserve safe partial
output where needed, mark the canonical message terminal, and perform bounded
cleanup; active rows are not retained as a second transcript.

Step text joins in one place, `src/shared/chat/step-text-join.ts`. Separate model
calls are joined with a blank line. A call that stopped at its output-token cap
(`finishReason: 'length'`) is saved with `outputLimitReached: true` on its
transcript step and keeps the whitespace it stopped on; the next call's text then
joins it directly and extends the same text part, so a cut-off Markdown list stays
one list. The settled checkpoint, final delivery, legacy progress copy, failure
and cancellation settlement all use this rule, and the active-stream readers
return `continuesPrevious: true` so the live projection joins the same way. Workspace-agent
and room deliveries that stream straight into the message get the same rule: the
model ports pass `continuesPrevious` into native preparation, which sets
`continuesPreviousOutput` on the dispatch so the delivery stream skips its
paragraph break. Work (a tool call) between the calls still starts a new block. Steps saved before the
flag existed keep the blank-line join.

The continuation call must see what the cut-off call wrote. `@ai-sdk/workflow`
ends its loop on `finishReason: 'length'` without adding that response to its
message history, so the harness runner (`withCutOffResponse` in
`src/server/harness/runner.ts`) appends it as the last assistant message, followed
by a user message asking to continue from the exact character where it stopped.
The working state's `unverifiedNarrative` names the response's real ending
(`cutOffResponseNarrative`), never its opening excerpt, because the model treats
the working state as authoritative and would resume from where that excerpt ends.
The continuation instruction asks the model to start with the next space or
punctuation when the cut fell after a complete word; models otherwise often drop
the leading space and run two words together.

`compactAssistantPersistenceForConvex` lets the final answer text part use the whole
180,000-character part-text budget (other text parts keep the 80,000 cap), because
continued calls are joined into one part and a single 32,000-token call can exceed
80,000 characters.

Per-call output limits come from `harnessOutputLimits` in
`src/server/harness/model-ports.ts`. Personal chat and workspace agents request
32,000 tokens per model call; 32,000 is also the default when neither the request
nor the catalog names a maximum. The working context is the model's real context
window from the catalog (200,000 tokens when the catalog does not know the model,
such as BYOK and subscription models). Compaction runs only as the prompt approaches
that window and reserves up to a quarter of it for output; the response is bounded
by the model's own output maximum. Thinking tokens count against the same limit, so
a reasoning model needs room for both. A reply longer than one call continues in the
next call as described above. `HARNESS_PREVIEW_CONTEXT_TOKENS` is a Preview-only QA
hook that shrinks the working context for one test user to exercise compaction.

A settled transcript step is never refused for its size. `harness/runs:writeTranscriptStep`
stores a shortened copy (`compactTranscriptSnapshot`, at most 240 KiB) so the row
fits Convex's document limit; the full step is uploaded to file storage first and
linked by `fullPersistenceStorageId`.

Thinking is not carried into the next call. If a call reaches its limit having
produced only thinking (the provider-reported reasoning tokens cover all but a few
output tokens), `harnessReasoningSetting` runs the continuation with
`reasoning: 'none'` so it writes the answer instead of thinking from scratch again.

The web chat and the Notebook assistant send `liveTransport: 'convex'` on native
personal Act requests.
For an admitted versioned run the response then carries only `start`, the
`harnessAccepted` run identity (with `liveTransport: 'convex'`) and source
citations, and finishes at once, so no function stays open relaying text. The
client renders the reply from Convex like every other thread, merges only that
metadata into the saved row (`personal-transcript.ts`), and completes the turn
(session, unread notice, first-turn activation, subscription refresh) when
`chat/personal:getExecution` reports the run terminal (`waitForNativePersonalTurn`);
a failed run reports "The durable run failed." as before. The Notebook assistant
sends on the note's own personal chat (client id `notebook:<noteId>`, found with
`chat/personal:getByClientId`), waits for the same execution settlement, and renders
the note conversation in its side panel through `EmbeddedPersonalTranscript`, which
reads with `usePersonalConversationTranscript` (the route-free half of the chat
route's read) and projects rows with chat's `personal-transcript` and
`toChatTranscriptView`. Runs that are not admitted on the versioned path keep
streaming over the response. Requests without the field, such as Act retry and
public API callers, keep the SSE adapter: the request remains pending until the durable root's
authoritative Convex state is terminal. That adapter reads the same persisted
active stream and settled transcript steps, including source metadata and
ordered tool-part metadata; it never forwards a losing Workflow handle or raw
SDK output. It reads only the stream projection rather than repeatedly loading
the full root snapshot. Runs without `publicStreamVersion` retain their
existing transport/projector. Automation-thread replies are admitted with
`personalHarnessPolicy`, so they carry `publicStreamVersion` 1 when unified streaming
is on and render through `usePersonalChatTranscript` like any chat. The automation
run viewer (`run-viewer-hooks.ts`, `/api/v1/automations/[id]/events`) shows workflow
step status, not reply text, so it has no live reply to move. Rollback is therefore an enrollment change, not
a mid-run protocol switch.

Stream timing fields are local monotonic measurements: provider-first-text is
measured within the executor process and publish-ack within the publisher.
`model_dispatch` is recorded immediately before provider invocation, so
provider-first-text includes provider setup. Browser `receive_to_next_frame_ms`
measures receipt to the next scheduled animation frame, not a confirmed DOM
paint. Authorization, context, history, tools and admission spans use a local
monotonic clock. Do not subtract clocks from different hosts or infer
p95/baselines from unrepeated samples. Output size is reported in characters,
not tokens. Logs and telemetry must never include prompts, generated text or
credentials.

`nativeSubmittedAt`, `userMetadata`, `conversationMessages.by_conversationId_turnId_role`,
and `files.by_userId_conversationId_turnId` are additive. Roll back browser
ownership before removing any of them; keep the fields and indexes through
rollout rollback, with no backfill requirement.

### Which chats are native

Every AI chat rendered by `ChatExperience` is native: personal chats, chats filed under
Workspace, and automation threads. They are owner-only, so "Workspace" is where a chat is
filed, not a sharing rule. `nativePersonalChatScope` allows the owner and reports `kind`.
It excludes agent threads, DMs, channels and external surfaces, which keep their own rules.
`chat/personal:list` takes the sidebar scope and never returns automation threads. Personal
chats do not show workspace-filed outputs; workspace and automation chats do.

| Operation | Path | Why |
| --- | --- | --- |
| List, transcript, run state, send, rename, archive, read, delete turn, branch, generated UI edits, media notes | Convex `chat/personal:*` | Shared state, updates every client |
| Model execution | `conversations/act` (admission; live text from Convex) | Server work |
| Stop, approval and input response | `conversations/stop`, `run/approval`, `run/input` | They abort provider calls and resume durable workflows; status returns through `getExecution` |
| Title generation, image and video generation | `generate-*` | Provider calls |
| Permanent delete of an archived chat | `v1/conversations` DELETE | Moves with unified archive, CN-33 |
| Chat-link type and scope check | Convex `chat/personal:getSummary`, then `collaboration/rooms:scope` | Native; a link to a room opened on the personal route moves to the room's view |

Temporary chats are local and unsaved. A failed native operation shows an error and never
falls back to HTTP. Public `v1/conversations` routes stay for API and agent callers.

### First turn and chat opening

A native first turn publishes `?id=` as soon as `chat/personal:submit` returns, while
its stream still owns the pending runtime. `useChatRouteController` must not load
that ID until activation, or it would tear down the running stream. Reload then
reopens the durable chat, and the server finishes the accepted run.

Titles are still generated from the sending client. If that client goes away during
the first turn, opening the settled chat retries once per tab. Two tabs can both
retry; the last rename wins.

Rows returned by `chat/personal:list` or `getSummary` are already authorized, so
they skip `startConversationDetailScopeProbe`. The probe remains for unknown IDs,
workspace chats and rooms, and it unmounts the chat surface until it finishes.

## Local checks

```bash
node --test scripts/qa/realtime-baseline.test.mjs
npx eslint scripts/qa/realtime-baseline.mjs scripts/qa/realtime-baseline.test.mjs scripts/qa/personal-chat-realtime.mjs src/features/chat/lib/realtime-baseline.ts src/features/chat/components/chat/useLiveConversationSync.ts
npm run typecheck
```

Unit tests validate timing semantics, privacy-safe failures, origin guards and
context isolation. They are not evidence that live multi-client synchronization
passes. Attach actual Preview results and distinguish expected baseline failures
from later migration acceptance.
