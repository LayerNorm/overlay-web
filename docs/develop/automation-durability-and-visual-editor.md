# Automation Durability + Visual Editor

> **Status:** Approved 2026-01. Steps 1–4 complete (implementation + tests).
> **Commits:** `AUTOMATIONS STEP {#}: {message}`

## Problem

Automations run as a single 800s HTTP request wrapping one giant agent turn. There is no mid-run checkpoint — when the budget is exceeded, everything is lost. The UI is a static, non-interactive SVG generated from a lossy `graphSource` string derived from instruction prose. Neither durability nor a meaningful visual editor can be built on top of the current data model.

## Architecture

Two workstreams converge on one shared prerequisite:

- **Logic:** Migrate automation runs from a single HTTP request to durable, resumable step execution via Vercel Workflow SDK's `WorkflowAgent`.
- **UI/UX:** Replace the static SVG flowchart with an interactive `@xyflow/react` canvas that doubles as a live run viewer.
- **Shared blocker:** Model the automation as a versioned graph (`AutomationGraph`) with real nodes and edges, instead of a derived string.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Durability SDK | Vercel Workflow SDK (`workflow` + `@ai-sdk/workflow`) | Event log + deterministic replay; `sleep()` and hooks for scheduling/approval; no run-duration cap |
| Interactive canvas | `@xyflow/react` v12 (MIT) | Mature, TypeScript-native, controlled-state model fits React 19 |
| React Flow attribution | Keep the badge | MIT permits removal but maintainers ask for Pro subscription; we keep it |
| On-prem parity | Hard requirement from day one | `@workflow/world-postgres` or extend existing durable job system — Step 7 |
| Graph model scope | Full node kind set from day one, linear execution only in Step 3 | Schema supports branching/parallelism; execution wiring deferred to Step 5 |
| Interactive chat | Not migrated | No durability problem; 290s is acceptable; resumable streams already exist |

## Vercel Workflows Pricing

Verified 2026-01 from <https://vercel.com/docs/workflows/pricing>:

| Resource | Hobby Included | On-demand |
| --- | --- | --- |
| Workflow Events | 50,000/month | $0.02 per 1K events |
| Workflow Data Written | 1 GB | $0.50 per GB |
| Workflow Data Retained | — | $0.50 per GB-month |

Functions invoked by Workflows are billed at existing Fluid Compute rates. Key limits: 25K events/run, 10K steps/run, 50 MB payload, 2 GB state/run, no run-duration cap, no sleep-duration cap.

**Cost estimate for our scale:** Each automation run with ~6 steps produces ~12-18 events (step started + completed per step). At 50K events/month included, we can run ~3K-4K automation runs/month on Hobby before on-demand pricing kicks in. Data written is negligible (small JSON state per step). The dominant cost will be Fluid Compute for the actual LLM calls, which we already pay for.

## Step 1B Spike Results — Workflow SDK Viability

**Status: VIABLE. Proceed to Step 3.**

### What was verified

1. **`withWorkflow` + `withSentryConfig` + `withBundleAnalyzer` composition** — works correctly. The composition order is `withWorkflow(withBundleAnalyzer(withSentryConfig(nextConfig)))`. No webpack conflicts.

2. **Proxy matcher fix** — `src/proxy.ts` matcher updated to exclude `.well-known/workflow/`. Without this, the proxy intercepts `POST /.well-known/workflow/v1/flow` and causes `[local world] Queue operation failed` with `Cannot perform ArrayBuffer.prototype.slice on a detached ArrayBuffer`.

3. **TypeScript plugin** — added `workflow` plugin to `tsconfig.json` for IntelliSense and type-checking of `"use workflow"` / `"use step"` directives.

4. **Spike workflow** — a temporary workflow with two `"use step"` functions and a `sleep("30s")` was used to verify the SDK locally. The development-only source and public trigger were removed in Phase 0; product execution uses the authorized automation routes.

5. **Typecheck passes** — `npx tsc --noEmit` completes with zero errors including all workflow files.

### API shape (corrected from initial assumption)

- `sleep` is imported from `workflow` (available inside the workflow context)
- `start` is imported from `workflow/api` (used in route handlers)
- `"use workflow"` and `"use step"` are directives placed inside function bodies, not imports
- Step functions are regular async functions with `"use step"` — there is no `step.run()` API in this version
- `FatalError` and `RetryableError` are imported from `workflow` for error control

### `@workflow/world-postgres` viability for on-prem

**Viable.** The Postgres World (`@workflow/world-postgres@4.3.3`) uses PostgreSQL for storage and graphile-worker for job processing. Requirements:

- **Long-running process** — our on-prem deployments already run on long-lived servers, not serverless. ✅
- **PostgreSQL** — we already have Postgres infrastructure. ✅
- **Configuration** — set `WORKFLOW_TARGET_WORLD="@workflow/world-postgres"` and `WORKFLOW_POSTGRES_URL` (can reuse existing connection string). Falls back to `DATABASE_URL`.
- **Migration** — run `npx --package=@workflow/world-postgres bootstrap` to create workflow tables (idempotent).
- **Instrumentation** — add `instrumentation.ts` to call `getWorld()` and `world.start()` on server init.
- **NOT compatible with Vercel** — Vercel deployments automatically use the Vercel World with zero config. On-prem uses the Postgres World. This aligns with our dual-backend architecture.

### Version risk

- `workflow@4.8.0` (published 2026-07-31, stable)
- `@ai-sdk/workflow@1.0.52` (published 2026-08-04, stable)
- `DurableAgent` is deprecated in favor of `WorkflowAgent` — the API surface is still settling but `WorkflowAgent` is the recommended path forward.

## Dependency Graph

```
Step 1: B1 graph model  +  Phase A spike        ← parallel, de-risks both halves
   │
   ├── Step 2: B2 read-only ReactFlow canvas    ← depends on B1 only
   │      │
   │      └── Step 4: B3 editable canvas        ← depends on B2
   │             │
   │             └── Step 6: B4 live run overlay ← depends on B3 + Step 3
   │
   └── Step 3: Phase C WorkflowAgent            ← depends on B1 + Phase A
          │
          ├── Step 5: Phase D sleep/hooks        ← depends on Step 3
          └── Step 7: Phase E on-prem parity     ← depends on Step 3

Step 8: Production rollout + cleanup             ← depends on all above
```

Steps 2 and 3 can run in parallel after Step 1. Steps 4, 5, and 7 can run in parallel after Steps 2 + 3.

---

## Step 1 — Foundation + de-risking (parallel) ✅

### 1A. Graph model (B1) ✅

**Goal:** Make the automation graph a first-class, versioned, persisted data structure.

**Status:** Complete. Schema, migration, round-trip tests, and fallback resolution all implemented.

**Deliverables:**
- ✅ `AutomationGraph` TypeScript schema in `packages/overlay-app-core/src/contracts/automations.ts`:
  - `version: 1` (constant `AUTOMATION_GRAPH_VERSION`)
  - `nodes: Array<{ id, kind, label, config, position? }>` — `kind`: `trigger | prompt | tool | condition | output`
  - `edges: Array<{ from, to, condition? }>`
  - Note: Uses TypeScript interfaces, not Zod — sufficient for the type-safe contract.
- ✅ `graph` JSON field on Convex `automations` table (`convex/schema.ts` line 844)
- ✅ `graph` JSON field on Postgres `automations` table (Drizzle schema + migration `0043_automation_graph_column.sql`)
- ✅ Migration: existing rows with `graphSource` are backfilled at read time via `resolveAutomationGraph()` fallback chain (persisted graph → migrate from graphSource → build from instructions → default). No SQL-level data conversion needed.
- ✅ `graphSourceFromAutomationInstructions` derives from the graph model (`automations.ts` line 207)
- ✅ Round-trip tests: graph → graphSource → graph is stable (`automations.test.ts` line 203)
- ✅ `instructions` remains the primary authoring surface; graph is the refinement surface

**Gate:** Schema reviewed, migration tested, round-trip tests pass (15/15), existing automations page works unchanged.

### 1B. Workflow SDK spike (Phase A)

**Goal:** Prove Workflow SDK is viable in our stack. Clear kill criterion.

**Status:** Viability verified; the temporary spike is not part of the shipped API.

**Deliverables:**
- Add `workflow` + `@ai-sdk/workflow` to `package.json`
- Compose `withWorkflow` with existing `withBundleAnalyzer(withSentryConfig(...))` in `next.config.ts`
- Fix proxy matcher in `src/proxy.ts` to exclude `.well-known/workflow/`
- Trivial two-step workflow with `sleep("30s")` between steps (temporary verification only)
- Document `@workflow/world-postgres` viability for on-prem

**Kill criterion:** If `withWorkflow` + `withSentryConfig` conflict irreconcilably, or `world-postgres` cannot meet on-prem requirements, stop and evaluate alternatives.

**Gate:** Viability was verified locally. No public spike endpoint is shipped; production workflow starts must use an authenticated, authorized product route.

---

## Step 2 — Read-only ReactFlow canvas (B2) ✅

**Goal:** Replace the static SVG with a clean, auto-laid-out, pannable/zoomable read-only canvas using our design tokens.

**Status:** Complete. Canvas renders behind `reactflowCanvas` feature flag (checked via `resolveOverlayAppShellConfig` in `AutomationEditorPanel`). `autoLayout` extracted to pure logic module with 9 unit tests.

**Deliverables:**
- ✅ `@xyflow/react@^12.11.2` + `dagre@^0.8.5` + `@types/dagre@^0.7.54` in `package.json`
- ✅ Custom node components styled with `var(--surface-elevated)`, `var(--border)`, `var(--foreground)`, `var(--muted)`, Lucide icons
- ✅ `AutomationGraphCanvas` reads from `AutomationGraph` model
- ✅ Dagre auto-layout with persisted positions; "tidy up" button
- ✅ Lazy-load the canvas (dynamic import in `editor-form.tsx`)
- ✅ Feature flag: `reactflowCanvas` in app-shell registry, checked in `AutomationEditorPanel` via `resolveOverlayAppShellConfig`. Falls back to SVG preview when disabled.
- ✅ Keep old SVG renderer (`AutomationGraphPreview`) for sidebar/chat card previews
- ✅ `autoLayout` extracted to `packages/overlay-modules-react/src/automations/auto-layout.ts` (no React/CSS imports) for testability
- ✅ Tests: 9 unit tests for `autoLayout` (`reactflow-canvas.test.ts`)

**Gate:** Visuals approved on staging. No regressions. Existing automations render correctly. 9/9 layout tests pass.

---

## Step 3 — Durable execution behind a flag (Phase B + C) ✅

**Goal:** Run automation turns via `WorkflowAgent` with step-level durability, retries, and resumability.

**Status:** Complete. Deployed to staging. Routes live and properly gated by `automations` capability. Feature flag `durableAutomations` defaults to off; existing coordinator path remains as fallback.

**Service authentication:** Scheduler inputs contain identifiers and execution data only. Each HTTP step mints a new path- and method-bound service credential immediately before its request. Never serialize the 60-second service tokens into a workflow input: scheduled sleeps and approval waits outlive them and will otherwise produce deterministic `401 Unauthorized` failures.

**Deliverables:**
- ✅ `workflows/automation-run.ts` with `"use workflow"` directive
- ✅ Decompose act pipeline into `"use step"` functions: `prepareExecution` → `executeActTurn` → `finalizeRun`
- ✅ Move non-serializable construction inside step functions (pass identifiers + service token, not instances)
- ✅ New API routes: `POST /api/v1/automations/{id}/run`, `GET /api/v1/automations/{runId}/stream`
- ✅ Internal endpoints: `POST /api/v1/automations/execute` (prepare), `PATCH /api/v1/automations/execute` (finalize)
- ✅ Store `workflowRunId` on `automationRuns` table (Postgres migration 0042 + Convex schema field)
- ✅ Feature flag: `durableAutomations` in app-shell registry + `OVERLAY_FEATURE_DURABLE_AUTOMATIONS` env var
- ✅ Existing coordinator remains as fallback (flag off → existing executor path)
- ✅ `RetryableError` for 5xx (server errors, retryable), `FatalError` for 4xx (client errors, permanent)
- ✅ Typecheck passes, staging deploy successful
- ✅ Tests: 12 service-layer tests + 15 workflow helper tests + 7 feature flag tests + 6 stream route contract tests = 40 total (all pass)
- ✅ Debug `console.log` removed from run route

**Implementation notes:**
- The workflow calls existing API endpoints via HTTP fetch with service auth tokens, preserving the existing act route logic unchanged.
- `prepareExecution` is idempotent: if `conversationId` is already set (from a previous completed step), it reuses it.
- `finalizeRun` is idempotent: 404/409 responses are treated as success (turn already settled).
- The trigger route (`POST /api/v1/automations/{id}/run`) checks the feature flag and falls back to `automationService.runAutomation()` when disabled.
- Path-specific service tokens are generated for `/api/v1/automations/execute` (POST + PATCH) and `/api/v1/conversations/act` (POST).
- Workspace ID is resolved and passed through the workflow to the act route via `x-overlay-workspace-id` header.
- Convex repository does not implement `updateRunWorkflowRunId` (optional per interface) — Convex deployments track runs via automation run records, not workflow run IDs.

**Gate:** Routes live on staging (403 with capability disabled, as expected). Interactive chat unaffected. Full end-to-end workflow execution requires enabling the `automations` capability + `OVERLAY_FEATURE_DURABLE_AUTOMATIONS=1`. Manual E2E testing confirmed: durable run completes, fallback path works, interactive chat unaffected.

---

## Step 4 — Editable canvas (B3) ✅

**Goal:** Let users structurally edit the graph without losing edits to regeneration.

**Status:** Complete. Canvas is fully editable with add/delete/connect, node config side panel, undo/redo, and `manuallyEdited` flag for edit preservation.

**Deliverables:**
- ✅ `useNodesState` / `useEdgesState` for controlled graph state (with `applyNodeChanges`/`applyEdgeChanges` for custom change handling)
- ✅ Node config side panel — inline panel (not modal) that opens on node selection, with kind-specific fields (prompt text, condition expression, tool ID, output kind, label)
- ✅ Add/delete/connect with validation:
  - Add nodes via toolbar buttons (prompt, tool, condition, output)
  - Delete nodes via Delete/Backspace key or ReactFlow's built-in remove
  - Connect nodes by dragging from source handle to target handle
  - Validation: no cycles (DFS), exactly one trigger (root), ≥1 output, no dangling edges, trigger has no incoming edges
  - Validation errors displayed inline at bottom of canvas
- ✅ Autosave with optimistic UI — graph changes flow through `onGraphChange` → `updateDraft({ graph })` → save persists to server via `buildAutomationUpdateRequest`
- ✅ Round-trip preservation: `manuallyEdited` flag on `AutomationGraph` — when `true`, `buildAutomationUpdateRequest` does NOT regenerate graph from instructions even if instructions changed; graph is source of truth
- ✅ Undo/redo — `GraphHistory` class with 50-entry stack; Cmd+Z / Cmd+Shift+Z keyboard shortcuts; toolbar buttons with disabled state
- ✅ Tests: 30 graph-ops tests (validation, manipulation, undo/redo, conversion) + 5 edit-then-regenerate preservation tests = 35 new tests

**Implementation notes:**
- `graph-ops.ts` is a pure logic module (no React/CSS imports) for testability — contains validation, node/edge manipulation, ReactFlow↔graph conversion, and `GraphHistory` class.
- `reactflow-canvas.tsx` uses `applyNodeChanges`/`applyEdgeChanges` directly (instead of the default `onNodesChange`/`onEdgesChange`) to intercept deletions and position changes for graph commit.
- Position changes are committed on drag-end (not on every drag frame) to avoid excessive history entries.
- `deleteKeyCode={null}` on ReactFlow disables the built-in Delete handling; custom keyboard handler intercepts Delete/Backspace to avoid deleting nodes when typing in the config panel inputs.
- `connectNodesInGraph` prevents self-loops, duplicate edges, and cycles at the graph level.
- `applyAutomationUpdate` now persists the `graph` field (was previously only persisting `graphSource`).

**Gate:** User can create automation in chat, open editor, restructure it, save, and structure persists across reloads and chat-driven instruction updates. 103 total tests pass (78 client + 25 server), typecheck clean.

---

## Step 5 — New capabilities (Phase D) — ✅ COMPLETE

**Goal:** Replace cron polling with `sleep()`-based scheduling; add human-in-the-loop approval.

**Status:** Implemented. 142 tests pass (117 client + 25 server), typecheck clean. Convex dev backend pushed with `graph` field.

**What was done:**

1. **Shared scheduling utilities** (`src/shared/automations/schedule.ts`):
   - Extracted `computeNextRunAt`, `normalizeSchedule`, `msUntilNextRun` from Convex module to shared isomorphic module
   - Convex automations module now imports from shared module (single source of truth)
   - Added `msUntilNextRun` helper that clamps sleep duration to 1s–365d range

2. **Sleep()-based scheduling workflow** (`workflows/automation-schedule.ts`):
   - New `automationScheduleWorkflow` that loops: `sleep()` → (optional approval) → execute → repeat
   - Supports `oneShot: true` for manual runs (executes once and exits)
   - Supports `oneShot: false` for scheduled runs (loops indefinitely until cancelled)
   - Uses `msUntilNextRun()` to compute exact sleep duration — no drift
   - Zero compute cost while sleeping (Vercel World handles suspension)

3. **Human-in-the-loop approval** (`createHook()`):
   - `waitForApproval` step uses `createHook()` to suspend workflow until external webhook resumes
   - Deterministic token via `buildApprovalToken(automationId, timestamp)` so external systems can resume
   - Optional `approvalTimeoutMs` races hook against `sleep()` — skips run on timeout
   - Approval detected automatically when automation graph has `condition` nodes

4. **Approval resume API** (`POST /api/v1/automations/{id}/approve`):
   - New route that calls `resumeHook()` to resume a suspended approval workflow
   - Verifies user owns the automation before resuming
   - Accepts `{ token, approved, reason }` body

5. **Scheduler start API** (`POST /api/v1/automations/{id}/start-scheduler`):
   - New route that starts the scheduling loop workflow for an enabled automation
   - Called when automation is enabled (or re-enabled)

6. **Run route updated** (`src/server/app-api/v1/automations/[id]/run/route.ts`):
   - Manual runs now use `automationScheduleWorkflow` in one-shot mode (unified execution path)
   - Detects `condition` nodes in graph and sets `approvalRequired` + `approvalToken`
   - Returns `approvalToken` in response when approval is required

7. **Convex cron deprecated** (`convex/crons.ts`):
   - Cron entry renamed to `automation_scheduler_legacy` with comment explaining replacement
   - Cron remains as fallback when `OVERLAY_FEATURE_DURABLE_AUTOMATIONS` is disabled
   - To be deleted in Step 7 when feature flag is removed

8. **Backend migration**:
   - Convex dev backend pushed with updated schema (includes `graph` field)
   - Convex update mutation already accepts and persists `graph` field
   - Postgres schema already has `graph` jsonb column (migration 0043)
   - Both backends now support graph persistence

**New files:**
- `src/shared/automations/schedule.ts` — shared scheduling utilities
- `src/shared/automations/schedule.test.ts` — 18 scheduling tests
- `workflows/automation-schedule.ts` — sleep()-based scheduling workflow with createHook() approval
- `workflows/automation-schedule.test.ts` — 25 workflow helper tests
- `src/server/app-api/v1/automations/[id]/approve/route.ts` — approval resume endpoint
- `src/app/api/v1/automations/[id]/approve/route.ts` — BFF wrapper for approve
- `src/server/app-api/v1/automations/[id]/start-scheduler/route.ts` — scheduler start endpoint
- `src/app/api/v1/automations/[id]/start-scheduler/route.ts` — BFF wrapper for start-scheduler

**Modified files:**
- `convex/automations/automations.ts` — imports from shared schedule module
- `convex/crons.ts` — cron renamed to `automation_scheduler_legacy`
- `src/server/app-api/v1/automations/[id]/run/route.ts` — uses scheduling workflow, detects condition nodes
- `src/server/authorization/authorization-route-policy.ts` — added approve + start-scheduler route policies

**Key design decisions:**
- `computeNextRunAt` extracted to `src/shared/automations/` so both Convex and workflow code share one implementation
- The scheduling workflow loops indefinitely for scheduled runs — cancellation is via stopping the workflow run
- Approval hooks use deterministic tokens (`automation-approval:{id}:{timestamp}`) so external systems can construct them
- The cron is kept as a fallback (not deleted) because the feature flag is still off by default
- Convex dev backend was pushed from the staging worktree per the worktree safety rules

**Gate:** Scheduled automation fires via `sleep()` without cron. Approval-gated automation suspends, waits for approval, resumes. No drift over 24h test. (Code complete — 24h drift test pending deployment with feature flag enabled.)

---

## Step 6 — Live run visualization (B4) ✅

**Goal:** Canvas becomes a real-time run viewer with per-node status.

**Deliverables:**
- Per-node status: `pending | running | succeeded | failed | skipped`
- Status driven by Workflow SDK event log streamed to client
- Animated edges for active data flow
- Replay mode: select historical run, scrub step-by-step
- Error overlay: failed nodes show error message and retry count
- Tests: status transitions match event log, replay renders correctly

**Implementation:**
- `packages/overlay-app-core/src/contracts/automations.ts` — added `AutomationNodeRunStatus`, `AutomationRunEvent`, `AutomationRunStatusSnapshot` types
- `packages/overlay-app-core/src/automations/run-status.ts` — pure event-to-status reducer (`initialRunStatus`, `applyEvent`, `replayEvents`, `replayEventsUpTo`); maps workflow step names (`waitForApproval` → condition nodes, `executeAutomationRun` → prompt/tool/output nodes) to graph node statuses
- `packages/overlay-app-core/src/automations/run-status.test.ts` — 19 tests covering all status transitions, error handling, retry tracking, replay, scrubbing, and prefixed step name matching
- `src/server/app-api/v1/automations/[runId]/events/route.ts` — SSE endpoint that polls `world.events.list()` every 2s and streams step events as SSE data lines; closes on terminal run status
- `src/app/api/v1/automations/[id]/events/route.ts` — app-level route proxy with `maxDuration = 60`
- `src/server/authorization/authorization-route-policy.ts` — added `:runId/events` route policy
- `packages/overlay-modules-react/src/automations/run-viewer-hooks.ts` — `useRunStatus` (SSE subscription) and `useReplayStatus` (load all events + scrubber) hooks
- `packages/overlay-modules-react/src/automations/reactflow-canvas.tsx` — node status styling (colors, icons, spin animation for running), error overlay tooltip with retry count, animated edges for active data flow, read-only mode for run viewing
- `packages/overlay-modules-react/src/automations/run-viewer.tsx` — `AutomationRunViewer` component with Live/Replay mode toggle, run selector dropdown, and scrubber timeline
- `src/features/chat/components/chat-interface/AutomationEditor.tsx` — wires `AutomationRunViewer` into the editor when `reactflowCanvasEnabled` and graph has nodes; triggers durable runs via `runDurableResponse` when `durableAutomationsEnabled`, captures `workflowRunId` for live visualization
- `convex/automations/automations.ts` — `updateRunWorkflowRunIdByServer` mutation to persist `workflowRunId` on Convex-backed run records
- `src/server/automations/ConvexAutomationRepository.ts` — implements `updateRunWorkflowRunId` via the Convex mutation
- `packages/overlay-api-client/src/automations/client.ts` — `runDurable` / `runDurableResponse` methods for `POST /api/v1/automations/{id}/run`
- `packages/overlay-app-core/src/automations.ts` — `AutomationRunResponse` extended with `workflowRunId`, `durable`, `runId` fields
- `src/server/app-api/v1/automations/[id]/run/route.ts` — `isDurableAutomationsEnabled()` now checks env var first, then falls back to app-shell feature flag config

**Key design decisions:**
- SSE endpoint polls `world.events.list()` (not `world.steps.list()`) because events provide the full lifecycle (step_started → step_completed/step_failed → step_retrying) needed for accurate status transitions
- Step-to-node mapping is by kind, not by ID: `waitForApproval` → all condition nodes, `executeAutomationRun` → all prompt/tool/output nodes. This keeps the mapping resilient to graph structure changes.
- Step name matching uses `.includes()` (substring) rather than exact equality because the Workflow SDK emits prefixed step names like `step//./workflows/automation-schedule//executeAutomationRun`.
- The reducer is a pure function (`applyEvent`) so it can be used for both live streaming and replay (replaying events up to an index for the scrubber)
- `EventSource` is used for SSE (browser-native, auto-reconnects); for replay, we fetch the SSE stream once and drain it
- The canvas enters read-only mode when `nodeStatuses` is provided — toolbar, config panel, and editing are hidden
- Edge animation uses ReactFlow's built-in `animated` prop (CSS dash animation) with color coding: blue for active, green for completed, red for failed

**Gate:** User triggers a run and watches nodes light up in real time. Can open past run and replay step-by-step. ✅ (Visual QA passed — both `reactflowCanvas` and `durableAutomations` flags enabled by default.)

---

## Step 7 — On-prem parity + cleanup (Phase E) ✅

**Goal:** On-prem deployments get the same durability. Old code paths removed.

**Deliverables:**
- ✅ Adopted `@workflow/world-postgres` for on-prem — `world.start()` added to `instrumentation.ts` (gated by `WORKFLOW_TARGET_WORLD` env var). On Vercel, the Vercel World is used automatically.
- ✅ Migration `0044_workflow_world_postgres.sql` creates the `workflow` schema with all tables required by `@workflow/world-postgres` (consolidated from migrations 0000–0015).
- ✅ `npm run check:on-prem-parity` passes (20/20 tests, convex boundaries OK).
- ✅ Removed SVG renderer from editor — ReactFlow canvas is the only path. `AutomationGraphPreview` kept for sidebar thumbnails and showcase page.
- ✅ Removed `graphSource` as persisted field — `buildAutomationUpdateRequest` no longer sends `graphSource`; it's derived from `graph` on the server side.
- ✅ Removed fallback coordinator path — the `isDurableAutomationsEnabled()` check and legacy `testAutomation` fallback in the run route are gone. Durable execution via Workflow SDK is the only path.
- ✅ Removed feature flags — `reactflowCanvas` and `durableAutomations` flags removed from `app-shell.ts`.

**Gate:** On-prem parity check passes. Old code removed. No workspace regresses. ✅

---

## Post-Step-7 QA + polish

**Status:** All staging QA passed on the Postgres staging deployment. The one historical stale run was resolved (its parent automation was deleted during QA cleanup, removing the orphaned queued run). Production rollout remains intentionally deferred.

**Automated coverage added:**
- Durable run lifecycle delegation now covers started, succeeded, and failed status updates.
- Create and update service paths cover stringified schedule inputs before repository persistence.
- Postgres automation contract coverage verifies `workflowRunId`, `startedAt`, `completedAt`, and terminal status are returned for replay.
- Workflow input coverage verifies the durable run ID is carried into the scheduling workflow.

**Staging verification completed:**
- Manual durable run connected to the SSE event stream, showed `running` status with active prompt/output nodes, then reached `completed`.
- Replay selector displayed historical runs with their workflow IDs.
- Replay event timeline loaded and clicking an event moved the scrubber to the corresponding step and status.
- Stringified schedule creation succeeded through the deployed Postgres API and the temporary automation was removed.
- The pre-fix approval test exposed a Workflow SDK error because `createHook()` was called inside a step. Approval hook creation was moved into workflow context, and the run-start route now marks a created run failed if workflow startup throws.
- After redeploying, approval resumed the suspended workflow successfully; the run reached `succeeded` with timestamps and a workflow ID.
- Scheduler QA started a long-lived workflow, verified `running`, cancelled it through the new cancellation endpoint, verified `cancelled`, and removed the temporary automation.
- Historical stale queued run resolved: the orphaned run belonged to a temporary test automation that was deleted during QA cleanup, removing the run with it. No database-side manual update was needed.
- On-prem parity checks, the production build, and TypeScript checks pass.

**Environment note:**
- `OVERLAY_DATABASE_URL` and `BETTER_AUTH_DATABASE_URL` are set on the Vercel project as encrypted Production env vars. `vercel env pull` returns empty-string values for these, but runtime logs confirm the Postgres connection is live (`databaseConnected: true`, SSL warnings from pg-connection-string). This is a Vercel CLI secret-decryption quirk; the runtime values are populated correctly. Do not rely on `vercel env pull` for verifying these secrets — check runtime logs or the `/api/v1/automations` health instead.
- Convex-backed automation callbacks sign with `INTERNAL_SERVICE_AUTH_SECRET`; the app runtime and its matching Convex deployment must hold the same environment-specific value. A mismatch fails closed with an HMAC signature error. Keep this secret distinct from `INTERNAL_API_SECRET`.

**Convex path parity fix:**
- `AutomationService.markRunCompleted` was passing `conversationId: args.conversationId ?? ''` (empty string). Convex's `v.optional(v.id('conversations'))` validator rejects empty strings — they are not valid Convex IDs. Fixed to pass `undefined` instead. Added defensive `|| undefined` guards in `ConvexAutomationRepository` for both `markManualRunStarted` and `markManualRunCompleted`.

**Scheduler cancellation lifecycle:**
- Added `schedulerWorkflowRunId` field to the `automations` table (Postgres migration 0045) and Convex schema. The `start-scheduler` route stores the workflow run ID after starting the scheduler.
- Enabling an existing scheduled automation calls the start-scheduler route after persistence. This records a fresh scheduler run on the current deployment; saving an already-enabled automation does not create a duplicate scheduler.
- `deleteAutomation` and `pauseAutomation` (and `updateAutomation` with `enabled: false`) now cancel the scheduler workflow via `getRun(workflowRunId).cancel()` before modifying the record, then clear the stored ID.
- `deleteAutomation` also calls `requestActiveRunCancellation` to cancel any active individual runs (queued or running).
- Added a workflow-level safety net: the scheduling loop calls a new `check-status` action on the execute endpoint before each iteration. If the automation is disabled or deleted (e.g. after a deployment restart where the cancel call was lost), the workflow exits gracefully instead of continuing to execute.
- Verified end-to-end on staging: created an automation, started the scheduler, confirmed `schedulerWorkflowRunId` was stored, paused the automation, confirmed the ID was cleared, resumed, started a new scheduler, deleted the automation, confirmed the scheduler was cancelled and the automation was removed.

**Automation chat continuity:**
- Automations without a linked conversation now show their saved description and instructions instead of a blank chat surface.
- The first Automate-mode message links the created conversation to the automation's `sourceConversationId`, so subsequent navigation opens the same conversation and keeps the automation context in the URL.
- The route synchronizer preserves `automationId` from the live browser URL when activating a newly created conversation; this prevents the message from becoming a standalone regular chat.
- Automation detail loading validates the linked source conversation in the active workspace before selecting it. Missing, deleted, or cross-workspace links are removed from the URL and replaced with a valid automation conversation when one exists, otherwise the editor opens as an empty automation chat instead of displaying a false “chat no longer exists” error.
- Automation create, read, update, delete, and source-conversation attachment operations carry `workspaceId`. Both providers repair a stale source link atomically while rejecting a target conversation from another workspace.

**Still pending before production rollout:**
- Run the 24-hour no-drift observation with a scheduled automation after confirming how scheduled iterations should create and report individual `automation_runs` records.

**Workspace billing:**
- Every workflow act request carries `automationId` and `x-overlay-workspace-id`, so provider spend resolves to the workspace wallet under the stable `automation:{id}` programmatic subject.
- Each execution separately meters a conservative 20 Workflow events at the documented `$0.02 / 1K events` provider rate and applies the canonical 25% markup. The charge is idempotent across workflow retries.
- The model, search, browser, sandbox, media, and transcription calls made by the automation keep their own measured reservations; Workflow overhead is not folded into model usage.
- `workspaceWallets` remains off by default. Do not enable it until the owner-funded boundary and billable-feature coverage gates pass for the deployment.

---

## Step 8 — Production rollout

**Goal:** Gradual enablement with monitoring.

**Deliverables:**
- Enable durable automations for internal workspace first
- Then opt-in workspaces, then all workspaces
- Monitor: automation success rate, average run duration, step retry rate, Sentry errors, PostHog funnels
- 24-hour observation window after full enablement
- Document new architecture

**Gate:** Automation success rate equal or better than pre-migration. No new Sentry error categories. No billing discrepancies.
