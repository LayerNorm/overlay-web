# Long-running harness reliability and video-delivery implementation plan

Status: Implementation in progress. Application changes are being developed on `codex/long-running-harness`; no acceptance run has passed yet.

## Implementation progress

- [x] Revalidated canonical main and created an isolated feature worktree from `80f17d148`; preserved newer approval-outcome persistence fixes.
- [x] Inspected native dispatch, continuation, compaction, waits, delivery, and Computer/FileService transfer boundaries.
- [x] Initial recovery slice: separate compaction from stagnation, provide bounded recovery before a durable input wait, and expose actionable tool-validation details. Focused runtime, runner, Convex wait, generated-UI, and serialized validation tests passed. Direct TypeScript compilation passed; the repository typecheck command remains blocked by unrelated desktop integration checks. This slice does not complete provider recovery, deadline renewal, or the hard cutover.

Implementation note (initial recovery slice): the runner now owns the six-segment recovery bound and routes the resulting stuck blocker through the authenticated input wait; compaction checkpoints remain additive housekeeping and cannot pause a run. This note does not mark any broad plan phase complete.
- [ ] Unified native admission and complete legacy runner retirement.
- [ ] Durable lifecycle/retry/authorization extensions and truthful status projection.
- [ ] Computer jobs, skill materialization, and verified binary artifact publication.
- [ ] Complete skill bundle located and available to the acceptance agent.
- [ ] One-run video creation and Overlay Files delivery acceptance.
- [ ] Multi-day/deployment qualification and final release gates.

Checked items record completed work only. The detailed acceptance checklists below remain unchecked until verified.

Current UI slice: personal and room read-only footers, fresh send/retry and room-send admission, delete/generated-UI mutation guards, structured-error invalidation, accepted-send/draft handling, pending-collaboration restoration, and bounded editable fresh-thread handoffs are implemented. Compatibility response observation is limited to mutation methods so a structured unavailable GET cannot recursively trigger another compatibility GET; POST diagnostics remain covered. The approved `internal/plans/mockups/native-thread-footer-mockup.html` remains the design reference.

Verification for this slice: the new `chatTransport.test.ts` and `generated-ui-mutation.test.ts` cases passed in the prescribed grouped run. The mounted interaction test required the documented `register-style-noop.cjs` loader because Node otherwise parses KaTeX CSS as JavaScript; its focused rerun passed 6/6. Together the three new test files passed 10/10 cases across those runs. The prior focused native-safety, handoff, API-client, room-view, pending-message, and footer set passed 50/50. `npx tsc --noEmit --pretty false` passed; targeted ESLint passed with 0 errors and 4 warnings (unused declarations and an existing hook-dependency warning); `npm run check:web-complexity` passed with 46 complex functions and no new over-threshold function; `npm run check:shared-isomorphic` passed with 212 modules; `git diff --check` passed. Mounted tests now cover stale scope/unmount, independent room/root safety with bounded unavailable retries, rejected preflight draft preservation, duplicate-send prevention, newer draft/attachment retention, nested draft ownership, pending-message restoration, and server-first delete rejection. The mounted test runner emits React renderer deprecation notices and one non-failing `act(...)` warning. Browser visual interaction and hosted verification remain open; the read-only UI acceptance item and broader workstream are not complete.

Owner: Overlay native harness

Preview fixture checkpoint: the focused fixture run passed 14 tests in
`nativeThreadCompatibility.convex.test.ts` and `previewQaSeed.convex.test.ts`.
The new `nativeThreadQa.convex.test.ts` then passed 6/6 after correcting its
historical assistant-message status to the schema-supported `error` value.
Hosted UI acceptance and the one-run video-delivery gate remain open.

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
- [ ] Make incompatible old threads read-only and offer an explicit new-thread action.

At the final cutover, no old native runner is reachable. This source removal does not prove that workers already deployed on older revisions or their callbacks have been drained or fenced. Keeping audit records or an endpoint that only returns an explicit retirement response is not backward-compatible execution.

### Acceptance

- All native dispatch matrix cases reach the new harness.
- A stale client/queue message cannot start the old runner.
- Native configuration cannot disable the new harness and fall back.
- Old threads either admit new work through the new harness safely or reject it consistently.
- External connected-agent contract tests remain green.

## 6. Workstream B: durable continuations and long-running authorization

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
