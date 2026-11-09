---
title: "Convex-native personal chat"
description: "Reproducible realtime baselines, retained consumers, and migration security requirements."
---

## CN-01 baseline protocol

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

New root Harness runs may carry immutable `publicStreamVersion: 1` when their
workspace ID is an exact entry in the server-only
`OVERLAY_UNIFIED_STREAMING_WORKSPACE_IDS` comma-separated allowlist. Empty is
disabled; `*` is not a wildcard. Personal, workspace-agent and automation
admissions use the same policy helper. Existing roots keep the publishing path
recorded in their admission policy when the environment changes; removing an ID
stops future enrollment but does not switch an in-flight run.

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
Cancellation never reads the live
stream rows (that races the executor's writes and fails Stop): `cancelAgentRuns`
cancels the run, then the scheduled `settleCancelledPublicStream` keeps the
retained text and retires the rows. Finalize, failure and cancellation paths preserve safe partial
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
32,000 tokens per model call. Compaction still reserves a quarter of the
working-context budget for output, but the response is bounded by the model's own
output maximum and by the space left in its real context window after the working
budget, not by that reserve. Thinking tokens count against the same limit, so a
reasoning model needs room for both. A reply longer than one call continues in the
next call as described above. Larger limits raise each call's spend reservation;
unused reservation is released when the call settles.

Thinking is not carried into the next call. If a call reaches its limit having
produced only thinking (the provider-reported reasoning tokens cover all but a few
output tokens), `harnessReasoningSetting` runs the continuation with
`reasoning: 'none'` so it writes the answer instead of thinking from scratch again.

The native personal Act request remains pending until the durable root's
authoritative Convex state is terminal. Its SSE adapter reads the same persisted
active stream and settled transcript steps, including source metadata and
ordered tool-part metadata; it never forwards a losing Workflow handle or raw
SDK output. It reads only the stream projection rather than repeatedly loading
the full root snapshot. Runs without `publicStreamVersion` retain their
existing transport/projector. Rollback is therefore an enrollment change, not
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
| Model execution and streaming | `conversations/act` | Server work |
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
