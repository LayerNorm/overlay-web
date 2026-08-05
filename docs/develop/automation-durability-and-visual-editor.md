# Automation Durability + Visual Editor

> **Status:** Approved 2026-01. Step 1 complete.
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

4. **Spike workflow** — `workflows/spike.ts` created with two `"use step"` functions and a `sleep("30s")` between them. Trigger via `POST /api/v1/workflows/spike`. Inspect with `npx workflow web`.

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

## Step 1 — Foundation + de-risking (parallel)

### 1A. Graph model (B1)

**Goal:** Make the automation graph a first-class, versioned, persisted data structure.

**Deliverables:**
- Zod schema `AutomationGraph` in `packages/overlay-app-core/src/contracts/automations.ts`:
  - `version: 1`
  - `nodes: Array<{ id, kind, config, position? }>` — `kind`: `trigger | prompt | tool | condition | output`
  - `edges: Array<{ from, to, condition? }>`
- Add `graph` JSON field to Convex `automations` table and Postgres `automations` table
- Migration: existing linear `graphSource` → equivalent `AutomationGraph` (single chain of `prompt`/`output` nodes)
- `graphSourceFromAutomationInstructions` now derives from the graph model
- Round-trip tests: graph → graphSource → graph is stable
- `instructions` remains the primary authoring surface for chat-created automations; graph is the refinement surface

**Gate:** Schema reviewed, migration tested, round-trip tests pass, existing automations page works unchanged.

### 1B. Workflow SDK spike (Phase A)

**Goal:** Prove Workflow SDK is viable in our stack. Clear kill criterion.

**Deliverables:**
- Add `workflow` + `@ai-sdk/workflow` to `package.json`
- Compose `withWorkflow` with existing `withBundleAnalyzer(withSentryConfig(...))` in `next.config.ts`
- Fix proxy matcher in `src/proxy.ts` to exclude `.well-known/workflow/`
- Trivial workflow: `workflows/spike.ts` with `sleep("30s")` between two `"use step"` functions
- Document `@workflow/world-postgres` viability for on-prem

**Kill criterion:** If `withWorkflow` + `withSentryConfig` conflict irreconcilably, or `world-postgres` cannot meet on-prem requirements, stop and evaluate alternatives.

**Gate:** Spike workflow runs locally, suspends/resumes across dev server restart, `npx workflow web` shows the run.

---

## Step 2 — Read-only ReactFlow canvas (B2)

**Goal:** Replace the static SVG with a clean, auto-laid-out, pannable/zoomable read-only canvas using our design tokens.

**Deliverables:**
- Add `@xyflow/react` + `dagre` to `package.json`
- Custom node components styled with `var(--surface-elevated)`, `var(--border)`, `var(--foreground)`, `var(--muted)`, Lucide icons
- `AutomationGraphCanvas` reads from `AutomationGraph` model
- Dagre auto-layout with persisted positions; "tidy up" button
- Lazy-load the canvas (dynamic import)
- Feature flag: `OVERLAY_FEATURE_REACTFLOW_CANVAS`
- Keep old SVG renderer for sidebar/chat card previews

**Gate:** Visuals approved on staging. No regressions. Existing automations render correctly.

---

## Step 3 — Durable execution behind a flag (Phase B + C)

**Goal:** Run automation turns via `WorkflowAgent` with step-level durability, retries, and resumability.

**Deliverables:**
- `workflows/automation-run.ts` with `"use workflow"` directive
- Decompose act pipeline into `"use step"` functions: resolveEntitlements → reserveBudget → loadContext → runAgent → persistResult → recordUsage
- Move non-serializable construction inside step functions (pass identifiers, not instances)
- `WorkflowChatTransport` for resumable streams
- New API routes: `POST /api/v1/automations/{id}/run`, `GET /api/v1/automations/{runId}/stream`
- Store `workflowRunId` on `automationRuns` table
- Feature flag per workspace: `OVERLAY_FEATURE_DURABLE_AUTOMATIONS`
- Existing coordinator remains as fallback
- Tests: step retry, resume after process kill, idempotency on replay

**Gate:** One automation type runs end-to-end on staging via WorkflowAgent. Forced restart mid-run resumes and completes. Simulated step failure retries automatically. Interactive chat unaffected.

---

## Step 4 — Editable canvas (B3)

**Goal:** Let users structurally edit the graph without losing edits to regeneration.

**Deliverables:**
- `useNodesState` / `useEdgesState` for controlled graph state
- Node config side panel (sheet, not modal)
- Add/delete/connect with validation (no cycles, trigger is root, ≥1 output node)
- Autosave with optimistic UI
- Round-trip preservation: chat updates regenerate graph only if user hasn't manually edited; once edited, graph is source of truth
- Undo/redo
- Tests: round-trip, validation, edit-then-regenerate preservation

**Gate:** User can create automation in chat, open editor, restructure it, save, and structure persists across reloads and chat-driven instruction updates.

---

## Step 5 — New capabilities (Phase D)

**Goal:** Replace cron polling with `sleep()`-based scheduling; add human-in-the-loop approval.

**Deliverables:**
- Replace 1-minute Convex cron with `sleep()`-based scheduling inside the workflow
- Scheduled run management moves from `claimDueRuns` to workflow run lifecycle
- Human-in-the-loop: `createHook()` for approval steps; `condition` node with approval config suspends until webhook resumes
- Composes with deferred Phase 4.4 (HMAC-signed tool approvals)
- Tests: scheduling accuracy, hook suspension/resumption, hook timeout

**Gate:** Scheduled automation fires via `sleep()` without cron. Approval-gated automation suspends, waits for approval, resumes. No drift over 24h test.

---

## Step 6 — Live run visualization (B4)

**Goal:** Canvas becomes a real-time run viewer with per-node status.

**Deliverables:**
- Per-node status: `pending | running | succeeded | failed | skipped`
- Status driven by Workflow SDK event log streamed to client
- Animated edges for active data flow
- Replay mode: select historical run, scrub step-by-step
- Error overlay: failed nodes show error message and retry count
- Tests: status transitions match event log, replay renders correctly

**Gate:** User triggers a run and watches nodes light up in real time. Can open past run and replay step-by-step.

---

## Step 7 — On-prem parity + cleanup (Phase E)

**Goal:** On-prem deployments get the same durability. Old code paths removed.

**Deliverables:**
- Either adopt `@workflow/world-postgres` for on-prem, OR extend existing Postgres durable job system with step-level checkpointing
- Run `npm run check:on-prem-parity` and resolve gaps
- Remove old SVG renderer from editor (keep for sidebar thumbnails if needed)
- Remove `graphSource` as persisted field — becomes derived view-only utility
- Remove fallback coordinator path once all workspaces migrated
- Remove feature flags

**Gate:** On-prem parity check passes. Old code removed. No workspace regresses.

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
