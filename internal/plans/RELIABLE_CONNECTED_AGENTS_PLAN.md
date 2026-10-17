# Reliable connected agents

Status: Phases 0–3 implemented with native-provider acceptance incomplete; Phase 4 runtime and hosted file/hash/fresh-hydration checks pass with remaining acceptance in progress; Phase 5 guarded restoration implemented with forced native recovery acceptance pending.

Related: [`DURABLE_REMOTE_AGENT_RUNS.md`](./DURABLE_REMOTE_AGENT_RUNS.md) (run lifecycle v2),
[`internal/develop/bring-your-own-agents.md`](../develop/bring-your-own-agents.md),
mockup [`mockups/reliable-agents-mockup.html`](./mockups/reliable-agents-mockup.html),
smoke [`scripts/smoke/cloud-agent-long-horizon/`](../../scripts/smoke/cloud-agent-long-horizon/).

## Progress

- The fresh forced-recovery smoke exposed the interrupted source action remaining open beside the new writer. A real Convex regression reproduces its stale timer and row. The local fix settles unfinished source actions/terminal output only at authorized startup admission after historical ingestion is sealed, preserves completed work and text, stops timers at the provider-stop observation, and leaves duplicate admission and new writer work alone. Collapsed groups report their actual running count. All 79 connected-agent Convex transactions and 26 shared/rendered tests pass, including completion and late duplicate delivery; root types, targeted lint, docs, isomorphic boundaries and complexity checks pass. Hosted acceptance of this follow-up remains pending. The live hour-long smoke continues on the prior published revision.

- Fresh provisioning on the new candidate succeeds for the same existing Claude agent and subscription. Browser QA also reproduces Start a new machine silently returning after explicit teardown because status discarded its account/adapter setup. Status now retains only that prior cloud setup, without reviving revoked execution authority; missing setup gives a visible UI error. All 26 machine-service tests pass, including local/foreign-scope exclusion and denied control of the revoked environment. Current-head browser acceptance now passes: one Start a new machine click reaches Ready using the same agent and saved subscription. The replacement has all 64 candidate JavaScript hashes, and all 26 baseline files match after hydration. Its native session identity is independently verified; the first 182-second quiet tool completes without rejected batches or a false stall. The fresh repeat now resumes automatically after its planned provider stop: a new OS boot preserves the original run, assistant, native conversation, complete text prefix, prior tool rows and all three pre-stop file hashes. New native calls append to the original provider conversation, still on Sonnet 5.5, and new file writes match full Files API bytes. This proves immediate recovery and continued work; the hour-long task, final deliverables and full-run visible latency remain pending.

- Current-head Windows compatibility exposed the discovery isolation test abandoning its observer while initialization was still within the adapter's existing startup budget. A controlled ten-second real subprocess reproduces the same initialize-only trace and false failure. The test now observes the discovery operation's completion instead of imposing a separate polling-count deadline; the delayed probe passes with every isolation assertion intact and no product timeout change. Fresh Windows, macOS and Linux compatibility jobs now pass on the published candidate; required quality/security CI and the exact-head Enhanced Preview build also pass.

- An earlier forced native recovery preserved the original assistant/native conversation, full text prefix, prior tool rows and all three pre-stop file hashes, and resumes work under a new fenced generation. That earlier candidate then reported unknown health and blocked drive sync. Two real-subprocess regressions reproduce acpx publishing a session before settings finish and reporting unknown health when its first prompt is dispatched. acpx now configures newly opened/reloaded sessions before publishing them and closes the child on configuration failure. Full host checks pass (213 tests, one optional skip), plus host types, lint, docs and complexity. The new private candidate image passes installed-source verification; only the existing PR branch image setting changed, with unrelated environment settings verified unchanged. Repeated current-head native recovery acceptance remains pending; the failed hosted run is retained as evidence and normal cancellation preserves its history through reload.

- Current-head Codex settings match all seven discovered models and six effort levels; the runtime reports its default model, low effort and Auto review. The quota-ended task's normal Stop preserves its exact refusal text and cancelled status through API readback and browser reload; independent OS readback confirms no remaining native task process. This is settings/cancellation evidence, not completed Codex readiness or long-run acceptance.

- The fresh Codex candidate now enrolls after retiring the already-stopped owned fixture. Its native readiness check started, then the linked subscription reported its usage limit; current Codex acceptance remains incomplete. A subsequent Claude long-run attempt ended early with an explicit provider safety rejection, before any forced stop. Its retained transcript and counters are preserved; it does not satisfy duration, recovery or visible-latency acceptance. The separate public-science fixture later resumed the original native session under a new generation but failed health/Drive checks; it was cancelled after preserving evidence and does not pass acceptance. A fresh candidate repeat now exercises the same workload through normal provisioning with independent source/browser and health-event observation. Available Preview Convex logs capture the later DRIVE_RUN_UNAVAILABLE failures, but their covered window excludes the historical poll failure; Sentry access is denied, so that original cause remains unproven.

- Current enrollment preflight confirms the QA workspace connection limit refuses a new Codex enrollment before a machine is allocated. Provisioning now reports that workspace limit distinctly from provider capacity/credit and records the failed phase; all 24 machine-service tests, root types, targeted lint, docs and complexity checks pass. One already-stopped owned discovery fixture was retired with provider absence, revoked environment, unchanged assistant history and nine unrelated environments verified. The original stuck invocation still lacks its own exception record; its cause remains an inference rather than confirmed historical evidence.

- Current-head native QA exposed an indefinitely allocating Codex fixture with no new machine in scoped inventory. The original invocation logs do not establish its cause. A separate reproduced setup-error path left allocation pending because enrollment creation ran outside the failure boundary; setup is now covered and pre-machine failures record a sanitized failed phase. All 23 machine-service tests, root types, targeted lint, docs and complexity checks pass. The current candidate Claude readiness smoke subsequently completed with zero rejected batches or approval cards: 26 native-reported and independently read hashes match, original native identity is verified, the 185-second quiet tool stays live, MCP readback is exact, OS readback finds no remaining native task process, and reload retains the full answer and four-tool work summary. This is readiness proof; the hour-long forced-recovery and whole-run visible-latency gates remain pending.

- Native QA preparation exposed explicit Preview restart bypassing the one-shot hosting-access renewal used by resume/recovery. Restart now uses that shared managed-host path. The regression reproduced missing access; all 22 machine-service tests now pass, covering upgraded and legacy restart paths without putting the secret in commands. Root types, targeted lint, docs health and complexity checks pass. Exact-head protected Preview now passes explicit restart on a fresh owned Claude fixture: one host, consumed private access file, unchanged approved scope and all 64 installed JavaScript hashes verified. The backend advertises the explicit restoration opt-in; forced native recovery remains pending.

- Native restoration now has an explicit per-adapter host configuration opt-in requiring durable lifecycle negotiation. The default remains off; it does not enable live interrupted-turn continuation or approval restoration. Config reload and capability tests cover direct ACP, acpx and manifest entries. The opt-in is intended for owned native QA machines; shared image and production activation remain gated on forced-recovery acceptance.

- Startup command polling now remains responsive while preparation awaits source-output or startup-admission uploads. Regression tests reproduce queued and newly delivered Stop, retain buffered source text, prevent adapter startup and preserve ordered command results. Foreign/stale cancellation cannot interrupt another execution, and cancellation after the local startup boundary cannot make it replayable. Local host tests (209 passed, one optional skip), types, lint, docs and complexity checks pass; hosted native Stop-during-preparation and forced recovery acceptance remain pending.

- Phase 5 restoration now drains the isolated source before a server-acknowledged native startup admission binds the delivery, receiver boot, source cursor and canonical text offset. Historical text/work and terminal evidence survive before admission without reporting current health or recreating executable approvals; admission closes that ingestion window. Preparation-only stops may retry the same execution under a fresh isolation readback, while an admitted uncertain startup requires a new isolated generation. Transaction and host tests cover these boundaries; hosted native acceptance remains pending and fenced restoration stays unadvertised.

- Phase 5 native startup now validates the original conversation, adapter, current delivery, isolation receipt, machine lease and approval state before recording restoration. The persisted transcript exposes Recovered after that receipt, including after reload and completion. Transaction and rendered-history tests pass; actual forced native recovery and current-head browser acceptance remain pending, and the adapter capability stays unadvertised.

- Phase 5 startup admission now distinguishes durable preparation from native startup. Preparation preserves the prior claim and identity; one transaction crosses the provider-start boundary, transfers ownership and checkpoints the original conversation under the new generation. Real SQLite tests cover reopening, exclusive startup, unknown legacy claims and checkpoint rollback; runtime tests cover a failed preparation followed by one server-authorized retry and duplicate delivery. The backend now authorizes at most three new deliveries for recognized pre-provider transport failures on the same attempt, with current authority and the fixed deadline rechecked. Preparation receipts no longer bind boot identity or provider start time; native events fence old-boot output. A retry after a new-execution write interruption reopens only its own journal and reuses that request. Hosted acceptance remains pending; fenced restoration stays unadvertised.

- Phase 5 now has a scoped read-only drive-recovery receipt lookup. Real backend/HTTP tests distinguish committed content/metadata from uncommitted requests only after the original execution is fenced, and reject mismatched identity, changed machine ownership, revoked access and stale tokens. No write is replayed. Host settlement now consumes these receipts before hydration: committed writes retain their original identity and saved baseline, while definitive noncommits archive immutable payloads before a new execution rescans local bytes. Real SQLite/cache tests cover content and metadata acknowledgement loss and reopening after settlement interruption. Preparation retries and journal ownership handling are implemented; capability activation and hosted forced continuation remain pending.

- The current candidate now passes fresh unattended Claude enrollment, native full-file hash/MCP checks and a foreground integrity monitor. Its nonsecret ACP identity matches the actual native conversation, and independent OS readback finds no remaining native task process after completion. Reload preserves the completed answer and settled tool count. Full-run visible latency and forced continuation remain unproven.

- The native restoration wire contract distinguishes loading the original session under a stopped-provider receipt from starting fresh. Guarded host takeover now retains native identity, consumes the old execution claim once and emits only new text at the canonical offset; a real ACP subprocess covers loading and replay suppression. New-attempt drive metadata is required, and unknown pending writes still fail closed. A separate backend transaction now queues a continuation on the same assistant with the full hydrated text offset, original settings and a new drive execution scope. It rejects stale ownership, changed machine bindings, unresolved approvals, revoked access, invalid funding and unknown delivery outcomes. The coordinator now joins stopped-machine inspection, durable receipt and continuation queue authorization before resume; host drive-outcome settlement is implemented, while preparation retry and hosted forced recovery remain pending. Fenced loading remains unadvertised.

- Phase 5 has an authorization-before-resume machine gate: it observes an already-stopped Boat machine, waits for the durable restoration authorization and rechecks the exact lease around resume. Orchestration tests cover rejection, live work, concurrent resume, unsupported providers and replacement during authorization or boot. The coordinator now calls this gate only for an eligible recovery state with explicit adapter capability; hosted forced recovery remains pending.

- Phase 5 adds a server-only provider-stop receipt bound to the exact execution revision, attempt, generation, environment and its admitted sandbox lease. Real Convex tests reject stale/cross-scope facts, replacement or ambiguous machines, revocation and cancellation; stable duplicate delivery is idempotent. The stopped-provider caller and native continuation queue are wired behind the unadvertised adapter capability; hosted native continuation is not yet proven.

- Phase 5 acpx closure now propagates failure, joins concurrent callers and blocks new prompts until closure is confirmed. Terminal outcomes follow native connection closure. A real subprocess/storage-failure regression verifies Stop can retry without starting another writer; native forced-restart recovery remains pending.

- Phase 5 direct-ACP loading now consumes historical answer/tool frames without republishing them as new output, including a buffered history tail after the load response. Current command metadata is retained. A real NDJSON subprocess regression verifies only the subsequent prompt contributes new answer text; execution-fenced recovery admission and its hosted smoke remain pending.

- Phase 5 identity foundation: acpx persists its ACP session id before prompting and explicitly loads that identity, even when its local acpx record is gone. Real child-process tests cover matching restoration, missing/mismatched identity refusal, load failure without fresh-session fallback, and closing the child after checkpoint persistence fails. Automatic continuation remains disabled pending provider isolation, execution fencing, fresh tool/drive credentials and pending-write reconciliation.

- Native Codex Stop now passes on protected Preview: the UI cancels an executing foreground tool, independent process readback confirms it ended, and the same assistant row retains the full pre-Stop text and all three tool calls after API readback and browser reload. Expanded history keeps completed and interrupted tools available. A singular failed-tool label found during this check is corrected. The separate native Claude scan also now passes UI cancellation with independent process-stop proof, exact retained text and three retained calls. Browser reload preserves the text, cancelled status and expanded command history. Restart recovery remains a separate gate.

- Native Codex readiness on protected Preview now completes the foreground three-minute tool, prints all 26 hashes matching the pinned baseline, and reads the exact canonical probe through Overlay MCP with zero approval cards or rejected batches. Actual native metadata identifies the default model and separate automatic reviews. Browser work summaries preserve the correct action count after reload. Whole-run latency and forced recovery remain separate gates.
- Read-only hosted QA briefly exposed saved-folder counts during catalog refresh. Both adapters created discovery scratch state inside the synced working drive. Probes now use a separate private OS temporary directory, or retain the default catalog if that cannot be isolated. Real blocked ACP/acpx probes leave the drive inventory empty throughout discovery and clean up afterwards. A fresh machine on the updated image now passes a native three-minute scan with no discovery folders in the drive, all 26 hydrated file hashes and native MCP reads. The provider used temporary script files outside the drive despite the stricter read-only prompt; this does not prove full prompt compliance.

- CI exposed a package render-test harness missing the shared stylesheet/JSX preloads; its standalone command now matches CI rendering. CodeQL flagged modulo-based verification-word selection; bounded cryptographic sampling removes that vocabulary-size assumption. Browser QA also found the settled work summary independently double-counted attached terminal details; both live and settled paths now use call identity. These CI and web UI follow-ups now pass on protected Preview.

- A fresh owned candidate machine enrolled through normal protected Preview provisioning without a manual bootstrap. Both smoke namespaces were absent before prompting; all 26 files later matched the pinned full-content Files hashes on the new machine. Fenced preparation remained healthy past the original claim window until native execution began. A foreground `sleep 180` completed with no approval cards, rejected batches or observed false stalls. The initial provider selected unavailable `python` and correctly stopped rather than retrying; the subsequent explicit `python3` native hash/MCP check passed. Browser samples cover bounded windows, not full-run latency.
- Native UI acceptance found a terminal detail counted as a second tool beside its command. Live groups and completed work summaries now count shared call keys once, retain both details and use distinct React row keys. Package render tests and typechecking pass; exact-head hosted acceptance remains pending.

- Hosted cancelled-row reload exposed history fallback dropping status-only parts. API serialization now retains lifecycle, approval and saved-file metadata together with legacy partial text; focused serialization and rendered-status regressions pass. Exact-head Preview API readback and actual browser reload now retain the visible cancelled label without running controls.

- Phase 0: current source passes required CI, all three host OS jobs and the exact-head Enhanced Preview build with hosted TypeScript validation. Clean Convex imports resolve canonical protocol source. Bounded history preserves Unicode; compiled memory reads use the store query. Historical production 500s had redacted diagnostics, so their underlying causes remain unproven.
- Phase 1: byte-budget packing, ordered/coalesced streaming, independent command polling/background uploads and immutable retry boundaries are implemented. Cancellation preserves output. Buffered-wire regressions cover final-notification ordering and synchronous pending-text capture. Synthetic long-output/Stop/reload checks pass; full native-provider acceptance and package publication remain pending.
- Phase 2: negotiated deltas, bounded anchors, canonical chunk storage and process-based liveness are implemented. Sidebar invalidation excludes text-only changes. A clean synthetic 30-minute Preview soak completed with exact full-byte/hash readback, no rejected batches or false stalls, and browser sampling below two seconds at p95. These limited browser windows are not a full-run latency trace or native-provider acceptance. Stop remains visible and cancelled output survives exact-head reload.
- Phase 3: direct ACP/acpx option discovery, per-prompt model/mode/effort application, persistence and bound-environment controls are implemented. Empty discovered catalogs offer Default rather than hard-coded models. Native approval elicitation/reconnect and execution-fenced result journals have local coverage. A real Cloud Claude readiness probe completed five tools without approval cards or rejected batches, reported Sonnet 5.5, and matched independently read machine bytes/hash. This used an explicitly recorded private Preview bootstrap; it does not prove unattended Cloud startup, the long smoke, live settings persistence or Codex acceptance.
- Phase 4 server: default-off run/attempt-scoped credentials, stable manifests, bounded verified downloads, immutable staging/sealing, guarded Files/folder commits, conflict copies, quota and retained receipts/cleanup are implemented. Live membership/edit policy and ancestor paths are rechecked; local/VPS requires opt-in. Full-byte database/object-store tests include lost acknowledgements and fresh-cache reconstruction.
- Phase 4 host: private durable write/baseline journals, serialized synchronization, OS-backed cache ownership, inode tracking and safe hydration are implemented. The runtime refreshes approved policy, hydrates before prompting, saves after actions and periodically, and awaits final save before completion. Failed final writes preserve recovery data and emit an unsaved failure. Stop forwards before draining an existing write. Bounded file/folder summaries link separately from provider text. Cloud root preparation is audited; local/VPS grants never expand automatically. Hosted Files UI, full hashes and fresh-machine acceptance remain pending.
- Candidate host/protocol versions advance together to 0.4.2. Exact-source packages are installed only on owned QA machines; npm publication and image activation remain gated. Drive flags are being enabled only for this PR's Preview web/backend acceptance, with production defaults unchanged.
- Native drive acceptance exposed credential rotation rejecting the newly negotiated drive method before provider start. The backend now allows only that negotiated extension while retaining all other method scopes. A real transaction regression reproduces the original rejection and covers missing/unsupported capability and unrelated scope escalation. The hosted retry passed rotation; subsequent drive startup acceptance remains pending.
- The next native retry passed rotation but found physical-root resolution running before initial drive creation. Runtime preparation now creates/hydrates the approved drive first. Host heartbeats also run independently of command polling with single-flight requests and shutdown drain. Physical missing-root and blocked-hydration regressions cover these paths; native hosted retry remains pending.
- The upgraded native provider reached the drive and wrote its probe files. It exposed a missing conversation-message drive-part validator and an R2 signature mismatch from duplicating a query-hoisted checksum in request headers. Real message persistence and real-presigner/host-client regressions reproduce both failures. Additive persistence and header-bound signing fixes are implemented. The original queued batch drained without a restart or resend, preserving the same message and answer prefix; the UI correctly shows the unsaved terminal state. Successful native save acceptance remains pending.
- Explicit fresh attempts now receive the full canonical answer offset and append subsequent output without replacing the retained prefix. Transaction tests cover chunk-backed lifecycle-v2 text and legacy retries; host tests cover Unicode, corrections, anchors and checkpoint-only transport. This is text preservation for explicit replacement, not automatic native-session recovery.
- Same-execution drive recovery now renews an expired pending intent after rechecking live authority and its immutable fingerprint, without allocating another upload or quota reservation. Uncertain commits reauthorize the original intent before retrying and reuse retained receipts. Cross-execution outcome reconciliation remains pending.
- The owned native probe completed an explicit fresh retry on the same message after verified provider isolation. Full prior text remains in expanded work history, both files match full-content API hashes, saved links/counts render, and host event/write journals drain. The exact-head browser opens both text uploads with complete matching rendered hashes, preserves the actual Notes editor, and opens the saved empty folder. This does not prove automatic native continuation, the full smoke or fresh-machine hydration.
- A private Cloud QA MCP relay reaches the protected Preview without passing hosting credentials to the provider. A real read-only native tool check exposed server-to-server API requests following the hosting login redirect; the internal transport now adds hosting authentication only to its configured Preview API origin and refuses redirects while retaining application authentication. The hosted native retry completed both list and read tools without approval cards or rejected batches. This remains a manually bootstrapped QA fixture.
- The native long smoke completed a three-minute foreground tool without false stalls, then exposed a protocol rejection when a provider used a long shell script as its action title. Both adapters now bound display titles before emitting action and heartbeat events. Real ACP/acpx subprocess regressions reproduce the rejection and verify Unicode, completion and unmodified answer text. Full-duration acceptance remains pending.
- Phase 5: current-execution MCP authorization, immutable approval outcomes, bounded resumable result storage and rejection of stale-attempt side effects are implemented. Interrupted native-session continuation, proof that an old writer stopped, cross-attempt pending-drive outcome reconciliation and the 60-minute recovery smoke remain pending. The absolute task deadline is verified in the actual UI; approval-expiry display remains pending.
- Graceful shutdown now stops adapters, settles prompt callbacks, drains text and drive journals, and waits for the active upload before closing SQLite. A real ACP subprocess regression reproduces the old early return; a real cache-lease check rejects replacement after an unconfirmed stop. Aborted hydration cannot launch a provider. Native shutdown/recovery acceptance remains pending; this is not automatic continuation.
- Recovery checkpoints preserve validated model, permission mode, effort and Cloud/local context without persisting MCP tokens or provider credentials. Native continuation still requires lifecycle fencing and fresh credential delivery.
- Lifecycle-v2 task deadlines now reach the transcript and render for nonterminal turns independently of control permissions. Approval expiry remains on the request card. Current-head hosted deadline/expiry acceptance remains pending.
- Smoke observers retain rate-limit headroom and distinguish observation gaps/timeouts from provider completion. Never restart or terminate a provider task because observation expired. Whole-plan acceptance below remains unchecked until its actual native-provider scope is proven.
- Both native subscription long smokes completed and every task-folder file matched original-machine and full Files API hashes. Actual saved links open in Files. Separate fresh machines now prove unattended enrollment and all 26 hydrated file hashes. Full-run visible latency, risky-action approval and forced native recovery remain unproven gates; the original manually bootstrapped fixtures alone do not prove unattended enrollment.
- Native Codex settings exposed an older combined model falsely labeled unavailable and its effort shown from the discovery default. The UI now resolves an offered base/effort pair and preserves effective effort on model changes; unsupported values stay visible. Exact-revision hosted readback shows the supported model and effort without changing the saved settings; native session metadata independently confirms both runtime values.
- Protected Preview bootstrap has one-shot host-only access, exact-origin API authentication and an active-run MCP relay. Normal hosted enrollment and idle pause/resume now pass with a private candidate image: the access file is consumed and the hosting secret stays out of inherited process environment and saved configuration. The first fresh-machine task exposed a preparation claim timeout; after its fix, fresh hydration and native Codex MCP validation pass.
- A real Boat boundary check exposed ignored requested file modes. The adapter now applies them explicitly, while Preview startup secures the host-state directory before credential delivery. Failed permission changes prevent startup; real readback verifies the requested private mode.
- Cross-platform CI exposed Darwin EPERM during ACP process-group termination. POSIX stop now reads actual process states, accepts exited zombies and still rejects live permission failures; real live/zombie regressions pass locally. Updated image and hosted/native acceptance remain required.
- Fresh-machine Workflow history confirmed the claim timer revoked drive access during hydration. A per-command preparation extension now keeps the fenced startup lease fresh without claiming provider liveness or extending the hard deadline. Expired preparation remains fail-closed; fresh-machine hosted acceptance now passes beyond the original two-minute claim window.

## Outcome

Claude Code, Codex and the other connected agents, whether on Overlay Cloud, a VPS or a person's own computer,
can run a long task and the person sees it through: text streams steadily, a running tool is shown as running,
stopping keeps what was written, permission prompts follow a mode the owner chose, the model list matches what
the agent offers, and every file the agent creates is saved in Overlay Files.

The bar is the smoke run. Claude Code on Haiku 5.5, on a subscription, completed a 44-tool research task in
3.4 minutes with no stalls and no prompts. Its 13 files were saved to object storage and restored identically
on a brand-new machine. Production connected agents must do the same through the real Overlay path.

## What is broken and why

| # | Symptom | Cause | Where |
| --- | --- | --- | --- |
| 1 | The answer stops partway and never finishes | Each streamed chunk resends the whole answer (`text_checkpoint`). The outbox uploads up to 100 events under a 512 KB batch limit. After roughly 2–5 KB of text with a backlog, the batch fails validation, and the same 100 events are retried forever. Any single answer over 512 KB can never be sent. Reproduced against the real schema. | `packages/overlay-agent-host/src/acp-adapter.ts:89`, `acpx-adapter.ts:205`, `runtime.ts:178`, `packages/overlay-agent-bridge-protocol/src/index.ts:290` |
| 2 | Stopping replaces everything with "Cancelled" | The cancel mutation overwrites the assistant message's `content` and `parts`. | `convex/agents/connectedAgents.ts:822`; `src/shared/agents/remote-agent-transcript.ts:207` |
| 3 | Looks stuck on a tool call | `emit()` waits for a network flush before the adapter takes its next update, so the visible stream lags behind the real work. When #1 wedges, the last thing on screen is a tool row. Nothing reports liveness while a tool runs. A production host log also showed control-plane 500s on poll and event upload, plus request timeouts. | `runtime.ts:373-388` |
| 4 | Overlay MCP tools hang, then fail | Approval-gated tools hold the HTTP call open for 25 s, then tell the agent to retry after approval. The route also has a 300 s ceiling. | `src/server/agents/mcp-approval-gate.ts:18,76`; `src/app/api/agent-mcp/route.ts:3` |
| 5 | Permission prompt for every command | acpx runs with `permissionMode: 'deny-all'`, so every request goes to a person. The direct ACP path stays in the agent's default "Manual" mode. No code calls `session/set_mode`. | `acpx-adapter.ts:120` |
| 6 | Stale model list | The list is hard-coded. Adapters are pinned behind: local 0.70.0, image 0.81.1, latest 0.91.0. The direct ACP adapter ignores the chosen model. | `src/shared/agents/agent-model.ts:31`; `adapter-manifests.ts:2`; `infra/agent-image/versions.json` |
| 7 | Restarts drop in-flight work | The host restarts on machine stop/resume, and ACP cannot continue an interrupted turn. | `acp-adapter.ts:44` (`interruptedTurnContinuation: false`) |
| 8 | Files stay on the machine | Agents work in the machine's own disk folder, and nothing syncs to Overlay Files. | `src/server/agents/cloud/cloud-agent-machine.ts:13` |

Verified live with `claude-agent-acp@0.91.0`: `session/new` returns `configOptions` for
- `mode`: `default` (Manual), `acceptEdits`, `plan`, `auto`, `bypassPermissions`;
- `model`: `default` (Sonnet), `sonnet` (Sonnet 5.5), `fable` (Fable 5.1), `opus` (Opus 5.5), `haiku` (Haiku 5.5), each with a description;
- `effort`: `default`, `low` … `max`.

`session/set_mode` and `session/set_config_option` both take effect before the prompt.

## Principles

1. **The agent never waits on the network.** Events go to the local SQLite outbox; a separate uploader drains
   it by cursor.
2. **Text is sent once.** Deltas carry an offset, and the server appends. Batches are filled by bytes, not
   count.
3. **Liveness is explicit.** A heartbeat names the open tools and how long the run has been quiet; a stall is
   a stated condition.
4. **The agent defines its options.** Model, effort and permission choices come from the running adapter.
5. **The drive is the source of truth.** The machine is a cache. Storage credentials never reach it.
6. **Stopping never destroys output.**
7. **Server before host.** Bridge schemas are `.strict()`, so every new field or event is first accepted by
   the server, then advertised by a host, then used. Old hosts keep working unchanged.

## Phases

Each phase is one PR to `main` unless noted, with its own preview QA. Phases 1 and 2 matter most. Phases 3 and
4 are independent of each other and can run in parallel after Phase 1.

---

### Phase 0: Make the failure measurable (small, first)

**Goal:** each later phase is judged against the same evidence.

- Promote the smoke into a repeatable check. `scripts/smoke/cloud-agent-long-horizon/harness.mts` gains a
  `--via overlay` mode that drives a real connected agent through a PR preview: create a cloud agent, mention
  it, and read the transcript through the API rather than the box. The current direct mode stays as the
  provider baseline.
- Add structured logs, with request id, route, error class and duration, to the host routes that returned 500
  in production: poll, events, acknowledge, heartbeat. Find their root causes. Likely candidates are Convex OCC
  contention from rewriting the full message on every batch, payload size, and function timeouts. Record the
  findings in the PR, not in the repo.
- Add counters per run: events received, bytes, rejected batches, max quiet gap, longest open tool. Store them
  on `conversationAgentRuns` so QA can read them back.

**Done when:** a preview smoke run reports these numbers and the 500s have a named cause.

---

### Phase 1: Stop losing output (host + server, no protocol change)

Shippable as a hotfix: works with deployed servers and with existing `text_checkpoint`.

**Host (`packages/overlay-agent-host`)**

1. **Coalesce text.** In `acp-adapter.ts` and `acpx-adapter.ts`, buffer `agent_message_chunk` text. Emit one
   `text_checkpoint` at most every 250 ms, or when 2 KB of new text has arrived, and always before any tool,
   plan, permission or terminal event so the order is preserved. Cuts event count by about 50×.
2. **Byte-budget batches.** `runtime.ts flushOutboxInternal`: add events while the encoded batch stays under
   `MAX_EVENT_BATCH_BYTES` minus about 8 KB of headroom, not a fixed 100. If one event alone is too large:
   - `text_checkpoint`: replace its text with the most recent checkpoint that fits, marked as truncated.
     Phase 2 deltas remove this case entirely.
   - Other types: already bounded by the schema.

   Never re-send a batch that fails local validation. Validate each event when it is appended.
3. **Non-blocking emit.** `emit()` appends to SQLite and calls `scheduleFlush()` without awaiting it. The
   uploader is a single loop with backoff. It owns ordering, which remains strictly by `sourceSequence` per
   stream. Backpressure: when the outbox exceeds a threshold, drop intermediate `text_checkpoint` rows for the
   same run (only the latest matters), never other events. Remove the hard 10,000-event throw from the adapter
   callback path.
4. **Unwedge existing installs.** On startup, if the head of the outbox fails validation as a batch, rebuild it
   with byte-budget packing. Hosts that are already stuck recover after upgrading.

**Server**

5. **Cancel preserves output.** `convex/agents/connectedAgents.ts` (`controlRemoteAgentTurnByServer`, legacy
   cancel branch at line 822): keep existing `parts` and `content`, mark open action parts `cancelled`, close
   pending request parts, and upsert the `cancelled` status part. Use the literal "Cancelled" only when no
   text exists. Do the same in `remote-agent-transcript.ts:203-212`. Text that arrives after cancel, before
   the host confirms its stop, is still appended. Today it is dropped as post-terminal.
6. **Cheaper ingestion.** `applyRemoteEventsByServer` patches the message once per batch, not once per event,
   and skips the patch when only heartbeat or observation events arrived. This reduces OCC conflicts, a
   suspect for the 500s.

**Tests**
- `runtime.test.ts`:
  - 30 KB of text in 20-character chunks while uploads fail for the first N attempts; assert every event is
    eventually acknowledged and the final text is exact.
  - A >600 KB answer completes with a truncation marker and a `completed` event.
  - A pre-wedged SQLite outbox recovers on start.
- Protocol: byte packing never yields a batch the schema rejects (property-style test over random sizes).
- Convex: cancel after streamed text keeps the text and tool parts. Cancel with no text shows "Cancelled".

**Release:** server PR, then the host package (lockstep bump of `@layernorm/overlay-agent-host` and the
protocol), then image v7 (`infra/agent-image/versions.json`) and `OVERLAY_AGENT_HOST_PACKAGE_VERSION`. Upgrade
idle hosts only, as the existing lifecycle rules require.

**Done when:** the Phase 0 smoke through Overlay streams a long answer (≥ 20 KB) with zero rejected batches,
and cancel mid-stream keeps the text.

---

### Phase 2: Deltas and liveness (protocol extension)

**Protocol (`packages/overlay-agent-bridge-protocol`)**

1. Add an optional host capability `streaming: { textDeltas: true, heartbeats: true }` to
   `hostCapabilitiesSchema`, as an optional field. Server first.
2. Add new event types, sent only when the server echoes support in the poll response (the same negotiation
   pattern as `remoteLifecycleVersion`):
   - `text_delta`: `{ offset, text }`, where `offset` is the character count before this text. The server
     appends only when `offset` equals the current length, which makes it idempotent; a mismatch rejects the
     batch with `expectedSequence`, so the host resends from the cursor.
   - `heartbeat`: `{ quietMs, openTools: [{ actionId, title, runningMs }] }`, at most one every 10 s per run,
     with no transcript row. `process_observation` stays for lifecycle v2.

   The host keeps sending a `text_checkpoint` every 64 KB as a recovery anchor.

**Host:** emit `text_delta` from the coalescer when negotiated. Emit a heartbeat from a per-run timer while a
turn is active, the same mechanism as `driver.mjs` in the smoke. After 90 s quiet with an open tool, set
`stalled: true` on the heartbeat.

**Server and UI**
- Persist negotiated text in indexed, bounded Convex chunks. The assistant row keeps stable text-part
  references and a short preview cache; authorized history, room, share and agent-context reads hydrate
  each logical text part before returning it. Chunk boundaries must never split Unicode code points or
  become Markdown boundaries. Only changed tail chunks are written. Legacy rows need no migration;
  hard message deletion removes owned chunks. Text changes still emit conversation events even when
  the assistant row itself is unchanged. This avoids both the single-document limit and full-message
  rewrites; no stream content is silently truncated.
- A quiet tool is not stalled while the adapter reports a live process. The 90-second warning needs
  missing/unknown process evidence; a missing heartbeat is reported as a connection problem.
- `remote-agent-transcript.ts`: `text_delta` appends. `heartbeat` updates a small `liveness` field on the run
  (`lastActivityAt`, `openTools`, `stalled`), not the message parts.
- The chat status line uses liveness:
  - "Running Web search · 42 s", or "Working · last update 8 s ago";
  - on a stall: "Web search has been running for 2 min" plus a Stop action.

  Keep loading dots at the bottom and tool rows collapsed and sequential, per AGENTS.md.
- Supervision (`DURABLE_REMOTE_AGENT_RUNS.md`): a run with fresh heartbeats is never treated as abandoned,
  however long a tool runs. Missing heartbeats past a grace period, not quiet output, drive
  `needs_attention`.

**Tests:** delta idempotence (duplicate and out-of-order batches); a mixed fleet where an old host still uses
checkpoints; a UI unit test for status-line states; liveness never writes message parts.

**Done when:** a 30-minute smoke run shows a live status line throughout with no false "stalled" state, and
message rewrites per run drop by at least 10×.

---

### Phase 3: Agent settings from the agent (permission modes, models, effort)

1. **Adapter versions.**
   - Bump `CLAUDE_AGENT_ACP_PACKAGE_VERSION` to 0.91.x and `codex-acp` to the current 2.x in
     `adapter-manifests.ts` and `infra/agent-image/versions.json`.
   - Verify that acpx's own pinned range (`^0.76.0`) does not override the image install. If it does, set the
     acpx registry override to the installed binary.
   - Add a weekly CI job that opens a PR when either adapter publishes a new version and the conformance tests
     pass.
2. **Discover options.** On `discover()`, each ACP adapter runs a throwaway `initialize` + `session/new` in a
   temp directory, reads `configOptions` (falling back to the older `models` and `modes` fields), and closes
   the session. Credentials come from the stored provider account if one is present; otherwise only static
   defaults are used. Report the result on the adapter capability as optional fields
   `options: { model, mode, effort }`, each with values, labels and descriptions (server first). Refresh on
   host start and every 24 h.
3. **Store and render.**
   - The server stores the latest options per environment adapter.
   - `AgentModelField` / `CloudAgentModel` render from them, ordered by quality (`CHAT_MODEL_QUALITY_PRIORITY`
     mapping) with "Default" first.
   - `agent-model.ts` keeps the static list only as a fallback before the first discovery.
   - Model ids remain the agent's own aliases, `byo/claude-code#haiku`.
4. **Permission mode setting.**
   - New agent field `permissionMode`, with the values the adapter reports.
   - Defaults: Overlay Cloud uses `auto`, since the machine is isolated and disposable; local and VPS use
     `acceptEdits`.
   - Bypass on a local machine requires an explicit confirmation explaining the risk.
   - It is sent in start-command metadata.
5. **Apply before every prompt.**
   - The direct ACP adapter calls `session/set_mode` (or `set_config_option` for `mode`) and applies the model
     and effort. Today it applies nothing.
   - The acpx adapter sets the mode via its runtime. It keeps bridging permission requests that the mode still
     raises, instead of `deny-all` rejecting them silently. Requests raised under Auto still show the existing
     approval card.
   - A mode or model the agent no longer offers fails the run with the agent's own message.
6. **Overlay MCP approvals.** Under `auto` and `bypassPermissions`, Overlay tools allowed by the agent's
   tool-access level are pre-approved, so the 25 s gate is skipped. For tools that still need approval, choose a durable flow:
   - **(a) Preferred if supported:** MCP elicitation from the Overlay MCP server, so the agent sees a normal
     pending request rather than a failure. Verify Claude Code and Codex support for it first.
   - **(b)** Return a structured "approval pending" result immediately. Once the person decides, inject a
     short follow-up prompt into the same session.

   Selected (a): native Claude and Codex form/reconnect probes pass. Upgraded hosts use one signed
   canonical card and a durable result journal; remove "call again" instructions on that negotiated path.
   Legacy hosts retain their compatibility flow until upgrade. Auto never bypasses an explicit owner
   tool policy; ordinary granted tools are already immediate.
7. **UI**, matching the mockup's settings card: a segmented Permissions control (Manual · Edits · Plan · Auto ·
   Bypass) with one line of help, a Model select and an Effort select. Lucide icons only, existing chrome.

**Tests:** the discovery parser handles both `configOptions` and legacy shapes; the mode is applied before the
prompt in both adapters; fallback list behaviour; tool-group/`LATER_GROUP_MEMBERS` unaffected; Playwright QA on
preview for settings persistence.

**Docs:** `bring-your-own-agents.md`, `tool-catalog.md` (pre-approval rules), `agent-profiles.md` if the
imported settings now include the mode.

**Done when:** a new Claude Code agent shows Sonnet 5.5 and Haiku 5.5 with no code change, and the smoke task
in Auto mode completes with zero prompts on Overlay Cloud.

---

### Phase 4: The drive (agent working folder = Overlay Files)

Write a short design note first, as its own section in this file or a sub-plan, then implement behind
`connectedAgentDrive` (default off).

#### Implementation design (source work in progress)

- **Authority:** resolve scope from the persisted agent and binding, never a host-supplied user/workspace/path.
  Personal means the creator's personal files within that workspace; workspace means workspace-shared files.
  Revalidate the invoking member and existing content edit policy on every commit. Readable does not imply
  writable: another member's workspace file retains its current edit rules. Revocation, scope changes,
  terminal runs and stale lifecycle attempts revoke access before issuing URLs or accepting commits.
- **Transport:** a separate signed drive token carries run, attempt/generation, binding, scope and owner.
  It authorizes only manifest, download, upload-intent and commit operations at `/api/agent-drive`.
  Tokens and presigned URLs stay out of transcript/logs. Local/VPS is opt-in; cloud defaults on only after
  `connectedAgentDrive` is enabled. Never reuse provider credentials or grant object-store keys.
- **Canonical files:** Convex owns path-to-file mapping, scope, revision checks, quota and idempotency.
  Reuse real `files` rows/folders and existing object-store adapters. Object keys remain file-owner/file-id
  keys, not a workspace prefix invented by the host. Upload each version to a new immutable key; publish its
  row pointer only in the guarded commit, so a racing upload cannot overwrite the currently visible object.
  Verify uploaded size and SHA-256 server-side before commit; a host checksum or HEAD size alone is not proof.
  Full text lives in the object with `textInObjectStore`; row text is only a searchable prefix.
- **Manifest:** page a stable scope snapshot with parent relationships, file ids, revision, hash, size and
  content kind. Inline-only text rows must be materialized from their full canonical content. Reject cycles,
  ambiguous sibling names and unsafe paths explicitly. Preserve Unicode names; never silently merge names
  through normalization/case folding. Record unsupported names rather than dropping them from acceptance.
- **Machine cache:** cloud uses `/home/user/drive`; local uses a dedicated child of the approved root.
  The host checks each segment with `lstat`, rejects symlinks/special files and traversals, writes downloads
  atomically, verifies hashes and keeps a private journal outside the drive. Never scan the person's entire
  home or the original workspace. Serialize sync per scope cache to avoid two turns mutating it concurrently.
- **Sync:** hydrate before prompting, diff hashes after writing tools and every 15 seconds, then final-sync
  before forwarding completion. A failed final sync leaves an actionable unsaved state and prevents successful
  completion. Persist idempotency keys before upload; retry the same intent/commit after acknowledgement loss.
  Deletions apply only to previously hydrated entries: missing/unhydrated files are never inferred deleted.
  Moves carry file id and revision, preserving row identity; writes racing a newer revision save a distinct
  `name (agent).ext` sibling and report the conflict. Folder operations cannot escape the fixed scope.
- **Bounds:** start with 16 MiB per hydrated file, 256 MiB cached bytes and 10,000 manifest entries. The server
  enforces the account's tighter quota too. Oversized entries remain explicit manifest-only entries and must
  not become empty files or deletions. Lazy hydration beyond these limits remains a later FUSE/cache feature;
  ordinary deliverables must still pass full-byte fresh-machine verification.
- **Proof:** test path/symlink/scope boundaries, stale revisions/attempts, conflict copies, quota, exact text
  beyond the searchable prefix, lost acknowledgements and final-sync failure. Hosted acceptance must read the
  actual Files rows, compare object SHA-256 values, and recreate the machine with an empty cache.

**Model**
- Personal agent → the owner's personal files. Workspace agent → the workspace's files. The scope is fixed by
  the agent binding and enforced by the server.
- On the machine, the drive is `~/drive` (Overlay Cloud) or a dedicated folder inside the approved root
  (local/VPS). It is the agent's `cwd`.
- Overlay Files are rows with folders, and objects keyed by `fileId`
  (`src/shared/storage/storage-keys.ts`). The host addresses files by path; the server maps path ↔ row.

**Flow**
1. **Hydrate** at session start: the host asks the server for a manifest (path, fileId, revision, sha256,
   size) and downloads through presigned GETs. For large drives, download only the manifest and hydrate on
   first read later; files over a size cap stay manifest-only.
2. **Write through** after every file-writing tool event (`edit`, `delete`, `move`, `execute`) and every
   15 s:
   - The host hashes the drive and diffs it against the manifest.
   - For each change, it asks the server for a presigned PUT, uploads, then commits. The commit creates or
     updates the row with size, sha256 and folder, and follows the `textInObjectStore` rules.
   - The commit is guarded by the revision read at hydrate. A conflict saves the agent's version as
     `name (agent).ext` and reports it in the transcript. Deletes and moves are explicit commits.
3. **Final sync** at turn end, before `completed` is emitted. The run is not settled until the sync is
   acknowledged.
4. **Visibility:** the transcript shows "Saved 13 files to your drive" with links. The Files UI shows them
   immediately, since the rows are real.

**Security:** the endpoints are authorized by a run-scoped token like `ovmcp_`, limited to the drive scope and
the run's lifetime. The machine never holds R2 keys. Enforce quota on commit. Uploads are checked by size and
sha.

**Later (not this phase):** a FUSE mount (Boat machines have `/dev/fuse`) with short-lived, prefix-scoped
credentials for very large trees.

**Tests:** path ↔ row mapping (nested folders, renames, unicode); a conflict path; quota rejection; a host
sync loop with fake storage; the Phase 0 smoke via Overlay. Files created by the agent appear in Overlay Files,
then appear again on a fresh machine.

**Docs:** `bring-your-own-agents.md`, `api-route-catalog.mdx` / `compact-api-route-catalog.mdx` for the new
routes, `api-source-of-truth.mdx`.

**Done when:** the smoke via Overlay shows all deliverables in Overlay Files with matching hashes, and
rehydration on a new machine matches.

---

### Phase 5: Long-horizon resilience

1. **Never idle-stop with an open turn or fresh heartbeat.** `environmentHasActiveRunsByServer` already
   covers sessions. Add the Phase 2 liveness so a long tool keeps the machine awake
   (`internal/develop/agent-machine-idle.md`).
2. **Continue after a restart.** When a host starts with a run whose process was lost, and the adapter
   supports `loadSession`:
   - load the session;
   - send a short continuation prompt ("You were interrupted. Continue the task from where you stopped; files
     in the drive are current.");
   - mark the turn `recovered` in the transcript.

   Only do this when the lifecycle-v2 fencing proves the old process is gone. Otherwise keep
   `needs_attention`.
3. **Turn deadlines visible.** The task hard deadline and the approval expiry (lifecycle v2) are shown in the
   status line instead of failing silently.
4. Close out the 500s found in Phase 0. Poll and upload get timeouts and retries with jitter on the host;
   server handlers stay under Convex limits.

**Done when:** a 60-minute smoke survives a forced machine stop/resume mid-run and finishes with the same
assistant message.

## Rollout order

| Step | Ships | Compatible with |
| --- | --- | --- |
| 1 | Phase 1 server (cancel, ingestion) | all hosts |
| 2 | Phase 1 host 0.3.12 + image v7 | current server |
| 3 | Phase 2 server accepts `streaming` capability and new events | old hosts (fields optional) |
| 4 | Phase 2 host 0.4.0 negotiates deltas/heartbeats | old servers (falls back to checkpoints) |
| 5 | Phase 3 server accepts adapter `options`; UI uses them with fallback | old hosts |
| 6 | Phase 3 host/image with adapter bumps, discovery, mode application | |
| 7 | Phase 4 behind `connectedAgentDrive`, enabled for preview then internal workspaces | |
| 8 | Phase 5 | |

Every host release follows the existing lockstep publish (protocol, then host) and the image rebuild
(`infra/agent-image/publish-boat.mts`). Upgrade idle or drained hosts only.

## Acceptance (whole plan)

Run the Phase 0 smoke through Overlay preview with Claude Code on a subscription, and the same with Codex:

- [ ] Long task (≥ 30 min, ≥ 40 tool calls) completes; no rejected batches; stream visible throughout
- [ ] Max visible lag between agent output and UI under 2 s at p95
- [ ] Zero false stalls; a forced 3-minute tool shows "running" the whole time
- [ ] Stop mid-run keeps all text and tool rows
- [ ] Auto mode: zero prompts for ordinary work; risky actions still surface one card
- [ ] Model list matches the adapter's live list; the chosen model is reported by the agent
- [ ] All deliverables present in Overlay Files with matching sha256; identical after rehydrating a new machine
- [ ] Forced machine stop/resume mid-run recovers on the same message

## Open questions

1. MCP approvals use elicitation for verified Claude/Codex clients; retain hosted acceptance in Phase 3 step 6.
2. Default for Overlay Cloud: `auto` or `bypassPermissions`? The plan proposes `auto`, so destructive
   commands still ask.
3. Drive size cap and lazy hydration threshold.
4. Should local agents get a drive folder by default, or only when the owner turns it on? The plan proposes
   opt-in for local and default-on for Overlay Cloud.
5. Retain intermediate text checkpoints at all once deltas ship, or only the 64 KB anchors?
