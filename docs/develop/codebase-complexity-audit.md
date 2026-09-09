---
title: "Codebase Complexity Audit"
description: "2026-09-09 deep audit: clean-architecture adherence, dead code, duplication, complexity hotspots, and the root-folder reorganization plan."
---

# Codebase complexity audit (2026-09-09)

> **Status: Batch 1 landed** (`CLEANUP 1`). Batches 2+ below are still open.

Three parallel audits (root sprawl, layer adherence, dead code) plus complexity
metrics. Every claim carries the file or command that proves it. Items marked
**do now** are safe, mechanical, and regression-free. Items marked **decide**
need your call.

**Headline verdict:** the backend layering and dual-backend split are genuinely
good — the best parts of the codebase. The mess is at the edges: root-folder
sprawl, an unguarded `features/workspaces` kernel, one 1520-line route, ~500
lines of provably dead code, and a handful of forked duplicates from the
package-extraction migration.

## 1. Root folder: what stays, what moves, what dies

99 entries at root. The rule going forward: **only toolchain contracts and
discoverable policy live at root** (`package.json`, configs, `README`,
`CHANGELOG`, legal, `AGENTS.md`, role prompts). Everything else moves.

### 1a. Markdown: 21 files at root → 12 stay, 9 move or die

| File | Verdict |
|---|---|
| `AGENTS.md`, `BUILDER_AGENT_PROMPT.md`, `INTEGRATION_AGENT_PROMPT.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md` | **Keep** — agent entrypoint + cited contracts |
| `CLA.md`, `CODE_OF_CONDUCT.md`, `COMMERCIAL_LICENSE.md`, `LICENSE(.md)`, `NOTICE.md`, `COPYRIGHT.md`, `SECURITY.md`, `TRADEMARKS.md`, `PRIVATE_COMPONENTS.md` | **Keep** — legal/GitHub discovery (`PRIVATE_COMPONENTS.md` is machine-checked by `scripts/check-licensing.ts:45`) |
| `AGENT_PLAN.md`, `AGENT_VISIBILITY_AND_EDITOR_PLAN.md`, `BYO_AGENTS_IMPLEMENTATION_PLAN.md`, `FUTURE.md`, `THESIS.md` | **Move → `docs/plans/`** (new dir). Unreferenced by any code (`grep` clean), two are stale post-land (`AGENT_VISIBILITY…` says "unpushed branch", landed since). `docs/develop/` already hosts plans (`ai-sdk-v7-migration-plan.md`) so this matches precedent |
| `CONVEX_POSTGRESS_PARITY.md` | **Delete** (untracked, generated 2026-09-02, no generator writes it — point-in-time output, not a doc) |

### 1b. Directories

- **Keep at root:** `convex/`, `docs/`, `migrations/`, `packages/`, `public/`, `scripts/`, `src/`, `config/` (operator JSON), `examples/`, `.github/`, `.githooks/`.
- **Merge the three deploy systems into one `deploy/`:** `infra/` is a single YAML, `installer/` is one Dockerfile + templates, `deploy/` is EC2 compose files. One app, one deploy dir.
- **Move out of this repo checkout:** `overlay-chrome/`, `overlay-marketing/`, `overlay-mobile/` (0 tracked files each, locally excluded — sibling checkouts squatting in the web repo; note root `app.json` + `eas.json` duplicate mobile config and should go with `overlay-mobile/`). `overlay-desktop/` stays as a gitlink only.
- **Delete:** `workers/` (only a `.wrangler/` cache inside, otherwise empty), `output/` generated content (untrack `output/reports/web-app-complexity-report.html`, the single tracked file — it's regenerable via `report:web-complexity`).
- **Consolidate agent skills:** `.agents/skills`, `.claude/skills`, and `agent/skills` hold the same ~25 skills triplicated (all ignored) — keep one source + `skills-lock.json`.
- **Move:** `landing-copy/` (14 tracked marketing snapshots duplicating `docs/legal/` + `src/app`) → fold into `docs/legal/` sources or delete if `docs/` is canonical; `fixtures/` → `tests/fixtures/` (too generic at root); `workflows/` (8 automation files) → `convex/` or `src/server/automations/`.
- **`scripts/` (97 entries) split:** `scripts/ci/`, `scripts/qa/`, `scripts/db/` — currently one flat pile of migrations, QA harnesses, and boundary checks.
- **Do not touch:** `internal-docs/`, `docs/security/`, `.devin/`, `.cursor/`, `.gstack/`, `.workflow-data/`, `.playwright-*` — all gitignored local/editor state.

### 1c. Biggest single win
`docs/plans/` + one `deploy/` + deleting the generated/ignored squatters takes root from ~99 entries to ~45 without touching a line of product code.

## 2. Clean architecture: mostly adhered, three holes

The layering (`app` → `server/app-api` → repositories → Convex|Postgres; `shared` isomorphic; `@overlay/*` packages acyclic — verified zero package→`src` imports, zero package cycles, zero `convex`→`server`, zero `shared`→`server` in production code) is real and enforced by an unusual number of custom guards (vendor-SDK ban, domain-service delegation checks, on-prem Convex baseline, parity matrix). What's wrong:

1. **`features/workspaces` is an invisible kernel (high).** The ESLint domain list omits `workspaces` (plus `agents`, `settings`, `showcase`), so ~25 cross-feature imports of workspace hooks/routing bypass boundary checks entirely (`ChatExperience.tsx:101`, `DirectMessageExperience.tsx:50`, `Agents/*`, `AppSidebarInlinePanels.tsx:52`…). Either register the missing domains or promote workspace primitives to `@/shared`. Until then the boundary system has a hole exactly where coupling is densest.
2. **1520-line `act` route (medium-high).** `src/server/app-api/v1/conversations/act/route.ts` delegates correctly (passes its boundary check) but still owns the whole turn lifecycle. Extract `ActTurnOrchestrationService` so the route reads like the 19-line `conversations/route.ts` wrapper.
3. **Two Convex leaks in file routes (medium).** `src/server/app-api/v1/files/ingest-jobs/route.ts:35-45` (+`process/route.ts`) call `lazyConvex.mutation` inline, against the intent of `check-files-route-boundary`. Move behind the existing `FileRepository`/`DurableJobRepository`. Related: `conversations/route.ts:20` type-couples the BFF to `convex/_generated` (`Id<'conversations'>`) — introduce a branded string ID at the repo edge.
4. **Debt allowlist is warn-only (low-medium).** 12 files carry documented cross-feature violations that can never fail the build. Flip entries to `error` one by one as fixed. Also resolve the `showcase ↔ workspaces` bidirectional import (`WorkspaceAppBoundary.tsx:6-7` ↔ `showcase-workspace-client.ts:14`).
5. **Server-domain isolation covers 11 of ~40 `src/server/` dirs (low-medium).** Real cross-wiring already exists (`ActContextService` → `knowledge` + `ai`, entitlement services → `billing`). Extend `SERVER_DOMAINS` or accept it explicitly.

What's genuinely good (don't refactor): the BFF edge (`bff.ts` central auth/rate-limit/idempotency/capability gating), the Convex↔Postgres seam (capability derivation + per-route 501s + mirrored repositories + `unsupportedRepository` sentinels + parity matrix — the cleanest part of the repo), and the `(app)→/app` redirect shim.

## 3. Dead code: ~500 lines removable with zero regression risk

All items below were verified with repo-wide import greps (details: file + symbol + proof). Suggested removal order — each step independently committable, followed by `tsc --noEmit` + the area's tests:

**Batch 1 — zero-risk shims (delete outright):**
- `src/features/chat/components/collaboration/SafeHumanMarkdown.tsx` (1-line re-export, 0 importers)
- `src/features/chat/components/LazySyntaxHighlighter.tsx` (1-line re-export, 0 importers)
- `src/features/notebook/lib/notebook-editor-blocks.ts` (1-line re-export, 0 importers)

**Batch 2 — dead UI + server pieces (verify the noted replacement path, then delete):**
- `src/features/chat/components/collaboration/RoomMessageMentions.tsx` (48 LOC; `RoomMessageItem` doesn't use it — check an @-mention renders first)
- `src/features/chat/components/WebSourceTooltip.tsx` (176 LOC abandoned fork; live copy is the package one — see §4)
- `src/components/providers/CrossTabAppEventBridge.tsx` (unmounted wrapper; underlying `cross-tab-event-bridge.ts` helper is live and tested)
- `src/features/chat/components/chat/useEmptyChatStarters.ts` (superseded hook, 0 importers)
- `packages/overlay-chat-react/src/lib/web-tool-sources.ts` (`collectWebSourcesFromToolPart` + dup helpers, consumers all use `web-sources`)
- `src/shared/schemas/authorization-admin.ts` (whole file unreachable — never added to the schemas barrel)
- `src/server/email/email-service.ts` (`sendEmail`/`getEmailProvider`/`isEmailConfigured`; live path is the outbox delivery)
- `src/server/observability/business-rollup.ts` (never wired to any cron)

**Batch 3 — needs a product call:**
- `packages/overlay-api-client/src/search/client.ts` (`SearchClient` built but never exported/wired — delete or wire up `/api/v1/search`)
- `convex/outputs/outputs.ts` (6 functions, 0 callers — check Convex dashboard invocation counts first; dashboard/cron can invoke what grep can't see)
- `PlatformAgentAccess` class (test-only + re-export; keep if Slack/Teams directories are on the roadmap)

**Dependencies:** uninstall `proxy-from-env` and `picomatch` (direct deps with zero imports — transitive leftovers). Keep `eventsource` until an SSE/MCP staging soak passes. (The `@ai-sdk/*` "unused" claims in the old migration plan are stale — all four are imported; fix the doc, not the deps.)

**Also delete:** deprecated aliases `NOTEBOOK_WRITE_MODE_PROMPT` / `NOTEBOOK_ASK_MODE_PROMPT`, `readNewChatModelFieldsFromStorage`, speculative billing helpers `inferRefundAllocation` / `legacyUsageTotal` (after confirming the legacy migration is complete).

## 4. Duplication: 4 forks to collapse

- **`faviconUrl` / `hostFromUrl` × 3 + tooltip fork.** Canonical: `packages/overlay-chat-core/src/sources.ts:63,72`. Delete the copies in `web-tool-sources.ts` and features `WebSourceTooltip.tsx`; point the live package tooltip at chat-core.
- **`safeHttpUrl` × 3.** Canonical: `src/shared/security/safe-url.ts` (79-LOC superset). Make the package and chat-core copies delegate to it.
- **`WebSourceItem` / `webSourceDisplayKey` × 2.** Keep `src/shared/web/web-sources.ts` (isomorphic, Convex-safe); re-export from the package copy.
- **Intentional, do not touch:** `math-markdown-normalize.ts` package mirror (documented portable copy — though the two-copy arrangement already caused one sync slip; consider generating the copy from source instead of hand-syncing).

## 5. Complexity hotspots (from the ratchet report)

- 79 functions over complexity 25 (all grandfathered in the baseline). Worst: `PostgresConnectedAgentRepository#callback` (65), `isNimLeakedNarrationLine` (47), `projectRemoteAgentEvents` (43), two `runWorkspaceAgentTurn`s (39 each).
- Largest files: `ChatExperience.tsx` (2325 LOC, monolith budget 3700), `DirectMessageExperience.tsx` (2025), `convex/collaboration/workspaces.ts` (2391), `PostgresConversationCollaborationRepository.ts` (2263). `features/chat/` is 1.0M — 4× the next domain.
- The ratchet itself is working as designed (it caught three real issues in the last week), but two gaps: **file LOC exempts via baseline without expiry**, and **new-file-500 rule doesn't see moves** (the PricingClient move tripped it spuriously). Recommend: date-stamp baseline exemptions, and teach the new-file check to ignore pure renames (`git diff --find-renames`).

## 6. Suggested execution order

1. **This week, no product risk:** Batch 1 shims + `proxy-from-env`/`picomatch` uninstall + `CONVEX_POSTGRESS_PARITY.md` delete + `output/` untrack. One commit, pure deletion.
2. **Next:** Batch 2 deletions (one commit per file, each with its runtime check) + favicon/safe-url dedupes.
3. **Then:** root reorg (§1) — moves only, no logic changes. Do it in one commit so `git log --follow` stays useful, and update the three docs that reference old paths (`traversing-agent-conversations.md` references `summaries/`; boundary scripts reference `src/` paths — unaffected by root moves except `workflows/`).
4. **Harder, schedule explicitly:** `features/workspaces` kernel decision, `act` route extraction, file-route Convex leaks, `ChatExperience` decomposition. Each is a design task, not cleanup.
5. **Needs your decision:** `SearchClient` (wire or delete), Convex `outputs/*` (dashboard check), `PlatformAgentAccess` (roadmap check), shared-vs-package `math-markdown-normalize` canonical direction.
