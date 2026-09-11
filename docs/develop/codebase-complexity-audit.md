---
title: "Codebase Complexity Audit"
description: "2026-09-09 deep audit: clean-architecture adherence, dead code, duplication, complexity hotspots, and the root-folder reorganization plan."
---

# Codebase complexity audit (2026-09-09)

> **Status: §1 and §2 items 1–5 landed** (`BOUNDARY REGISTRY`, `REPO EDGE`, `RATCHET v2`, `ROOT REORG`). Root: 98 → 58 entries. Still open: the `act` route extraction (§2.2), `ChatExperience` decomposition (§5), `math-markdown-normalize` direction (§6.5), and allowlist burn-down (§2.4 warns + 250 server cross-domain warnings).

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
| `CLA.md`, `CODE_OF_CONDUCT.md`, `COMMERCIAL_LICENSE.md`, `LICENSE(.md)`, `NOTICE.md`, `COPYRIGHT.md`, `SECURITY.md`, `TRADEMARKS.md`, `PRIVATE_COMPONENTS.md` | **Keep** — legal/GitHub discovery (`PRIVATE_COMPONENTS.md` is machine-checked by `scripts/ci/check-licensing.ts:45`) |
| `AGENT_PLAN.md`, `AGENT_VISIBILITY_AND_EDITOR_PLAN.md`, `BYO_AGENTS_IMPLEMENTATION_PLAN.md`, `FUTURE.md`, `THESIS.md` | **Move → `docs/plans/`** (new dir). Unreferenced by any code (`grep` clean), two are stale post-land (`AGENT_VISIBILITY…` says "unpushed branch", landed since). `docs/develop/` already hosts plans (`ai-sdk-v7-migration-plan.md`) so this matches precedent |
| `CONVEX_POSTGRESS_PARITY.md` | **Delete** (untracked, generated 2026-09-02, no generator writes it — point-in-time output, not a doc) |

### 1b. Directories — landed (`ROOT REORG`, 98 → 58 entries)

- **Kept at root:** `convex/`, `docs/`, `migrations/`, `packages/`, `public/`, `scripts/`, `src/`, `config/`, `examples/`, `.github/`, `.githooks/`, `tests/`, toolchain configs, legal, agent entrypoints.
- **Done:** `infra/` + `installer/` merged into `deploy/` (`deploy/infra/aws/`, `deploy/installer/`; CI `docker-publish.yml` updated); `workers/` removed (untracked `.wrangler` cache); `landing-copy/` deleted (owner-approved); `fixtures/` → `tests/fixtures/`; `workflows/` → `src/server/workflows/` (new boundary domain, `@/workflows` alias dropped, SDK manifest re-verified via production build); orphaned `app.json`/`eas.json` deleted; `tsconfig.tsbuildinfo` untracked.
- **`scripts/` split landed:** `scripts/ci/` (34 checks/gates/boundary rules), `scripts/qa/` (43 smoke/rehearsal harnesses), `scripts/db/` (17 migrations/backfills/ops), `scripts/lib/` (shared `convex-admin-utils`), root keeps only `dev-setup.sh`, `vercel-ignore-build.sh` (pinned by the Vercel project setting), and `baselines/`. All `package.json`, `.github`, `.githooks`, Dockerfile/compose, and docs references rewritten; moved scripts' `dirname(..)` root resolution and `../src` escapes fixed (`../..` / `@/` aliases).
- **`docs/plans/` created** for the five strategy docs; `check-docs-health` treats `plans/` as internal (outside-root links allowed + existence-checked; public-facing wording rules exempted).
- **Left in place per owner decision:** `overlay-chrome/`, `overlay-marketing/`, `overlay-mobile/` sibling checkouts. `overlay-desktop/` stays as a gitlink.
- **Remaining:** `.agents/skills` / `.claude/skills` / `agent/skills` triplication is gitignored local state (no tracked change needed); `docs/security/` is gitignored local state and trips `docs:health` locally when present — pre-existing, unchanged.

### 1c. Biggest single win
`docs/plans/` + one `deploy/` + deleting the generated/ignored squatters takes root from ~99 entries to ~45 without touching a line of product code.

## 2. Clean architecture: mostly adhered, three holes

The layering (`app` → `server/app-api` → repositories → Convex|Postgres; `shared` isomorphic; `@overlay/*` packages acyclic — verified zero package→`src` imports, zero package cycles, zero `convex`→`server`, zero `shared`→`server` in production code) is real and enforced by an unusual number of custom guards (vendor-SDK ban, domain-service delegation checks, on-prem Convex baseline, parity matrix). What's wrong:

1. ~~**`features/workspaces` is an invisible kernel (high).**~~ **Resolved (`BOUNDARY REGISTRY`).** All six missing feature domains (`workspaces`, `agents`, `settings`, `showcase`, `admin`, `knowledge-bases`) are registered in `FEATURE_DOMAINS`, and the shared primitives were promoted instead of allowlisted: `useWorkspace`/`WorkspaceProvider` → `@/contexts/WorkspaceContext` (client prop now required), `workspace-routing` → `@/shared/workspaces/routing`, workspace types → `@/shared/workspaces/types`, `useWorkspaceChanged` → `@/hooks/use-workspace-changed` (new `src/hooks/` layer). The only true violation left is `agents → chat` (`AgentConversationWorkspace` → `DirectMessageExperience`), recorded in the debt allowlist.
2. **1520-line `act` route (medium-high).** `src/server/app-api/v1/conversations/act/route.ts` delegates correctly (passes its boundary check) but still owns the whole turn lifecycle. Extract `ActTurnOrchestrationService` so the route reads like the 19-line `conversations/route.ts` wrapper.
3. ~~**Two Convex leaks in file routes (medium).**~~ **Resolved (`REPO EDGE`).** `ingest-jobs/route.ts` + `ingest-jobs/process/route.ts` now go through `FileIngestionJobRepository` (`src/server/files/`), registered in `repositories.ts` with a Convex impl and an `unsupportedRepository` Postgres sentinel; `check-files-route-boundary` is green again (it was red on main). The `Id<'conversations'>` coupling is gone from the BFF: `ActConversationRepository` exposes a branded `ConversationId` (`asConversationId` at trust boundaries) across both providers, and ~30 call sites migrated. `Id<'conversationMessages'>`/`Id<'projects'>` etc. remain in the interface — same follow-up pattern when flagged.
4. **Debt allowlist is warn-only (low-medium).** 12 files carry documented cross-feature violations that can never fail the build. Flip entries to `error` one by one as fixed. ~~Also resolve the `showcase ↔ workspaces` bidirectional import (`WorkspaceAppBoundary.tsx:6-7` ↔ `showcase-workspace-client.ts:14`).~~ Resolved (`BOUNDARY REGISTRY`): showcase reads workspace types from `@/shared/workspaces/types`, and the showcase client is injected by app-layer composition (`src/app/_components/WorkspaceAppBoundaryWithShowcase.tsx`). `AppSidebarInlinePanels` left the component debt list — its only feature import was the moved hook.
5. ~~**Server-domain isolation covers 11 of ~40 `src/server/` dirs (low-medium).**~~ **Resolved (`BOUNDARY REGISTRY`).** `SERVER_DOMAINS` now covers all 42 domain dirs; `config`, `database`, `env`, `idempotency`, `observability`, `shared` are infra (leaf) domains; `app`, `app-api`, `app-data` are explicitly unlisted composition layers. Existing cross-wiring (`ActContextService` → `knowledge` + `ai`, entitlements → `billing`, ~250 edges) is now visible as warnings — the enumerable debt list.

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

**Batch 3 — needs a product call (landed with two keeps):**
- ~~`packages/overlay-api-client/src/search/client.ts`~~ deleted (`CLEANUP 3`).
- ~~`convex/outputs/outputs.ts`~~ functions deleted (`CLEANUP 3`); the `outputs` table and its direct readers (`chat/conversations`, `auth/users`, `files/*`) stay.
- `PlatformAgentAccess` class — **KEPT deliberately**: it is the documented seam the Chat SDK bot programs against for Slack/Teams, which matches the agent-first + Slack-delivery direction. Deleting it now would vandalize roadmap-active infrastructure.
- Billing helpers `inferRefundAllocation` / `legacyUsageTotal` — **KEPT**: migration `0054` exists but backfill completion can't be confirmed from the repo; billing compat code stays until proven migrated.
- ~~Deprecated aliases `NOTEBOOK_WRITE_MODE_PROMPT` / `NOTEBOOK_ASK_MODE_PROMPT`, `readNewChatModelFieldsFromStorage`~~ deleted (`CLEANUP 3`).

**Dependencies:** uninstall `proxy-from-env` and `picomatch` (direct deps with zero imports — transitive leftovers). Keep `eventsource` until an SSE/MCP staging soak passes. (The `@ai-sdk/*` "unused" claims in the old migration plan are stale — all four are imported; fix the doc, not the deps.)

**Also delete:** deprecated aliases `NOTEBOOK_WRITE_MODE_PROMPT` / `NOTEBOOK_ASK_MODE_PROMPT`, `readNewChatModelFieldsFromStorage`, speculative billing helpers `inferRefundAllocation` / `legacyUsageTotal` (after confirming the legacy migration is complete).

## 4. Duplication: 4 forks to collapse

- ~~**`faviconUrl` / `hostFromUrl` × 3 + tooltip fork**~~ collapsed (`CLEANUP 4`): the `web-tool-sources.ts` and features-tooltip copies died in Batches 2–3; the live package tooltip now imports both helpers from `@overlay/chat-core/sources`, keeping its own `webSourceDisplayKey` fallback.
- **`safeHttpUrl` × 3 — kept deliberately.** The package copy (`chat-react/src/lib`) and `chat-core` copy serve published packages that cannot import app `src/`; the `src/shared/security` superset serves Convex-safe app code. Merging across that boundary would violate the package→`src` ban. Revisit only if the URL policy itself changes.
- **`WebSourceItem` / `webSourceDisplayKey` × 2 — kept deliberately.** Same boundary: the package copy carries UI-only citation affordances, the shared copy stays isomorphic for Convex. The three `WebSourceItem` shapes (package, shared, chat-core types) must stay structurally compatible — note it here rather than merge them.
- **Intentional, do not touch:** `math-markdown-normalize.ts` package mirror (documented portable copy — though the two-copy arrangement already caused one sync slip; consider generating the copy from source instead of hand-syncing).

## 5. Complexity hotspots (from the ratchet report)

- 79 functions over complexity 25 (all grandfathered in the baseline). Worst: `PostgresConnectedAgentRepository#callback` (65), `isNimLeakedNarrationLine` (47), `projectRemoteAgentEvents` (43), two `runWorkspaceAgentTurn`s (39 each).
- Largest files: `ChatExperience.tsx` (2325 LOC, monolith budget 3700), `DirectMessageExperience.tsx` (2025), `convex/collaboration/workspaces.ts` (2391), `PostgresConversationCollaborationRepository.ts` (2263). `features/chat/` is 1.0M — 4× the next domain.
- The ratchet itself is working as designed (it caught three real issues in the last week), but two gaps: **file LOC exempts via baseline without expiry**, and **new-file-500 rule doesn't see moves** (the PricingClient move tripped it spuriously). ~~Recommend: date-stamp baseline exemptions, and teach the new-file check to ignore pure renames (`git diff --find-renames`).~~ **Resolved (`RATCHET v2`).** Baseline entries now carry `{file, loc, complexity, recordedAt}` — grant dates survive regenerations, and exemptions older than 90 days emit a non-blocking burn-down warning in `--check` output and the HTML report. Rename detection: a new-path over-budget file is exempt when a vanished baseline path shares its basename and LOC within 10% (verified by moving `extensions.ts` — zero violations). Same treatment for `routeHandlersOverBudget`.

## 6. Suggested execution order

1. **This week, no product risk:** Batch 1 shims + `proxy-from-env`/`picomatch` uninstall + `CONVEX_POSTGRESS_PARITY.md` delete + `output/` untrack. One commit, pure deletion.
2. **Next:** Batch 2 deletions (one commit per file, each with its runtime check) + favicon/safe-url dedupes.
3. **Then:** root reorg (§1) — moves only, no logic changes. Do it in one commit so `git log --follow` stays useful, and update the three docs that reference old paths (`traversing-agent-conversations.md` references `summaries/`; boundary scripts reference `src/` paths — unaffected by root moves except `workflows/`).
4. **Harder, schedule explicitly:** `features/workspaces` kernel decision, `act` route extraction, file-route Convex leaks, `ChatExperience` decomposition. Each is a design task, not cleanup.
5. **Needs your decision:** `SearchClient` (wire or delete), Convex `outputs/*` (dashboard check), `PlatformAgentAccess` (roadmap check), shared-vs-package `math-markdown-normalize` canonical direction.
