# Reliable connected agents

Status: Phase 0 implemented; preview acceptance in progress. Phase 1 implementation complete, provider acceptance pending; Phase 2 implementation and preview acceptance in progress; Phase 3 pending; Phase 4 foundation in progress; Phase 5 in progress.
Date: 2026-10-15.
Related: [`DURABLE_REMOTE_AGENT_RUNS.md`](./DURABLE_REMOTE_AGENT_RUNS.md) (run lifecycle v2),
[`internal/develop/bring-your-own-agents.md`](../develop/bring-your-own-agents.md),
mockup [`mockups/reliable-agents-mockup.html`](./mockups/reliable-agents-mockup.html),
smoke [`scripts/smoke/cloud-agent-long-horizon/`](../../scripts/smoke/cloud-agent-long-horizon/).

## Progress

- Phase 0 hosted compilation still requires acceptance. An opt-in build resource sampler now records Node worker heap limits, RSS, CPU and GC totals to distinguish memory pressure from idle waits; it preserves worker isolation and TypeScript checks.

- Phase 4 backend metadata commits now create folders, preserve file identity on moves and require explicit child deletion. Same-transaction receipts fence retries to the run/attempt; scope, edit policy, revisions and parent cycles are checked. Object bytes remain charged until cleanup. Uploads, HTTP wiring and host synchronization remain pending.

- Phase 4 expected drive failures now use structured Convex application data; redacted production responses retain safe HTTP statuses in both current-authority and pinned-snapshot queries. Local transport and Convex tests pass; hosted acceptance remains pending.

- Phase 5 MCP authorization now binds delivered credentials to the current session and execution generation without extending expiry. Approval polling and final tool execution recheck authority; replaced attempts cannot create new approval cards. Legacy first-attempt compatibility remains. Interrupted-turn continuation, durable pending-tool follow-up and the 60-minute recovery acceptance remain pending.

- Phase 0 CI corrections record the new drive route/readers in the reviewed on-prem inventory and remove a syntax-only zero-argument broker assertion. Native-auth boundary and token refresh tests remain enforced; current-head hosted acceptance is pending.

- Phase 0 preview build recovery now uses isolated Webpack compilation with memory optimizations and fixes an invalid reusable account-page export. Local cold compilation, TypeScript and route generation pass with hosted typechecks retained; exact-head Vercel acceptance remains pending.

- Phase 4 read HTTP transport now exposes bearer-only, default-off NDJSON manifests and bounded download ranges with full-source verification, live authority checks, request limits and private responses. Real service/token integration and large-file reconstruction tests pass locally. Start-command token issuance, guarded writes, host sync and hosted acceptance remain pending.

- Phase 1 stream recovery fixes now preserve message event revisions through room history and subscriptions, including chunk-only changes, and recover browser token issuance after a 401 using the shared session refresh. Real query-to-UI merge regressions cover stale snapshots; current-head hosted acceptance remains pending.

- Phase 0 smoke observation now leaves API rate-limit headroom, honors 429 cooldowns without resending work and preserves active machines when observation expires. Reports distinguish observation timeout from terminal failure and retain unobserved intervals; a rate-limited gap prevents smoke acceptance even if the task completes. Cleanup verifies successful responses.

- Phase 4 manifest/download service now pins metadata pages to one database timestamp while checking live authority separately. Inline notes use exact-revision references; ready-file grants bind the full entry to its run/scope/attempt/expiry. Download readback verifies canonical bytes and checks revocation again before return. Start-command token issuance, writes and host sync remain pending.

- Phase 4 reads now have a default-off Convex authority gate on every bounded manifest page and exact-revision storage lookup. The real server reader bounds configured object-store/Convex reads and verifies Convex blob hashes; R2/S3 caps are enforced during streaming. Atomic file commits, journaling, runtime sync and hosted acceptance remain pending.

- Phase 0: required CI passed on the earlier preview revision; current-head CI and hosted acceptance remain pending. Real host/API counters and rendered preview QA are being checked. Smoke readback now reconstructs omitted content from API text parts and cancellation verifies the exact retained prefix; subscription-provider smoke and current-head browser acceptance remain under verification. Historical production error details were redacted, so their underlying causes remain unproven.
- Phase 1: byte-budget packing, ordered text coalescing, independent command polling/background uploads, immutable attempted sequences, cancellation preservation and unchanged-observation write suppression are implemented. Focused streaming and Convex regressions pass; earlier-revision deterministic transport/UI checks pass, while successful provider acceptance and publication remain pending.
- Phase 1 earlier-preview deterministic transport completion and browser Stop/reload checks passed. This does not substitute for successful subscription-provider acceptance.
- Phase 2: negotiated deltas, bounded anchors, heartbeat status and chunked canonical text storage are implemented with focused regressions. Large text, tenant boundaries, cancellation buffering, Unicode boundaries and fewer assistant-row writes are covered locally; current-head hosted and timed acceptance remains pending.
- Hosted compatibility QA exposed a final-notification ordering race. A buffered-wire regression now verifies that all text precedes completion in both streaming modes; the direct ACP transport drains updates in wire order. Full-text hosted readback remains an acceptance gate.
- All later acceptance items remain unchecked until verified through the preview.
- Phase 4 design is recorded below. The dedicated host-cache foundation has atomic hash-checked hydration, bounded snapshots and traversal/symlink checks with fresh-cache byte tests. Manifest candidate mapping preserves hierarchy and scope, rejects ambiguous paths and keeps full-object references. Real Files commits, journaling and runtime integration are still required; this is not a persistent-drive implementation or acceptance result.
- Drive token and authorization helpers now fence the exact session/attempt and reread membership, binding, environment and agent visibility. Local/VPS requires opt-in. These helpers guard read HTTP requests; atomic file commits remain pending.
- Clean-checkout Convex tests now resolve the protocol source directly, matching TypeScript. The full Convex suite passes without generated protocol output; a concurrent text/tool regression also verifies the coalescer captures pending text before later updates arrive. Required CI must be rerun on the fix.

- The server manifest materializer verifies full source bytes and download size/hash, rejects changed or truncated reads and marks oversized entries explicitly deferred. Its reader now uses configured object storage and guarded Convex sources; runtime integration remains pending.

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
   tool-access level are pre-approved, so the 25 s gate is skipped. For tools that still need approval, pick
   one of these (decision needed):
   - **(a) Preferred if supported:** MCP elicitation from the Overlay MCP server, so the agent sees a normal
     pending request rather than a failure. Verify Claude Code and Codex support for it first.
   - **(b)** Return a structured "approval pending" result immediately. Once the person decides, inject a
     short follow-up prompt into the same session.

   Either way, remove the "call again" text.
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

1. MCP approvals: elicitation (needs agent support) or injected follow-up prompt? See Phase 3 step 6.
2. Default for Overlay Cloud: `auto` or `bypassPermissions`? The plan proposes `auto`, so destructive
   commands still ask.
3. Drive size cap and lazy hydration threshold.
4. Should local agents get a drive folder by default, or only when the owner turns it on? The plan proposes
   opt-in for local and default-on for Overlay Cloud.
5. Retain intermediate text checkpoints at all once deltas ship, or only the 64 KB anchors?
