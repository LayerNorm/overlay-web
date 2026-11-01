# Long-running harness reliability and video-delivery implementation plan

Status: Implementation in progress. Application changes are being developed on `codex/long-running-harness`; no acceptance run has passed yet.

## Implementation progress

Latest resource checkpoint: inactive backend foundation `3976bf289` passed 24 CI checks, with 3 skipped and none failed or pending. Exact-head Preview `dpl_GjBaid1EQDB9dewTzVmMku4a6UK5` is READY at https://pr-362.preview.getoverlay.io; its backend identity has not been independently reconfirmed. Follow-up `5b69caa1f` adds the standalone approved card and resource-scope/suspended-wait tests. All nine Convex cases passed across the initial run and focused fixture correction, and six card tests plus direct TypeScript, targeted ESLint, shared-isomorphic and complexity checks passed. Follow-up CI is pending. No resource flow has been enabled or verified in the live app.

Earlier approval-resume checkpoint (`febdacb14`): CI settled with 25 passed, 0 failed/pending, and 2 skipped (Paid Gateway Canary and Mintlify Deployment). Trusted controller `41266231405` reported exact-head READY deployment `dpl_DyQdyxiQYhuQ4eQ5G8VAjNoqM1Px` on isolated `pastel-crane-401` at https://pr-362.preview.getoverlay.io. The initial Vercel deployment-source block was resolved by the trusted Preview controller without a code or configuration change. No hosted feature acceptance is claimed. The earlier `77a2fc67` checkpoint below records prior-head evidence only.

Approved resource-pause design (live wiring incomplete): `internal/plans/mockups/harness-resource-pause-mockup.html` shows a small confirmation card for a cumulative Overlay-funded model spending limit or an explicitly bounded time authorization. The mockup uses fictional amounts and simulates approval, keep-paused, revoked-access and stale-request outcomes. The user approved the shadcn design; the standalone application component and inactive backend foundation now exist, but live request creation, delivery and resume remain unconnected. Routine renewable execution leases must not ask for new spending permission or extend explicit time limits. See Workstream B's implementation contract below.

Current verification checkpoint (`77a2fc67`): all 25 required/reported passing checks are settled, with zero failed or pending checks and two skipped checks. Trusted Preview controller `41264717788` and deployment `dpl_Eo3f4mnQ6LMKtrroSsjLdfvAAKSL` are READY for the exact head on isolated `pastel-crane-401`. The next publication attempt stopped in preflight without inference: the stored Preview-named diagnostic key is development-scoped and was not used remotely, and an isolated Preview server-secret reference was unavailable. Current route quarantine/eligibility therefore remains unknown, not assumed healthy or quarantined. No route was reset, no alternative backend/model was substituted, and no file was manually uploaded. Hosted publication and the final video gate remain unchecked.

Lifecycle investigation checkpoint: normal input, approval and stagnation waits suspend inside Workflow hooks; they do not ordinarily return a nonterminal result to `blocked-finalization`. The remaining concrete gaps include budget blockers returning `outcome: 'blocked'` to wrappers that convert them to failure, and wait deadlines throwing fatal errors. Changing the wrappers alone would leave a task without a live wake condition. The next lifecycle implementation must couple an explicit resumable authorization pause with an authenticated renewal and wake path, preserving spending limits and outstanding usage holds. Renewable execution ownership and replacement-worker reconciliation remain separate open work.

Approval-resume authority correction (local verification complete): the approval callback now uses the request workspace for its owner lookup, rejects mismatched workspace rows, and revalidates room participation even when the caller created the room. This matches the input-resume boundary and prevents a durable approval from being resumed after room membership is revoked. Regression cases cover revoked room-creator approval/denial, cross-workspace personal callbacks, and valid current room participation; existing legacy personal and native Slack paths remain covered. Local verification passed: the focused approval/input/agent-authority Node tests passed 19/19; targeted ESLint passed; direct TypeScript compilation passed; shared-isomorphic checks passed for 214 modules; and web-complexity passed with 46 complex functions and 0 exact duplicate groups. This does not complete authorization renewal or lifecycle recovery.

- [x] Revalidated canonical main and created an isolated feature worktree from `80f17d148`; preserved newer approval-outcome persistence fixes.
- [x] Inspected native dispatch, continuation, compaction, waits, delivery, and Computer/FileService transfer boundaries.
- [x] Initial recovery slice: separate compaction from stagnation, provide bounded recovery before a durable input wait, and expose actionable tool-validation details. Focused runtime, runner, Convex wait, generated-UI, and serialized validation tests passed. Direct TypeScript compilation passed; the repository typecheck command remains blocked by unrelated desktop integration checks. This slice does not complete provider recovery, deadline renewal, or the hard cutover.

Implementation note (initial recovery slice): the runner now owns the six-segment recovery bound and routes the resulting stuck blocker through the authenticated input wait; compaction checkpoints remain additive housekeeping and cannot pause a run. This note does not mark any broad plan phase complete.

Binary Computer publication correction pass (local verification complete; hosted/final acceptance pending): the controller now uses the configured FileService boundary and checks the caller's actual actor/workspace before manifest or Computer access. It refreshes publication authority after reconciliation before snapshotting, before every scoped URL, and after streaming readback before commit; maps allowlisted failures to safe messages with explicit retryability; and treats post-commit Computer cleanup as best effort. The effective first-version artifact limit is `min(configured direct-upload limit, 100 MiB)`; multipart is not supported. Convex prepare rejects input/snapshot MIME mismatches, and destination checks reject dangling folder ancestors. Real FileService tests use a local binary HTTP surrogate for signer parameters, streamed checksum/final-authorization behavior, and lost commit-acknowledgement reconciliation. Verification: the Convex publication pair passed 10/10. The focused controller/authority/service unit tests passed together in one clean run: 3 files, 19/19 tests. TypeScript passed; the requested two-file ESLint check passed with 0 errors and no warnings; shared-isomorphic passed with 214 modules; web complexity passed with 46 complex functions; `git diff --check` passed. Local surrogates do not verify hosted transfer or live R2 checksum compatibility. The complete supplied `ui-motion-film` skill bundle remains absent: searches of the supplied attachment, repositories, attachments, and installed plugins found none of `film.html`, `dots-film.html`, `seam.mjs`, `analyze_track.py`, or `overlay-launch-case-study.md`; no replacements are being invented. Hosted binary transfer, live R2 checksum compatibility, durable Computer/render jobs and leases, multipart, authorization renewal beyond the admitted lineage deadline, and one-run video/File acceptance remain open.

Personal delivery checkpoint (local verification complete; hosted/final acceptance open): personal response fallback no longer includes `workingSummary`; explicit result summaries and prior step text remain eligible, so internal continuity notes cannot substitute for a user-facing answer. Regressions cover failed, cancelled, and completed deliveries with no answer, and preserve an actual assistant answer when a checkpoint summary is present. The requested delivery unit suite passed 3 files / 31 tests; targeted ESLint on `personal-delivery.ts` and `personal-delivery.test.ts` passed; direct TypeScript checking passed. This narrowly changes personal delivery selection; broad recovery, hosted behavior, and final video/File acceptance remain open.

Free-summary unknown-hold correction (local verification complete; reconciliation/hosted/final acceptance open): a previous `releaseFreeSummaryFailure` catch fabricated zero-cost `summary_failed` receipts for failed free-model summaries, including ambiguous provider outcomes. The helper and catch are removed. On ambiguous `openrouter/free` and `overlay-free` summary failures, tests verify the zero-cost reservation remains, no receipt is recorded, no usage is settled, no response fallback starts, and only one provider call occurs. Settled-summary and typed-rejection retry behavior is unchanged, as are the persisted `summary_failed` union and fallback guard for compatibility. The focused summary filter passed 12 tests (10 skipped); the four-file summary/recovery/ports suite passed 41 tests; targeted ESLint, direct TypeScript, and web-complexity checks passed (46 complex functions). No reconciliation path, hosted behavior, or final video acceptance is claimed.

- [ ] Unified native admission and complete legacy runner retirement.
- [ ] Durable lifecycle/retry/authorization extensions and truthful status projection.
- [ ] Computer jobs, skill materialization, and verified binary artifact publication.
- [ ] Complete skill bundle located and available to the acceptance agent.
- [ ] One-run video creation and Overlay Files delivery acceptance.
- [ ] Multi-day/deployment qualification and final release gates.

Terminal free-receipt safety correction (local verification complete; reconciliation/hosted/final acceptance open): the router can forward terminal output with an unsafe or missing cost verdict, but Harness usage capture previously discarded that verdict and catalog pricing treated the free model ID as zero cost. Usage capture now carries only the trusted router's explicit `safe: true`, numeric-zero verdict, and settlement requires that evidence for the matching free-model dispatch. Unknown or contradictory outcomes fail closed before billing or receipt recording; catalog pricing and Gateway lookup cannot replace the missing evidence. Paid and BYOK paths remain separate. The focused verified/unconfirmed/free-router-marker filter passed 7 tests (22 skipped); the combined model-usage/settlement/personal-ports/recovery suite passed 61 tests; targeted ESLint, direct TypeScript, web-complexity (46 complex functions), and `git diff --check` passed. This prevents another unsafe hold release but does not reconcile an already ambiguous provider outcome, implement full reconciliation, or prove the earlier hosted failure's precise cause. Hosted behavior and final video/File acceptance remain open.

Latest preceding-head CI checkpoint: `1e2caa1c86f0c7cca6df9d74177f3440654f6190` passed 25 checks with no failures or pending checks; Paid Gateway Canary and Mintlify Deployment skipped. An unchanged Windows Agent Host cleanup test failed with EPERM and passed a targeted job rerun without code changes. Trusted Preview controller `41262403160` reported exact-head READY deployment `dpl_CdLTLvZTBzkHvLzvr3QYQ3qKuB2P`, isolated `pastel-crane-401`, at `https://pr-362.preview.getoverlay.io`. No hosted feature pass on this revision is claimed.

Checked items record completed work only. The detailed acceptance checklists below remain unchecked until verified.

Terminal OpenRouter lookup correction (local verification complete; hosted/final acceptance open): entirely missing terminal cost evidence can now use the existing bounded exact-generation lookup before route settlement, for streaming and non-streaming output. The path requires a live owned zero-priced OpenRouter route lease with enough remaining time, an unambiguous generation ID, and an authoritative zero-cost non-BYOK response. Invalid, partial, contradictory or nonzero metadata cannot use this recovery; nested upstream inference costs count as charge evidence. Cancellation, quarantine and lease expiry remain fail-closed. Runtime settlement now requires a successful backend acknowledgement instead of ignoring a late or missing acknowledgement. Allowlisted receipt codes and transport are logged without weakening reason/key redaction. Local verification passed: focused filter 5/5; complete policy/router/generation-cost suites 72/72; Harness model-usage/settlement suites 29/29; targeted ESLint after removing an unused stream logger import; direct TypeScript; shared-isomorphic checks (214 modules); web-complexity check (46 complex functions); and `git diff --check`. This does not reconcile previously quarantined routes or reservations after worker loss, nor establish the original hosted failure's cause. Hosted publication, complete skill availability, full durable reconciliation, and one-run video acceptance remain open.

Hosted binary qualification failure on `4a2e4137` (isolated Preview, no publication acceptance): conversation `s97bmxkxzm4xhkak6k0shwaky18hdtsw`, delivery run `r57fwxv2d4h82k0mcpw0bnvgyd8hc5fb`, workflow `wrun_41M6AAHTWT0GQQ7K8D2CQH27PB`. Authenticated run and message reads confirmed `harness_failed` with `overlay_free_no_eligible_route` after zero SDK step retries. The same workflow request logged an unsafe provider receipt with null cost approximately three seconds earlier; its detailed reason was redacted, so the precise receipt defect is not established. No MP4 publication or Files ID was returned. The test did not manually upload or continue the task. Existing router quarantine remains intact. A correction now distinguishes confirmed no-inference route unavailability from ambiguous inference: only the typed no-inference result can create a zero-cost `route_unavailable` receipt and enter existing persisted exponential backoff. Response and summary recovery continue to preserve ownership checks, cancellation and the admitted deadline, but an earlier summary-failure catch fabricated zero-cost `summary_failed` receipts for ambiguous free-model outcomes and could release an unresolved usage hold. That `releaseFreeSummaryFailure` helper and catch have been removed; ambiguous summary failures now leave the reservation unresolved. This is not reconciliation: unresolved summary usage still requires a separate reconciliation path. Paid/BYOK and typed-rejection protections remain unchanged. Local verification passed: focused router classification tests 2/2; the four Harness runtime/rejection/recovery/ports files 33/33; focused Convex route-filter tests 2 passed (28 skipped); complete router and runtime-state suites 84/84; full `harnessRuns.convex.test.ts` 30/30; all changed TypeScript files passed ESLint; shared-isomorphic checks passed for 214 modules; web-complexity check passed with 46 complex functions; and direct TypeScript checking passed. TypeScript first exposed that `route_unavailable` without durable retry metadata could reach model fallback; an explicit fail-closed guard was added and its `model-ports.test.ts` rerun passed 4/4. This does not claim restored provider availability, hosted publication, reconciliation of the unsafe receipt, beyond-deadline renewal, or final video acceptance.

Current UI slice: personal and room read-only footers, fresh send/retry and room-send admission, delete/generated-UI mutation guards, structured-error invalidation, accepted-send/draft handling, pending-collaboration restoration, and bounded editable fresh-thread handoffs are implemented. Compatibility response observation is limited to mutation methods so a structured unavailable GET cannot recursively trigger another compatibility GET; POST diagnostics remain covered. The approved `internal/plans/mockups/native-thread-footer-mockup.html` remains the design reference.

Verification for this slice: the new `chatTransport.test.ts` and `generated-ui-mutation.test.ts` cases passed in the prescribed grouped run. The mounted interaction test required the documented `register-style-noop.cjs` loader because Node otherwise parses KaTeX CSS as JavaScript; its focused rerun passed 6/6. Together the three new test files passed 10/10 cases across those runs. The prior focused native-safety, handoff, API-client, room-view, pending-message, and footer set passed 50/50. `npx tsc --noEmit --pretty false` passed; targeted ESLint passed with 0 errors and 4 warnings (unused declarations and an existing hook-dependency warning); `npm run check:web-complexity` passed with 46 complex functions and no new over-threshold function; `npm run check:shared-isomorphic` passed with 212 modules; `git diff --check` passed. Mounted tests now cover stale scope/unmount, independent room/root safety with bounded unavailable retries, rejected preflight draft preservation, duplicate-send prevention, newer draft/attachment retention, nested draft ownership, pending-message restoration, and server-first delete rejection. The mounted test runner emits React renderer deprecation notices and one non-failing `act(...)` warning. Browser visual interaction and hosted verification remain open; the read-only UI acceptance item and broader workstream are not complete.

Hosted QA subsequently reported a retired personal-history Generated UI card where Edit changed the displayed body locally after Save edits; no save API was observed, so a persistence failure is not established. The correction adds explicit read-only propagation through personal and room assistant transcript paths, requires a persistence callback before offering Edit, and restores the authoritative part while cancelling pending local writes when read-only safety changes. Mounted regressions passed 5/5 in `GeneratedUiCard.test.tsx`, 2/2 in `ChatMessage.test.ts`, and 1/1 in `generated-ui-mutation.test.ts`. The first grouped run exposed a missing `window.matchMedia` shim in the mounted transcript test; after adding it, only `GeneratedUiCard.test.tsx` was rerun and passed 5/5. Targeted ESLint and `npx tsc --noEmit --pretty false` passed; `npm run check:web-complexity` passed with 46 complex functions and no baseline change; `npm run check:shared-isomorphic` passed with 212 modules; `git diff --check` passed. React Test Renderer emitted its deprecation notice. Hosted/browser acceptance remains unchecked; the reported local-only edit does not establish a backend persistence failure.

Hosted follow-up on the exact `7092fa6a` build confirmed the retired personal Generated UI card was immutable and its original server body remained unchanged. A subsequent generic New thread handoff removed the conversation ID from the URL but left the Loading conversation skeleton visible. Investigation found `syncStandaloneChatUrl` passed `window.history.state` to `replaceState`, including Next's `__NA` marker; the installed App Router's native-history wrapper can bypass URL-to-`useSearchParams` synchronization for that state. The local fix passes `null` state as prescribed in the installed Next.js Native History documentation. A mounted route regression verifies null history data, cleared active ID, and an empty hydrated runtime with an ID-free URL. The requested focused route/native-thread test command passed 7/7; after moving test-hook capture into `useEffect` to satisfy Hooks lint, the route test passed again 1/1. Targeted ESLint on both changed files, `npx tsc --noEmit --pretty false`, and `git diff --check` passed. React Test Renderer emitted deprecation notices, and the existing native-thread suite emitted a non-failing `act(...)` warning. The handoff still requires hosted/browser confirmation; full hosted acceptance remains open.

The hosted checkpoint on `508293ed` verified personal and named handoffs, immutable retired cards, independent room-root/thread scopes, and mobile themes. The real personal New thread handoff no longer showed the loading skeleton. Separately, the stale run-metadata simulation remained partial because a live update displaced the injected metadata; send/inference were not run. A room-unavailable → Retry simulation then showed the composer blank. Normal typing intentionally updates the editor and `inputRef` without refreshing React input state; when safety unmounts the editor, a remount can receive the stale state value. The local correction publishes the latest ref when `useComposerTextState` is suspended, wired to room read-only state and personal `nativeThreadSafety.readOnly`. The filtered mounted restoration regression passed 1/1, and the requested composer-state/native-thread suite passed 11/11; it exercises normal `onComposerInput` typing, read-only suspension/recovery, and no send while blocked. Targeted ESLint found a synchronous state-in-effect violation for this intentional synchronization; a scoped, reasoned suppression was added and the failing `useComposerTextState.ts` lint subset passed on rerun. The other changed TS/TSX files had no lint errors and four warnings (unused declarations and an existing hook dependency). `npx tsc --noEmit --pretty false` passed; `npm run check:web-complexity` passed with 46 complex functions and no baseline change. A hosted rerun of the room draft case remains pending; the stale-loading case remains partial, and broader Harness acceptance, send/inference, and the video-delivery gate remain open.

Hosted room recovery passed on exact `3a1b3645710d5c67ef868819868f0ac29468c948` (READY `dpl_8dP318RyKuEccnrictnPJmFi99X9`, isolated `pastel-crane-401`): ordinary typed text survived simulated compatibility unavailability and Retry exactly, remained editable and unsent, and the real nested retirement footer returned independently. Real personal retired-to-fresh handoff again showed editable context without a loading skeleton. No inference or transcript mutation was observed. Generic personal suspension was not exercised because the unsent fresh handoff has no server conversation ID; stable stale-run-metadata simulation remains partial. One nested GET returned 401 during navigation away, without a captured response body; subsequent authenticated requests succeeded and its cause is unverified. Exact-head CI passed 22 checks with Paid Gateway Canary skipped. These results complete the implemented read-only/handoff UI slice, not deployed-worker drain, tool-effect authority, durable recovery, or video acceptance.

Runner model-recovery prefix checkpoint: the installed workflow stream calls `onStepEnd` after tool results are appended, and the next `prepareStep` receives the complete prefix; a thrown stream's `onEnd` can fall back to the original prompt. The runner now snapshots non-system prompt messages and completed steps at each `prepareStep` boundary, then restores that settled prefix only after `recoverModelFailure` succeeds. The failing call's partial output remains excluded; retry policy and usage reconciliation are unchanged. The focused `model recovery preserves|recovered stream failure` tests passed 2/2, and the complete runner test file passed 41/41. Targeted ESLint on `runner.ts` and `runner.test.ts`, `npx tsc --noEmit --pretty false`, and `git diff --check` passed. The LOC-gate follow-up moved the failed-evidence summary and stuck-question builder into `context.ts`, passing the existing stagnation threshold as the continuation count without changing sanitization, wording, order, or limits. `prepareToolDefinitions` and the control-tool replacement guard moved into `tool-definitions.ts`. `runner.ts` is now 498 lines (`wc -l`). The requested filtered runner tests passed 6/6 (35 skipped), `context.test.ts` passed 7/7, targeted ESLint and `npx tsc --noEmit --pretty false` passed, and `npm run check:web-complexity` passed with 46 complex functions and the existing baseline unchanged. Broader recovery/backoff, worker drain, and video acceptance remain open.

Settled-response recovery checkpoint: charged receipts now preserve `empty_response`, `provider_error`, and `provider_other` observations with bounded 5/10/20/40/80/160/300-second retry metadata, while free route-capacity and interruption receipts use the same durable state without releasing unresolved usage. The reducer/reload regression verifies attempt-one persistence, the five-second next retry, reservation release, duplicate receipt idempotence, accounting, and reset after the next usable response. Model-port routing now sends persisted attempt-three-and-later recovery through the durable waiter while retaining the legacy two-attempt fallback only for snapshots without recovery metadata; classifier coverage excludes valid text/tool calls, content-filter, and length finishes, and keeps charged response failures out of rejection or fabricated zero-cost paths. Web admission preserves `harnessRevision: 'overlay-harness-v1'` and requires the additive server-owned `harnessModelRecoveryRevision: 'settled-retry-v1'`; old, missing, and unknown recovery markers remain unavailable. The focused settled/recovery filter passed 11/11 targeted tests after the server-only test shim was added, the focused Convex readiness/recovery filter passed 2/2, the final relevant unit sweep passed 120/120 (10 suites passed 78/78 plus the runner's 42/42), the full `harnessRuns.convex.test.ts` passed 28/28, and route characterization passed 16/16. Targeted ESLint and `npx tsc --noEmit --pretty false` passed; the complexity gate passed with 46 complex functions and the existing baseline unchanged after mechanical helper extraction, `runner.ts` is 488 lines, and shared-isomorphic checks passed for 212 modules. No paid 429/5xx uncertainty, summary repair policy, renewal, worker drain, UI projection, hosted acceptance, or final video gate is closed by this slice.

Owner: Overlay native harness

The settled-response recovery head and its durable-capacity test correction passed all 22 GitHub checks (Paid Gateway Canary skipped). Trusted controller run `41244955792` published exact `523afb4ff587eb3f9955868387c4d7a3800367e2` as READY `dpl_7vUi1b3S6DLCwu8fFmcd9RpfKhZj` on isolated `pastel-crane-401`. This is compilation/backend-isolation evidence, not a browser pass of recovery behavior.

Failure-display slice in progress: native `failAgentRun` atomically projects a bounded, redacted terminal error part (code, message, retryable, run ID and failure time) into the failed transcript without replacing partial prose. Personal and room readers use that part rather than infer a cause from assistant content; unknown historical failures have an explicitly unknown reason. Personal historical turns retain their error notice, persisted failure overrides stale streaming state, and an explicit non-retryable flag removes the retry action. The schema change is additive; old backends emit no new part and new readers fall back safely. The focused display/message/API tests passed 34/34 and the three Convex suites passed 8/8; the added generic-token and client-secret redaction cases then passed 2/2. Targeted ESLint reported no errors and one unused-parameter warning in `packages/overlay-chat-core/src/messages.ts`; TypeScript, web complexity (46 complex functions), shared-isomorphic (213 modules), and diff checks passed. Hosted checks and browser acceptance of this display slice remain pending. Existing terminal classification/retry flags, live model-recovery status projection, broader provider recovery and the final video gate remain open.

Failure-display hosted checkpoint: exact `a8e93b753045a6bb59ae53c509b068907a413998` passed 22 CI checks (Paid Gateway Canary skipped) and its isolated Preview was verified READY. Controlled incoming-message simulations verified structured reasons, retained partial prose, personal current/historical errors, writable-thread retryability, malformed/missing fallback, named-agent/shared-room projection and desktop light/dark/mobile readability. Existing room historical errors also showed the neutral fallback without simulation. Normal reads were restored and no Send, Retry, inference or agent creation was initiated. This establishes UI projection, not real backend persistence/reload or active HTTP-stream precedence; automatic generic conversation PATCH requests were not exhaustively captured. Full acceptance remains open.

Summary-recovery slice locally verified: settled empty/provider-error summaries and confirmed free-route interruptions now use their own persisted `summaryRecovery` backoff, independent of response recovery. Retries keep the original history, allocate a unique receipt per attempt, and wait through the existing ownership/cancellation/hold-fenced durable waiter. Unknown paid usage remains held. Short, malformed or oversized summaries with settled usage and no classified response failure still use the existing full-history fallback; ambiguous provider failures are not converted into zero-cost summary receipts. Focused recovery tests passed 7/7 (22 skipped); settled Convex persistence tests passed 2/2 (27 skipped); the broader recovery unit suites passed 34/34. Targeted ESLint, TypeScript, web-complexity (46 complex functions), and `git diff --check` passed. No hosted compaction behavior was tested; overall lifecycle recovery and video acceptance remain open.

Summary-recovery hosted build checkpoint: exact `83bcdee1ad5cfbb5d86e2393b236b42756de95ec` passed 22 CI checks (Paid Gateway Canary skipped). Trusted controller `41249453744` published READY `dpl_3gDkbiZah4zbsyPda3UnBuFRwv5X` on isolated `pastel-crane-401`. This verifies compilation and deployment, not hosted summary failure recovery.

Binary publication foundation verified locally (not hosted): the existing presigned-upload registration used separate file-create and intent-finalize mutations and could delete an already published object after a lost acknowledgement. New server-only atomic registration validates the owned key, active workspace membership, scope/folder, intent, actual size and MIME; inserts/reconciles one Files row; and consumes the intent/accounting in the same transaction. Retries return that row without duplicate quota charges, while changed/deleted destinations are explicit conflicts. The FileService retains ambiguous/refused objects rather than deleting them; pending expired uploads remain eligible for the existing expiry cleanup. This endpoint must be present before the new web can complete uploads; during web-first rollout, calls fail without discarding bytes and may be retried after backend synchronization. Do not roll web back to the old destructive registration path with finalized uploads. Verification: publication Convex tests covered all 5 cases (4 passed in the initial run; after correcting one assertion to match the existing `Invalid file storage key for user` message, that case passed alone); filtered FileService tests 2/2; P3B unit tests 23/23; adjacent file/storage Convex tests 4/4; targeted ESLint 0 errors (4 existing restricted-import warnings); TypeScript passed after explicitly supplying optional scope/workspace fields; web complexity passed with 46 complex functions; shared-isomorphic passed with 214 modules; `git diff --check` passed. No checksum, immutable source, durable Computer job, root-run artifact identity, binary transfer tool or one-run video result is claimed by this foundation. Hosted publication and video acceptance remain open.

Binary publication hosted build checkpoint: exact `19d3620a8406159f55715e62b6cfaae7ed1392e4` passed 22 CI checks (Paid Gateway Canary skipped). Trusted controller `41250955765` published READY `dpl_3ivyKkN9Nj2wkBF8WjwyD4Vt6SqH` on isolated `pastel-crane-401`. No hosted upload behavior or final video pass is claimed.

Scoped upload authority foundation verified locally (not hosted): the configured storage adapter now validates declared byte length, requested lifetime, and optional lowercase hexadecimal SHA-256 before signing; it forwards exact length and checksum to the existing provider contract and caps requested lifetime at 900 seconds. Existing file-upload callers require a declared size. Verification: adapter unit tests 16/16; S3-compatible provider tests 4/4; targeted ESLint and TypeScript passed; web complexity passed with 46 complex functions; `git diff --check` passed. No hosted transfer, Computer upload, checksum persisted into artifact identity, or final video acceptance is claimed; those gates remain open.

Preview fixture checkpoint: the focused fixture run passed 14 tests in
`nativeThreadCompatibility.convex.test.ts` and `previewQaSeed.convex.test.ts`.
The new `nativeThreadQa.convex.test.ts` then passed 6/6 after correcting its
historical assistant-message status to the schema-supported `error` value.
Hosted UI acceptance and the one-run video-delivery gate remain open.

The fixture head passed all 22 checks and its isolated Preview became READY.
Hosted setup stopped before retirement assertions: the saved Preview key was
development-scoped, so the scope guard correctly rejected it without a backend
request. The trusted controller already has the proper Preview key. An opt-in
`native-thread-retirement` build fixture now reuses that path without exporting
credentials. The build-wrapper tests passed 15/15, and targeted ESLint and
TypeScript checks passed. The isolated Preview redeployment and hosted
UI/retirement assertions remain open; no hosted acceptance is claimed from setup
alone.

Requested by: Divyansh Lalwani

Source discussion: https://app.devin.ai/sessions/3483c60e0e4248a9927afab674050a75

## 1. Objective and non-negotiable exit condition

Make Overlay-managed agents reliably continue unfinished work across model calls, tool calls, execution segments, human approvals, browser disconnects, worker restarts, and recoverable provider failures. Remove all executable paths to the retired capped native runners. Report the real reason whenever work retries, waits, pauses, or fails.

**The implementation is not complete until an Overlay agent executes the supplied `ui-motion-film` skill in one logical run and the resulting validated video lands in Overlay Files.** A local video, a Computer path, a temporary download URL, a successful upload without a Files record, or an agent claiming success is not sufficient.

If the acceptance task exposes other harness defects, including broken skill loading, missing tools, Computer execution, media inspection, upload, Files visibility, permissions, or delivery, fix the relevant general-purpose path and repeat acceptance. Do not declare success based only on unit tests or on fixing the originally reported termination errors.

### 1.1 What “one run” means

- One user-initiated logical root task, conversation, durable plan, and artifact lineage from the request to delivery.
- Multiple model calls, tool calls, child tasks, durable execution segments, provider retries, machine restorations, and workflow attempt IDs are allowed under that root.
- The user can supply requested inputs and the approvals explicitly required by the skill. Those answers resume the same root task, not a replacement task.
- The user must not need to say “keep going,” “try again,” or re-enter the task after an ordinary transient failure.
- Closing or reloading the browser must not cancel the task or make the browser responsible for restarting it.
- No engineer manually generates the final film, repairs project files on the Computer, uploads the MP4, or marks a milestone complete to get the test to pass.
- If engineering intervention is needed during a qualification attempt, retain its evidence, fix the product, and run a fresh full acceptance attempt on the corrected revision. Repeated engineering attempts are expected; the final passing attempt itself must satisfy the one-run contract.
- Pausing for a genuine permission, spending, storage, or safety decision is valid behavior, not permission to bypass that boundary. Acceptance remains incomplete until it resumes and delivers.

### 1.2 Required final evidence

1. Root run ID, conversation ID, execution attempt IDs, model/provider identities, tested web SHA, and backend deployment identity.
2. The original task, versioned skill bundle, approved beat script, music approvals, selected track, and relevant source material.
3. A durable event timeline showing tools, waits, resumptions, progress, retries, and artifact publication.
4. Contact sheets, transition samples, logo review, seam results, audio timing results, and `ffprobe` output.
5. The final MP4's Overlay file ID, workspace/owner, MIME type, byte count, checksum, and authorized application link.
6. A playback check from Overlay Files after a page reload, using the stored object rather than a Computer URL. Download the saved object and compare it with the published checksum.
7. Evidence that delivery remains accessible after the execution Computer is stopped or detached safely.
8. A browser recording of the meaningful approval, progress, and final Files/playback path, plus machine-readable execution evidence for the intervals between those interactions.

The video is the decisive product acceptance gate. Separate failure-injection tests and a multi-day soak remain necessary before claiming week-long reliability.

## 2. Scope and boundaries

### In scope

- Unified native task admission, dispatch, lifecycle, and completion semantics across personal Chat/Work, named-agent DMs, channels, automations, integration-triggered work, and native agent-to-agent requests.
- Removal of legacy native execution paths and explicit rejection of incompatible old threads/requests.
- Durable retries, waits, ownership fencing, continuation scheduling, reconciliation, and resource authorization.
- Structured and truthful errors through server persistence, streaming, transcript reload, web, and shared client contracts.
- Skill bundle availability, required execution/media tools, and capability-aware planning.
- Computer job tracking, artifact checkpoints, Computer-to-Overlay binary publication, and canonical Files readback.
- Fixes to adjacent harness behavior that block the full video task, with regression coverage rather than video-specific hacks.

### Not a prerequisite

- Replacing Workflow SDK, Convex, or the current Computer provider.
- Adopting Rivet or agentOS.
- Rewriting every filesystem surface or building a universal POSIX mount over R2.
- Replacing external connected-agent runtimes with the native Overlay harness. Their existing lifecycle and protocol contracts must remain intact.
- Arbitrary provider fallback, permission escalation, or unlimited spending.

R2-backed Overlay Files are the durable home for accepted inputs/checkpoints/outputs. A Computer may hold working copies and temporary render frames, but its local path is not a delivered artifact.

## 3. Grounded starting point

The production investigation matched screenshot text to persisted messages and run records, not just timestamps:

| Observed case | Confirmed outcome | Required change |
|---|---|---|
| Video Agent, 5m 15s / 8 tools | Legacy runner failed on an empty model response | Recover model calls without abandoning the task |
| Video Agent, 10m 9s / 24 tools | Same empty-response fatal path | Same recovery policy; preserve completed tool results |
| Video Agent, 4m 47s / 23 tools | Legacy model-step ceiling | Remove capped runner dispatch; use durable continuations |
| Personal launch-video request | New harness finalized a no-progress block as failure | Recovery/wait lifecycle instead of automatic terminal failure |
| Response-card attempts | Three `Invalid generated UI payload.` results | Detailed validation feedback, repair, and safe plain-text/input fallback |
| Red network-error banner | UI fallback inferred a connection interruption from partial prose | Display authoritative structured run state |
| Personal run promised to build | Admitted tool set lacked Computer and file-writing tools | Capability checks and truthful blockers |

The exact provider-level cause of the empty responses remains unproven. Do not encode “provider outage,” “timeout,” or “token exhaustion” as the diagnosis without evidence.

### 3.1 Relevant implementation seams

These are source locations to revalidate against current canonical main before editing, not a guarantee that all entry points are listed here.

| Area | Locations |
|---|---|
| Native versus legacy workspace dispatch | `src/server/agents/start-agent-turns.ts` |
| Legacy workspace workflow and model loop | `src/server/workflows/workspace-agent-turn.ts`, `src/server/agents/workspace-agent-turn-loop.ts`, `workspace-agent-invocation.ts`, `workspace-agent-durable.ts` |
| Personal routes and alternative execution | `src/server/app-api/v1/conversations/act/ActTurnOrchestrationService.ts`, `src/server/workflows/personal-chat-work.ts` |
| Automation and surface execution | `src/server/workflows/automation-agent-turn.ts`, `automation-run.ts`, `automation-schedule.ts`, `surface-agent-turn.ts` |
| Native workflow wrappers | `src/server/workflows/native-harness.ts`, `personal-harness.ts` |
| Controller, state, admission, waits | `src/server/harness/runner.ts`, `context.ts`, `control-tools.ts`, `personal-admission.ts`, `personal-admission-policy.ts`, `waits.ts`, `packages/overlay-agent-runtime/src/harness-state.ts` |
| Durable storage | `convex/harness/runs.ts`, harness tables in `convex/schema.ts`, `src/server/harness/ConvexHarnessRepository.ts` |
| Delivery and errors | `src/server/harness/personal-delivery-steps.ts`, `src/server/agents/workspace-agent-turn-lifecycle.ts`, `packages/overlay-chat-core/src/messages.ts` |
| Computer tools and capabilities | `src/server/tools/tools/build.ts`, `overlay-executes.ts`, `src/server/agents/agent-tooling.ts`, `src/shared/agents/tool-groups.ts` |
| Storage and upload | `src/server/files/FileService.ts`, `FileRepository.ts`, `src/server/app-api/v1/files/`, storage contracts |

### 3.2 File transfer finding

`computer_read_file` currently decodes bytes as UTF-8 text and truncates large results. `computer_write_file` accepts text. These are not binary MP4 transfer mechanisms. Do not route a video through model text or base64 in a prompt.

`FileService.createFileFromBytes` already stores server-produced bytes in R2 and creates a Files record with quota checks. The repository also has upload-intent/presigned upload flows. Reuse these authorization/storage boundaries; do not create a separate artifact bucket or a second Files database.

The inspected byte helper accepts a full buffer and creates a new object identity. It is not by itself evidence of a resumable, idempotent large-file publication path. The implementation must resolve transfer size, streaming, finalization, and retry semantics explicitly.

## 4. Target lifecycle and invariants

Use the existing durable harness state as the foundation. Add explicit lifecycle distinctions rather than a competing controller/state store.

Proposed public states:

- `queued`: admitted, launch intent durably recorded.
- `running`: an execution owner is advancing the task.
- `retrying`: recoverable interruption with an attempt and scheduled wake time.
- `waiting_for_input` / `waiting_for_approval`: a persisted request awaiting an authorized reply.
- `waiting_for_job` / `waiting_for_children`: work continues elsewhere.
- `paused`: continuation requires a concrete resource, permission, or operator action.
- `completed`: acceptance criteria and required output publication are verified.
- `cancelled`: authorized explicit cancellation.
- `failed`: an irrecoverable task failure with preserved evidence and a truthful reason.

Internal state names may reuse equivalent existing variants. Migration must preserve the semantic distinctions above.

### Core invariants

1. A runnable task has either a fenced active owner or a durable continuation intent. A quiet task without either is a reconciliation defect.
2. A waiting task has a durable wait/job/child reference and wake condition. A sentence saying “waiting” is not a wait record.
3. A retry stores its category, attempt, next wake time, and last error before yielding.
4. Ownership is checked before execution and state-changing tool dispatch. Stale workers cannot publish progress, spend, or finalize.
5. At-least-once execution is assumed. External effects use receipts/idempotency or explicit reconciliation; do not promise blanket exactly-once execution.
6. The run state, not stream closure or assistant prose, determines completion.
7. Compaction, lease renewal, and heartbeat activity are not productive task progress.
8. Contexts preserve unresolved tool results, approvals, usage reservations, and artifact references across segment boundaries.
9. Authorization is rechecked on resume and tool execution. A durable run does not preserve revoked access.
10. Cancellation fences future execution, records outstanding effects, and cleans up safely without discarding artifacts or double-settling usage.

## 5. Workstream A: hard cutover and legacy retirement

### Implementation

- Build an explicit dispatch matrix for every native initiation path, including HTTP/API clients, direct/room messages, retries, regeneration, automations, integration surfaces, and agent delegation.
- Route each path through one native admission contract. Surface-specific adapters may supply context and delivery, but must not own another model/tool loop.
- Remove selection of legacy native runners, including the `OVERLAY_NATIVE_HARNESS` fallback branch. Native configuration must not silently select an older engine.
- Preserve external connected-agent selection explicitly; do not conflate it with native fallback.
- Add a durable harness/protocol version to admission and enough thread metadata to decide whether a new message is compatible.
- Import readable historic transcript context where safe. Do not pretend to import an old in-flight workflow's unrecorded side effects or hidden runtime state.
- Incompatible threads become read-only. Replace their composer with: “The harness has changed. Start a new thread to continue.” Offer a new-thread action carrying a bounded history/artifact summary, not a silent execution migration.
- Reject incompatible sends, retries, regenerations, edits that launch work, old API clients, and stale queue callbacks server-side with a stable compatibility code and actionable explanation.
- Delete legacy execution loops, obsolete launch routes, feature flags, imports, and associated obsolete tests after callers are migrated. Preserve useful shared utilities and add the tests for their replacement behavior.
- Add a CI boundary test proving retired execution symbols cannot be imported or dispatched. This must test server initiation, not just UI visibility.

### Active work during cutover

1. Stop new legacy admission.
   - [x] Personal HTTP, named-room, automation, and Slack surface execution use native Harness adapters rather than separate model/tool runners.
   - [x] Personal admission fails closed when the Harness capability is missing, stale, unknown, or unreadable.
   - [x] Automation run-backed and scheduler-owned execution uses native Harness with owner-fenced settlement/replay, refreshed bound-agent grants, truthful one-shot approval denial, and focused checks for fresh admission and serialized model authorization.
- [x] Slack surface turns enter the native room Harness lifecycle with immutable execution ownership, source-revalidated preparation and delivery, canonical per-dispatch billing, and persisted input/approval wait projection and resume coverage; full legacy retirement and video acceptance remain open.
- [x] Finish surface review follow-ups: preserve the original root owner for cross-room descendants, persist safe startup failure causes consistently in both run records, and distinguish task outcome from delivery outcome. Verified by the focused Convex and native dispatch/input-builder/orchestration/start-failure/preparation/access suites, TypeScript, and targeted ESLint.
- [ ] Reconcile Slack delivery when the initial placeholder is missing or an external post has an uncertain outcome. Missing placeholders now report delivery failure; do not blindly repost an uncertain external write. This does not change the task's outcome in Overlay.
2. Inventory active legacy runs and in-flight external operations.
3. Fence legacy dispatch and callbacks; revoke old execution authority before replacement execution begins.
   - [x] Require the native Harness marker for new personal and room admission, reject replay/adoption of historical retired runs, reject retired-run workflow attachment and status transitions, and return `native_runner_retired` with new-thread guidance instead of resuming owner-matching retired approval/input waits. Connected `remote` admission and transitions remain supported. Verified by 38 Convex tests, 30 Node tests, 16 Harness unit tests, TypeScript, changed-file ESLint, complexity, and shared-isomorphic checks. This does not authorize tool effects or drain deployed workers.
   - [x] Fence active retired-run progress/completion/failure and room transcript append/finalize/fail/sanitize writes to supported native Harness or connected remote AgentRuns. Retire unowned generation, record startup failures atomically as terminal errors, and stream native output only to the already-admitted assistant message. Preserve remote APIs, metrics/cancellation, and late tool receipts. Verified by 40 Convex, 68 Node, and 23 Harness tests, TypeScript, targeted ESLint, complexity, and shared-isomorphic checks. Tool-effect authority/receipt reconciliation, deployed-worker drain, read-only threads, and final video acceptance remain open.
   - [x] Fence new writes and admissions against recorded retired native AgentRuns at conversation or normalized shared-room-root scope, and project authorized compatibility metadata plus the stable HTTP 410 retirement response while preserving readable history and clean shared-room top-level requests. Initial verification passed 6 Convex files/43 tests, 27 Node tests, 3 Harness files/23 tests, TypeScript, targeted ESLint, complexity (46 complex functions; no baseline change), shared-isomorphic (210 modules), and `git diff --check`. Review-correction verification passed 5 Convex files/42 tests, TypeScript, targeted ESLint (0 errors), complexity (46 complex functions; no baseline change), and `git diff --check`. Untracked historical rows, deployed-worker drain, tool-effect authority, the new-thread UI, recovery, binary publication, and final video acceptance remain open.
   - [x] Support web-first rollout without requiring an older backend to expose the new compatibility query: the web checks the server-owned `nativeThreadCompatibilityRevision` from authenticated `platform/uiSettings:getByServer`; absent marker preserves history reads with distinct unavailable metadata and blocks new writes/native admissions with HTTP 503 plus `Retry-After: 10` before mutation. With the marker, the new backend remains authoritative for tracked-retirement classification and HTTP 410. New human sends pause during overlap, while already-admitted native/remote callbacks and remote admission/progress/cancellation remain unchanged. Verified by 26 Harness unit tests, 31 Convex tests, and 21 Node tests; TypeScript passed, targeted ESLint had 0 errors and 1 existing restricted-import warning, complexity remained at 46 functions, shared-isomorphic passed at 210 modules, and `git diff --check` passed. This rollout safety step does not complete the read-only UI, untracked-history classification, deployed-worker drain, tool-effect/receipt authority, broader recovery, binary publication, or final video acceptance.
4. Reconcile already-issued operations. Preserve output, usage, and receipts. Do not replay an uncertain external write.
5. Mark unsupported old tasks explicitly paused/retired with the new-thread explanation.
6. Remove runnable legacy implementations once they have no live execution dependency.
   - [x] Remove the obsolete capped workspace-agent and personal-chat-work runner source and test fixtures after dispatchers moved to Harness; the retired-runner boundary and focused Harness/preparation checks pass. This records source removal only, not deployed worker drain or fencing.
- [ ] Inventory and drain executions already active on deployed legacy workers.
- [ ] Complete tool-effect authority and uncertain-receipt reconciliation; do not treat late receipt persistence as renewed execution authority.
- [x] Make tracked incompatible old threads read-only and offer an explicit new-thread action. Focused mounted tests and hosted personal/named/room fixture checks passed, including ordinary room draft restoration after simulated unavailability. Stable stale-run-metadata simulation remains partial; untracked-history classification and final cutover qualification are separate open requirements.

At the final cutover, no old native runner is reachable. This source removal does not prove that workers already deployed on older revisions or their callbacks have been drained or fenced. Keeping audit records or an endpoint that only returns an explicit retirement response is not backward-compatible execution.

### Acceptance

- All native dispatch matrix cases reach the new harness.
- A stale client/queue message cannot start the old runner.
- Native configuration cannot disable the new harness and fall back.
- Old threads either admit new work through the new harness safely or reject it consistently.
- External connected-agent contract tests remain green.

## 6. Workstream B: durable continuations and long-running authorization

### Next slice: resource-pause contract (design checkpoint)

- [x] Trace actual budget/deadline exits, durable hooks, callback authority and current approval-card primitives.
- [x] Create the standalone tracked resource-pause mockup using the existing confirmation-card layout and approved thread-preview palette.
- [x] Browser-check the mockup at desktop and 390px mobile widths in dark/light themes, including keep-paused/review, amount validation, exact cumulative-limit acknowledgement, preserved unsent draft, and simulated revoked/stale authorization. These are mockup-only checks, not application or billing acceptance.
- [x] Replace native mockup controls with actual repository shadcn components after design feedback, including all preview selectors and the time picker. The standalone HTML now bundles React/Radix and imports the canonical Select, Button, Input, Textarea, Label, Card and Breadcrumb implementations with Overlay styles. Rebuild with `node internal/plans/mockups/build-harness-resource-pause-mockup.mjs`. Targeted ESLint and standalone TypeScript passed; rendered open menus were checked in both themes and at 390px width, with keyboard selection/Escape, validation, pause/review, preserved draft and simulated grant outcomes. This remains a local design checkpoint, not implemented resource authorization.
- [x] Obtain approval for the resource-pause UI before modifying application controls. The user approved the actual shadcn version on 2026-11-01; the tracked HTML and its React source are the implementation reference.
- [ ] Implement the typed resource wait, atomic authorization grant and retry-safe wake together. Removing terminal finalization alone is not a complete slice.
  - [x] Add the inactive backend foundation: separate resource-request records, integer-micro cumulative grants, policy revisions, idempotent grant receipts, current personal owner/workspace/payer checks, and atomic persisted wake intent. Unknown model holds prevent consumption and remain intact. Runtime/state tests passed 38/38 and focused Convex tests 46/46; targeted ESLint, direct TypeScript and shared-isomorphic checks passed. The normal typecheck wrapper remains blocked by existing desktop boundary fixtures.
  - [ ] Wire durable Workflow wakeup and delivery/UI projection. The persisted wake flag is not yet a running reconciler. No production admission sets `resourcePauseVersion`; the foundation deliberately rejects children, rooms, organization workspaces and unattended surfaces until their authority and allocations are implemented. Explicit-time/lease separation is still required before activation.
  - [x] Add Convex regressions for child depth/slots, room and unversioned admission, and suspended input/approval restoration. They verify generic resume/block bypass, unchanged pending-wait identity and no productive-progress increment. The focused Convex suite had 8 passing cases; after replacing an invalid room fixture with a schema-valid channel conversation and room delivery, the room rejection case passed in isolation (1/1).
  - [x] Add the approved standalone `RunResourceRequest` shadcn component and focused tests; component tests passed 6/6. Targeted ESLint, direct TypeScript, shared-isomorphic (214 modules) and web-complexity (46 complex functions, 0 duplicate groups) checks passed. The lead rendered it in a scratch artifact and verified the specified pixels/interactions; this is not live API/lifecycle acceptance.
  - [ ] Integrate the component with live request/authorization APIs and verify actual same-task resume/reload. Resource admission remains inactive; no live application or backend acceptance is claimed.
- [ ] Qualify root/child authority, expired leases, lost acknowledgements, replay and reload before enabling the new admission contract.

The proposed implementation contract is:

1. **Separate lease, authorization and budget.** A normal long-running task may renew its bounded execution lease after fresh authority checks, without changing its cumulative spending cap. An explicitly requested time boundary remains an authorization boundary, not an automatically extendable lease. Persist the distinction at admission; do not reinterpret older policy rows as permission for indefinite work. Lease renewals are housekeeping, never durable task progress.
2. **Persist a typed resource wait.** Use a resource-specific wait/request, not an invented tool approval and not natural-language input interpreted as a grant. Store root/task identity, owner generation, pause reason, request identity/revision, current limit, and relevant usage/reservations. A timer must transition to this durable pause rather than throw a fatal task error. A suspended wait must retain a wake condition even after the old execution lease expires.
3. **Approve an exact cumulative limit.** The example $2.00 means a new total Overlay-funded model cap, not an extra $2.00 purchase. Validate currency amounts in integer micros under the existing maximum and entitlement limits. Time grants extend only a specifically displayed authorization duration. Neither grants tools, workspace access, provider fallback, Computer spending, storage, or BYOK credit. Unknown model outcomes and pending holds remain unresolved and cannot be cleared or replayed by granting more budget.
4. **Reauthorize at commit.** Personal tasks require their authorized owner; room participation alone is not spending authority. Require current workspace access and the billing/resource authorization of the principal whose allowance funds the run. Automation and surface tasks retain their original service principal and source restrictions. Check current run, request, policy revision, workflow owner, cancellation and ancestor state in the same transaction as the grant. Stale or revoked callbacks make no changes. A grant never resurrects a terminal task.
5. **Keep root and child allocations consistent.** Project child resource needs through the owning root; a child cannot mint an independent budget, extend an ancestor, or spend beyond its allocation. Preserve all accounted child usage and active reservations. A parent must not block on a child whose request has no authorized root-level resolution path.
6. **Persist grant and wake intent atomically.** Consume a request once, record the exact grant receipt, update only authorized policy fields, and enqueue a durable continuation/wake intent. Repeated approval returns the same receipt, not another increment. Reconcile lost hook acknowledgements and failed launch delivery under a single-owner fence before running another model/tool. A grant whose hook is already gone must not silently leave a runnable orphan.
7. **Keep paused means paused.** Dismissing the proposal preserves its request, task history, artifacts, holds and ability to review it later. It is not rejection of a tool, cancellation, or task failure. Reload restores the same pause. Existing Stop remains an explicit cancellation action.
8. **Release as a coherent boundary.** Additive readers and a readiness/version gate precede new writers; do not dispatch new resource waits to an older UI or backend. Tests must exercise real backend authority plus the workflow wake path, not only mock callback success. Acceptance includes duplicate callbacks, cross-workspace and revoked authority, changed-request rejection, root/child allocation, unresolved receipt safety, and a resume with no repeated completed tool.

Design boundary: this mockup covers model-spend and explicit-time approval only. Storage, Computer quotas, worker replacement, durable provider reconciliation, and the final video gate remain separate open work. The proposed time controls do not establish that renewal, rollover, or multi-day reliability already works.

### Implementation

- Separate logical task identity from workflow execution-attempt identity. Keep one root task and plan across renewed attempts.
- Treat model-step, context, or platform execution boundaries as checkpoint-and-yield conditions, not whole-task failure.
- Persist continuation intent transactionally with the state transition; claim execution using a generation/fencing token. Retrying launch must not start a second owner.
- Add a reconciler for launch acknowledgements lost in transit, expired owners, missed wakeups, and runnable tasks without a scheduled continuation.
- Verify Workflow SDK deployment/replay semantics against the installed version before choosing rollover mechanics. A replacement attempt must resume from an explicit checkpoint, not replay arbitrary old side effects.
- Keep required checkpoints, full tool outputs/artifacts, plan revisions, and event history durable; bound hot context independently. Compact or archive history without discarding recovery evidence.
- Replace the current 24-hour default / seven-day admission ceiling as a task-termination mechanism. Use renewable execution leases under an explicit user/workspace long-running authorization policy.
- Preserve spending limits, rate limits, storage quotas, and Computer costs. Pause resumably when authorization is exhausted; show precisely which resource needs renewal.
- Support approved extension/resume of the same task. Do not require a new thread merely because an execution lease expires.
- Ensure provider credentials are resolved securely at execution time, never serialized into checkpoints.

### Acceptance

- Deterministic tests cross the previous 8/12/20-step boundaries without whole-task termination.
- Browser disconnect/reload has no effect on execution ownership.
- Lease expiry, missed launch acknowledgement, worker loss, and duplicate wakeups converge to one active owner.
- Accelerated clock tests cross seven days and multiple authorization renewals while preserving task identity.
- Authorization expiry pauses with a reason; renewal resumes without bypassing quotas.

## 7. Workstream C: recovery instead of premature failure

### Error policy

| Condition | Required treatment |
|---|---|
| Empty model answer with no tool calls | Preserve usage/provider metadata; bounded model-call retry; never replay completed tools |
| Rate limit / transient provider transport error | Backoff with jitter, honor retry guidance, persist next attempt |
| Persistent provider outage | Durable retry/circuit-breaker state or actionable pause, not a fast infinite loop |
| Permitted provider fallback | Enforce capability, data/privacy, BYOK, billing, and model-selection policy; record the switch |
| Invalid tool/card arguments | Structured field-level validation errors and repair guidance; no fatal whole-task exit |
| Content/policy refusal | Accurate refusal state; no fallback intended to evade the restriction |
| Ambiguous external effect | Reconcile receipt/provider job before retry; pause if outcome cannot safely be established |
| Authentication or permission failure | Explicit resumable access blocker; never retry indefinitely or escalate permissions |
| Nonzero shell exit | Return stdout/stderr/exit code as a tool result for diagnosis; bounded repair attempts |
| Corrupted state/invariant failure | Safe failure or operator-required pause with diagnostic ID; preserve evidence |

Do not classify every error as retryable. Do not classify every provider finish reason as a permanent task failure. Preserve the raw sanitized cause and normalized category separately.

### Model and accounting behavior

- Centralize recovery policy instead of scattering independent retry loops across workflows/tools.
- Track provider request identity, finish cause, visible-text length, tool-call count, model identity, attempt, and usage disposition.
- Reconcile ambiguous usage reservations without silently releasing a potentially billable hold or charging twice.
- Output that ends because of token limits is not proof that the task is complete. Continue with persisted state and a bounded context strategy.
- An empty response retry must not duplicate partial UI prose or duplicate completed tool effects.

### Replace stagnation finalization

- Separate history-compaction checkpoints from execution-continuation progress checks.
- Distinguish model narration, heartbeat/health, new evidence, plan advancement, and externally running jobs.
- When progress stalls, inspect recent errors, capabilities, unmet dependencies, and active jobs; repair the plan or select a different approach.
- Do not permit manufactured progress such as repeatedly rewriting the same plan or creating trivial evidence entries.
- Bound recovery cycles and spending. When recovery cannot proceed, persist a specific wait or pause with the missing condition and resume action.
- Remove the workflow-wrapper behavior that finalizes every nonterminal blocked outcome as failed.

### Human interaction

- Register durable approval/input waits before presenting the question.
- A valid authorized answer resolves that wait and wakes the same root task exactly once logically.
- Card rendering failure must not destroy the wait. Present a plain-text question backed by the same wait identity.
- Assistant text such as “Approved” never counts as user approval. Record actor, answer, referenced script/asset revision, and timestamp.
- Resume after approval reloads current authorization and checks that the approved artifact has not changed.

### Acceptance

Fault injection covers an empty response after a successful tool, repeated 429/5xx errors, invalid card payload, lost approval wakeup, context compaction without work progress, uncertain side effects, and provider usage ambiguity. Each case must retain correct state and avoid duplicate external actions.

## 8. Workstream D: truthful status, errors, and observability

### Canonical event contract

Persist a versioned, sanitized record containing at least:

```text
eventId, rootRunId, attemptId, sequence, timestamp
category, code, userMessage, diagnosticId
source: model | tool | job | workflow | admission | delivery
toolCallId/providerRequestId/jobId where applicable
retryDisposition, attemptNumber, nextRetryAt
requiredUserAction, recoveryState
```

- Keep raw provider details server-side with redaction. Do not expose credentials, signed URLs, internal stack traces, or another tenant's identifiers.
- Project the same contract into live streaming, persisted messages, reconnect responses, and shared web/desktop/mobile views.
- Remove inference of a backend failure from partial assistant prose. Preserve the prose as work history, not as the source of truth for errors.
- “Connection lost” applies only to transport state. If the task is still running, reconnect and say so. If its state cannot be fetched, report that uncertainty, not an invented backend cause.
- Show retry count and next retry time where known; elapsed time and last verified progress for long jobs. Mark ETA as estimated.
- Keep status UI minimal and use existing `@overlay/ui` primitives. Produce a standalone mockup of the retired-thread notice and new status/error rows before implementing their visual presentation.
- Ensure log-field redaction preserves intended safe diagnostic fields; use sanitized enums/lengths rather than dumping model inputs or responses.

### Operational signals

Track empty responses, recoveries, final failure categories, runnable-orphan count, duplicate claims rejected, upload reconciliation failures, time to resume, and end-to-end delivered outputs. These are observability requirements, not permission to collect sensitive content.

Acceptance: after refresh, the same run reports the same true reason and recovery action. A backend failure must never turn into the generic network banner merely because partial text exists.

## 9. Workstream E: capabilities, skill packages, and usable media tools

### Skill inputs

The supplied attachment is the `ui-motion-film` instruction text (`pasted-1793411857406.txt`). It references templates/scripts/reference files, but the supplied text itself is not that complete bundle. The inspected repository did not contain the named film template, seam script, or track-analysis script.

Before live acceptance:

1. Locate the complete existing skill package through authorized skill/workspace sources.
2. Verify each referenced file exists, is readable by the admitted agent, and matches a pinned bundle version/checksum.
3. If it is unavailable, request the missing bundle. Do not claim its files are attached, silently invent replacements, or weaken the exit condition. A separately approved reconstruction would need its own validation.
4. Make the bundle durably accessible and materializable on a fresh Computer without an engineer copying files by hand during the run.

Required bundle inventory:

```text
reference/overlay-launch-case-study.md
templates/film.html
templates/dots-film.html
templates/loop-v1.html
templates/logos/ and templates/logos.js
templates/events.json
scripts/render.mjs
scripts/seam.mjs
scripts/analyze_track.py
scripts/sfx.py
scripts/fetch_logo.sh
scripts/build_logos.py
```

Only files relevant to the chosen film need executing, but the package must not advertise nonexistent assets.

### Capability preflight

- Confirm skill discovery/read, source-material access, Computer execution, background-job supervision, binary import/export, artifact presentation, and authorized Files access.
- Validate tool definitions are actually registered for the selected surface/model, not merely present in a policy allowlist.
- Verify tool grants across old and newly saved agents; follow `LATER_GROUP_MEMBERS` conventions when extending existing groups.
- Confirm a healthy Computer binding and installation path for Node, Playwright/Chromium, Python dependencies, ffmpeg, and ffprobe.
- If provisioning/dependency repair is authorized and supported, the agent performs it through normal tools. Otherwise present a precise blocker.
- Provide model-accessible image/contact-sheet inspection and audio/video presentation. A filename or a JSON summary alone is not visual review.
- Keep media bytes outside model context; tools return stable artifact/file references and bounded metadata.

### Approval preparation

Gather story/source material, intended shape states, palette, and music preference. Preserve the skill's stop points. Do not treat this implementation-plan approval as approval of a future script, download, music track, or spending amount.

The skill mentions a metallic orb wordmark, whereas current repository guidance specifies the canonical Overlay mark/lockup. Resolve this visual choice in the script/design approval; do not silently claim to satisfy both.

## 10. Workstream F: durable jobs and Computer-to-Overlay artifact delivery

### Job lifecycle

- Persist job identity, root/task ownership, Computer identity and generation, working directory, command/recipe reference, process/session identity, status, timestamps, logs, and expected output manifest.
- Record submission intent before launch and reconcile an unknown launch outcome before launching again.
- Heartbeat/lease rules must distinguish an active render from a healthy but unproductive agent. Do not let normal Computer idle-stop kill an actively supervised authorized render.
- After worker restart, reconnect to an existing live process instead of restarting it blindly.
- A replaced Computer is not the same process. Restore durable inputs/project checkpoints, then resume a supported checkpoint or restart the computation explicitly. Mark what was lost; never fabricate process continuity.
- Preserve source, scripts, asset references, approved configuration, job recipe, and useful checkpoints in Overlay Files. Do not require uploading every temporary frame unless needed for recovery.
- Keep render progress/logs visible, with throttled updates and an honest estimated ETA. The skill's timing estimate is not a performance guarantee.

### Proposed general-purpose transfer contracts

Final names should follow repository conventions. Required semantics are:

- **Import Overlay file to Computer:** authorized stable file ID plus pinned revision/checksum, target Computer, destination path; result includes verified byte count/checksum.
- **Publish Computer artifact to Overlay Files:** source Computer/path, target workspace/folder, display name, expected MIME, root-run artifact identity, idempotency key; result includes canonical file ID, checksum, size, and authorized app reference.
- **Inspect transfer status:** durable transfer identity and state, allowing reconciliation after a lost acknowledgement.

Prefer one small coherent transfer service behind these tools, using the existing file authorization, upload intents, and storage policy. Avoid direct ad hoc R2 credentials in shell commands.

### Publication protocol

1. Authorize actor, Computer binding, destination workspace/folder, and current run ownership.
2. Resolve and validate source path against the authorized execution environment. Prevent path/symlink abuse and unintended access to credentials or files outside the granted scope.
3. Verify output is finalized; establish immutable source/checksum or a stable snapshot so retries cannot publish different bytes under the same artifact identity.
4. Reserve quota and persist a transfer intent keyed by root/task artifact and revision.
5. Transfer bytes without passing them through the model. Use a bounded in-memory path only for sufficiently small artifacts. For render-sized files, implement a streaming/direct upload path or multipart transfer as supported by the existing storage/provider adapters.
6. Give the execution side only short-lived object-scoped upload authority when needed, never broad R2/application secrets. Do not persist signed URLs in prompts or long-lived logs.
7. Verify actual object size, MIME, and checksum using a trustworthy checksum mechanism. Do not treat a multipart ETag as a content hash.
8. Finalize the canonical Files row and transfer receipt idempotently. Only then attach the file to the task's completion evidence.
9. If upload succeeds but finalization fails, reconcile and retry registration. If registration succeeded but acknowledgement was lost, return the existing file instead of creating another.
10. Re-read through the normal Files API and verify the destination scope and authorized content access. Return a stable file reference, not an expiring signed storage URL as the permanent identity.

### Failure handling

- Expired upload URL: refresh scoped authority and resume/retry safely.
- Quota exceeded: preserve local/durable work, pause with the exact storage requirement, resume after authorization.
- Interrupted transfer: retain intent and byte verification; resume or restart transfer without re-rendering a valid durable output.
- Missing Computer output: report lost output and restore/recompute from recipe; do not create an empty Files entry.
- Orphan object: reconcile before cleanup; never delete an object already referenced by a successful Files row.
- Duplicate requests: one logical artifact/revision; replacement content creates an explicit revision, not accidental overwrite.
- Cross-tenant/folder access: reject before upload or registration.

### Acceptance

Verify a binary MP4 larger than the text-read truncation threshold, interrupted upload, lost finalization acknowledgement, checksum mismatch, quota refusal, duplicate publish, unauthorized workspace, expired credentials, and fresh-Computer restore. All failed transfers must remain non-delivered until verified publication completes.

## 11. Mandatory video acceptance protocol

Run through the actual Overlay interface and native harness in an isolated current-head preview with its own backend and authorized Computer. Use a real permitted model and real storage. A scripted fake tool/model test is not the product exit gate.

### A. Preflight and request

- [ ] Verify preview SHA, backend, user/workspace, Computer provider scope, storage/billing authorization, model access, and complete skill bundle.
- [ ] Start a fresh supported thread and one task: create an Overlay launch film using the supplied `ui-motion-film` skill and save the finished video to Overlay Files.
- [ ] Capture root identity and required deliverable manifest.
- [ ] Agent gathers missing inputs through durable questions, reads source material and skill reference, and does not invent product claims.

### B. Beat script and approvals

- [ ] Agent writes a beat-grid script explaining the product from first principles for a new viewer: hook, problem, introduction, capabilities, call to action.
- [ ] Default target: square 1440 x 1440, 60 fps, 120 BPM, 12 bars / 24 seconds unless the user approves a different specification.
- [ ] Script is a bar-by-beat table: one headline per bar, changing only on downbeats, with shape state and cursor action per beat; headlines approximately eight words maximum.
- [ ] Obtain explicit script approval before code. Persist the approved script revision.
- [ ] Ask before each music download with filename, source URL, and size. Discover size via metadata where possible; if unknown, disclose that and obtain approval rather than inventing it.
- [ ] Verify licensing from the source at execution time; the skill's licensing statement alone is not a permanent guarantee.
- [ ] Analyze candidate music for steady tempo within +/-4% of 120 BPM.
- [ ] Present a 14 to 24 second cut and a three-loop preview; user selects by ear through a durable wait.
- [ ] No approval response launches a replacement logical run.

### C. Build and visual review

- [ ] Copy `templates/film.html` into the project and the required scripts next to it; run `npm i playwright` in the film directory through agent tools and install the declared Python/render dependencies.
- [ ] One continuous UI element morphs without cuts. `seek(t)` is a pure function of time, with no CSS transitions, timers, or state carried between frames.
- [ ] Preserve closed-form springs (`w=17, z=0.85`, maximum approximately 0.6% overshoot; `z=1` for color, presses, draw-ons), additive periodic tracks, and invisible resets settled before visibility at loop start.
- [ ] Content swaps use the skill's `win()` enter/exit treatment: spring enter with brief blur, linear final 85 ms exit, and next state entering 40 ms later without text overlap.
- [ ] Liquid indicators/toggles spring leading and trailing edges separately (approximately `w=24` and `w=11`). Drags follow cursor position directly while held, use the specified rubber-band function beyond range, and spring back on release.
- [ ] Snap-change times are precomputed from cursor sampling and only trigger when the cursor arrives. Camera spring is approximately `w=10`, each state fills 70% to 80% of the frame, and scaled elements do not use `will-change`.
- [ ] Cursor tracks are periodic in world coordinates, rendered at a constant 64 px screen size with the skill's default `w=9, z=0.97` and deliberate per-key overrides. Position and velocity remain continuous at the seam.
- [ ] Use the approved palette (`#ECEAE6`, `#111110`, `#FFF`, `#F2F1EE`, `#77756F`, `#E6E4DF` by default), Geist 400/500/600, and the explicitly approved Overlay wordmark treatment from Section 9. Lucide icons use stroke 2 and consistent 26 to 28 px sizing. Use monochrome real brand logos via masks/data URIs; run the logo fetch/build scripts as required.
- [ ] No disallowed gradients, glows, particle bursts, emoji, or bouncy effects; only a single soft shadow.
- [ ] Headlines fade as complete lines with approximately 0.1 second opacity-only transitions, never per-word shimmer, blur-in, or lift. They sit 44 px above the shape's live top edge using the supplied placement formula, centered together with the shape, and hold a full bar. Text must be legible for at least one second.
- [ ] Render one frame per beat, inspect the contact sheet visually, inspect logo contact sheet, and spot-check transitions with the supplied renderer.
- [ ] Repair cramped, clipped, overlapping, unreadable, or cursor-covered content; retain review evidence.

### D. Audio, seam, and full render

- [ ] Use the supplied `bars` analysis to locate a drop or phrase start before cutting; cut/stretch music to the grid and verify median grid deviation within +/-10 ms using the supplied analysis script.
- [ ] `seam.mjs` prints `true`; verify frame 0 and period endpoint as required by the skill, including cursor position/speed.
- [ ] `sfx.py` reports zero off-grid events.
- [ ] Run the full render as a monitored background job with `SUB=4`; display progress and estimated ETA.
- [ ] Mux with the skill's command:

```bash
ffmpeg -y -i out/film-silent.mp4 -i out/mix.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k \
  -shortest -movflags +faststart out/film.mp4
```

- [ ] Inspect rendered frame 0 for blur-subframe ghosts and watch the actual final video, not only the source HTML/contact sheet.
- [ ] Verify `ffprobe` dimensions, 60 fps, frame count `60 * P` (1440 for 24 seconds), expected duration, and an audio stream. Check A/V synchronization and loop playback.
- [ ] If the track is upbeat from its first frame, apply the skill's one-bar triangular fade-in (`afade=t=in:d=2.0:curve=tri`) and also publish and verify a no-fade loop version, as required by the Music section. Do not omit that required variant merely because the workflow section says to offer it.
- [ ] Flag illustrative numbers to the user rather than presenting them as factual product metrics.

### E. Publish and deliver

- [ ] Agent publishes the MP4 through the production-equivalent binary transfer tool, not an engineer upload.
- [ ] Files row, object checksum/size, workspace/folder placement, and readback are verified.
- [ ] Final response contains the canonical Overlay file reference and concise completion summary.
- [ ] Open Files after refresh, play/download the stored video, verify checksum, and confirm access after safely stopping the execution Computer.
- [ ] Root task transitions to completed only after these output conditions are satisfied.

## 12. Validation layers and regression matrix

### Layer 1: focused deterministic tests

Test the state reducer, admission, dispatch matrix, retry classifier, wait resolution, usage accounting, continuation ownership, error projection, job reconciliation, and transfer finalization. Use fake clocks for long deadlines, but never label them a real multi-day execution test.

### Layer 2: integration and fault injection

| Injection | Required invariant |
|---|---|
| Empty response immediately after a successful tool | Same task resumes; successful tool is not repeated |
| More than 20 model turns and 100 tool calls | Work continues without an old runner ceiling |
| Invalid generated-UI payload | Repair or plain-text question; durable wait survives |
| Provider timeout with unknown usage | Reservations reconciled; no double charge or blind release |
| External action response lost | Receipt reconciliation before retry |
| Worker killed between checkpoint and launch | Reconciler restores one continuation |
| Old worker writes after takeover | Fence rejects it |
| Approval during restart/reconnect | One authorized resolution, same task |
| Browser closes during render | Job and task continue; UI rehydrates correctly |
| Computer replaced | Honest loss detection and restore/recompute, not false continuation |
| Upload succeeds, finalization response lost | One canonical file, recoverable receipt |
| Storage/access/spend revoked | Accurate pause; no bypass |
| Cancel while retry/job/upload is pending | No later unauthorized continuation; cleanup/accounting reconciled |
| Repeated plan edits without real work | Detected stagnation, no fake progress loop |
| Old client/automation calls retired path | Explicit rejection, no legacy execution |

### Layer 3: real video acceptance

Execute all of Section 11. Keep the attempt ledger even when the task fails. A lower-level test pass never substitutes for this gate.

### Layer 4: longevity and deployment qualification

- Run a real multi-day authorized workload with visible state, checkpointing, waits, and recovery.
- Inject deployment/worker restart across compatible versions and verify durable task ownership and artifact continuity.
- Test bounded context/event-history behavior and storage growth under repeated segments.
- Record actual duration, retries, costs, and gaps. Do not call the system “week-tested” if only accelerated clocks or a one-day soak were used.

### Commands and environment discipline

Revalidate scripts on the implementation branch. For example, focused existing tests can use the repository's Node/tsx server-only conventions:

```bash
NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs \
  npx tsx --test src/server/harness/runner.test.ts \
  src/server/harness/native-conformance.test.ts \
  src/server/files/FileService.test.ts
```

Add newly authored suites to the appropriate package/root test inventory. Run targeted ESLint on changed files, relevant package checks, `npm run check:shared-isomorphic` for shared boundary changes, and `npm run typecheck` before final qualification. Use one final `npm run test:all` and production build gate where the environment supports them. Record any unrelated blocker precisely; do not claim a skipped check passed.

These commands are proposed implementation checks, not checks run while writing this plan. Hosted acceptance uses the documented preview workflow and scoped credentials. Never run a production Convex deploy from a feature worktree.

## 13. Execution order and review boundaries

Use reviewable changes that build on a single agreed lifecycle contract. Do not create independently competing recovery mechanisms in each surface.

| Phase | Deliverable | Gate |
|---|---|---|
| 0. Baseline and prerequisites | Current-main dispatch inventory, versioned skill bundle, source inputs, acceptance fixture, failure reproductions | Missing prerequisites explicit; no hidden test preconditions |
| 1. Truthful state and lifecycle contracts | Error/event projection, retry/wait/pause semantics, compatibility versions, UI mockup | Persist/reload consistency; design approved before UI implementation |
| 2. Recovery and continuation | Model recovery, real waits, progress separation, fencing, reconciler, renewable authorization | Failure injection passes; no ambiguous side-effect replay |
| 3. Native cutover | Every initiation adapter migrated; incompatible threads guarded; old runners retired | Dispatch matrix proves no legacy native execution remains |
| 4. Jobs and artifacts | Capability preflight, skill materialization, durable jobs, import/export/publication, Files readback | Real binary round trip, retry/idempotency, tenant/size/checksum tests |
| 5. Full video qualification | Skill executed by the Overlay agent through final stored MP4 | Entire Section 11 passes in one logical run |
| 6. Longevity and release | Multi-day soak, deployment recovery, final documentation and observability | Evidence supports the actual reliability claim |

Phases 2 through 4 can expose changes to the common contracts; integrate those before enabling broad admission. Do not route all customers to a known-broken new path merely to delete the old path sooner. During transition, unsupported cases must reject explicitly rather than fall back. Final release includes complete retirement.

Cloud implementation uses main-targeted PRs and the repository's merge queue. Open draft previews for sensitive/backend/UI acceptance using `needs-preview` and isolated per-PR Convex. Verify exact-SHA preview readiness before testing. Production follows native Git deployment, then scoped production backend synchronization from clean current canonical main where required. No ad hoc deployment path.

Rollback means disabling new admission or pausing affected tasks safely on a compatible version. It must not re-enable the retired capped runner or discard new lifecycle records.

## 14. Continuous improvement rule during acceptance

When the video task fails or stalls:

1. Capture the first actionable failure and root/task/job/transfer IDs before restarting anything.
2. Determine whether the defect is harness control, provider response, tool/schema, approval, skill packaging, execution, media validation, storage, delivery, or UI state.
3. Preserve partial artifacts and account for any in-flight effect.
4. Implement the smallest general-purpose correction at the responsible layer with a regression test.
5. Rerun the focused failing check, then the end-to-end task on the corrected candidate.
6. Repeat until the full one-run delivery gate passes. Keep failures visible in the evidence ledger; do not redefine success to exclude the failing layer.

Fix adjacent harness defects needed for this task without requiring a separate scope negotiation for every ordinary bug. Escalate only when the remedy changes major architecture, permission boundaries, external spending, data retention, or user-visible product policy. Do not bypass approvals, fabricate tool results, hard-code the video output, or have an engineer complete the task invisibly.

## 15. Final checklist

- [ ] No native message initiation route can reach a retired capped runner.
- [ ] Incompatible old threads and stale clients are explicitly blocked server-side and in the UI.
- [ ] Empty responses, transient outages, invalid payloads, and no-progress situations recover or pause truthfully without discarding the task.
- [ ] Input/approval responses resume the original task and are attributable to an authorized human.
- [ ] Browser transport is independent of task execution and error diagnosis.
- [ ] Long-running authorization, quotas, cancellation, and usage reconciliation remain enforced.
- [ ] Worker ownership and continuations survive restarts without duplicate effects.
- [ ] Required skill assets and execution/media tools are available and discoverable.
- [ ] Computer outputs can be published to canonical Overlay Files through a secure, binary-safe, retryable path.
- [ ] An actual skill-compliant video is generated, validated, published, reopened, and played from Overlay Files in one logical run.
- [ ] Final acceptance has no engineer completing the film/upload or manual “keep going” intervention.
- [ ] Multi-day/rollover tests support the long-horizon claim; remaining gaps are explicitly documented.
- [ ] Preview evidence, focused tests, final gates, rollback behavior, and release documentation are complete.

**Do not close this implementation because the original errors disappeared. Close it only when the agent finishes the actual job and delivers the actual video into Overlay Files, with the reliability and safety gates above satisfied.**
