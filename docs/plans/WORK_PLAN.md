# Work: tasks, board, and timeline

Status: implementation in progress on `codex/work-plan`; phase 1 passed local and authenticated isolated-preview QA at `72110ba73`; phase 2 passed authenticated HTTP QA at `1190fbf4a`; phase 3 passed hosted navigation and reload QA at `0360ff299`; phase 4 passed hosted create/edit/filter QA at `9a3555277`; phase 5 passed hosted brief/comment/archive/Settings restore QA at `0894e79e8`; phase 6 Board implemented and locally validated, hosted QA pending. Mockup approved: [`mockups/work-mockup.html`](https://github.com/LayerNorm/overlay-web/blob/main/docs/plans/mockups/work-mockup.html).

## Goal

A new **Work** page above Agents in the primary sidebar: one place to track work, personal and workspace, shown as a **List**, a **Board**, and a **Timeline** over the same tasks. v1 is humans only. The model is shaped so that, later, a task can be assigned to an agent and the agent reports back for review (see [`THESIS.md`](https://github.com/LayerNorm/overlay-web/blob/main/docs/plans/THESIS.md): humans set direction, AI employees do the work).

Not in v1: agent execution, sprints, estimates, custom fields, custom workflows, per-task sharing.

## What the codebase already gives us

This is why the plan is mostly wiring and not invention.

| Need | Already in the repo | What we do |
| --- | --- | --- |
| Personal / Workspace split | `scope`, `archivedAt`, `archivedBy`, `archivedFromScope` fields; `src/shared/workspaces/resource-scope.ts` rules; `convex/lib/resourceScope.ts` (`ScopedTable`, `listScopedRows`, `scopeContextLoader`); `by_workspaceId_scope_archivedAt` index pattern | Add `workItems` as a sixth scoped table of kind `content` |
| Move / archive / restore | `scopeMutations(table, kind)` in `convex/lib/scopeMutations.ts` | One line: `scopeMutations('workItems', 'content')` |
| Admin policy (who may create in Workspace, may members move) | `workspaceContentEditors`, `memberCanMoveScope` | Free, because kind is `content` |
| Archived page | Settings → Archived (`src/features/settings/lib/archived-actions.ts`, `archived-items.ts`) | Register a `work` category |
| Secondary sidebar | `buildScopedPanelNav` renders Personal / Workspace with sub-rows | Sub-rows: List, Board, Timeline |
| Assignees | Agents are already principals (`workspaceAgentDefinitions.principalId`, `workspacePrincipals`) | `assigneePrincipalId` takes a human or an agent with no new concept |
| Markdown | `@overlay/app-core/note-markdown` | Task description reuses it |
| Route authorization | `authorization-route-policy.ts`, enforced by a test | Add `work` entries |

## Decisions to confirm before PR 1

1. **Names.** Table `workItems` (room for objective, task, subtask); UI says "tasks".
2. **Dates** stored as `YYYY-MM-DD` strings, not timestamps, so a due date never shifts with timezone.
3. **Ordering** uses a fractional string `rank` (insert between two neighbours without renumbering). A small tested helper in `src/shared/work/rank.ts`.
4. **Hierarchy** is one level of parent to start (objective to task). Subtasks come later; the `parentId` field allows them.
5. **Dependencies** (`blockedBy: string[]`) are in the schema from PR 1 but only used in the Timeline PR.
6. **Statuses** are fixed: `backlog`, `todo`, `progress`, `review`, `done`, plus a `blocked` flag. No canceled in v1 (archive covers it).
7. **Rollout gate.** A `work` feature flag, off by default, so each PR can merge to `main` without exposing half a feature. It is turned on after PR 5, when the List and the panel are usable.
8. **Shortcut shift.** Alt+1 to Alt+6 map to rail position (`useSidebarEffects.ts`). Current main starts with Agents at Alt+1. Putting Work first moves Agents to Alt+2, Chats to Alt+3, and so on. Acceptable, or pin Work to the end of the shortcut list? (Recommend: accept the shift.)
9. **Refresh model.** Most panels fetch through the BFF and refresh on window events (for example `AUTOMATIONS_UPDATED_EVENT`); only chat uses live Convex subscriptions. We should do the same for List and Board (fetch + event + optimistic update) and consider live queries only if multi-person editing needs them. Realtime is therefore not free, which I overstated earlier.

## Data model (PR 1)

`workItems`
- Identity: `userId` (creator), `workspaceId`, `scope`, `archivedAt`, `archivedBy`, `archivedFromScope`, `createdAt`, `updatedAt`
- Content: `title`, `description` (markdown), `status`, `blocked` (bool), `priority` (1 to 3), `rank`
- People: `assigneePrincipalId?`, `reviewerUserId?`
- Time and structure: `startDate?`, `dueDate?`, `parentId?`, `blockedBy?: string[]`
- Brief (optional, for the panel): `doneWhen?: { text, checked }[]`, `context?: { type: 'file'|'note'|'chat'|'link', id, label }[]`

`workItemEvents` (activity log and comments): `workItemId`, `workspaceId`, `actorPrincipalId`, `kind` (`created`, `status`, `assignee`, `comment`, ...), `data`, `createdAt`. Agent runs write here later.

Indexes: `by_workspaceId_scope_archivedAt`, `by_workspaceId_userId_archivedAt`, `by_parentId`, `by_workspaceId_assignee` and one on `(workspaceId, status, rank)` for the Board.

## PR plan

This implementation uses one Builder PR against `main`, with a `WORK PHASE {#} : {message}` commit per phase and isolated preview QA after each phase, as requested on 2026-10-13. No production deploy unless authorized. Each PR lands with its tests, docs and a `CHANGELOG.md` line. Branch names `codex/work-<slug>` from the latest `origin/main`.

| PR | Branch | Delivers | Main files | Tests | Docs | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| **0** | `work-plan` | This plan and the mockup | `docs/plans/WORK_PLAN.md`, `docs/plans/mockups/work-mockup.html` | none | add plan to the docs table if wanted | merged |
| **1** | `work-data-model` | Schema, scope wiring, Convex functions, rank helper. No UI, no API. | `convex/schema.ts`, `convex/work/workItems.ts`, `convex/work/workItemEvents.ts`, `convex/lib/resourceScope.ts` (add `'workItems'` to `ScopedTable`), `src/shared/work/{status,rank}.ts` | `convex/work.convex.test.ts`: personal rows private, workspace rows shared, policy respected, move/archive/restore, parent cannot be itself or a descendant, events written; `rank.test.ts` | `convex-workflow.mdx` if deploy notes change; `architecture.mdx` (new `work` domain) | tests green; schema reviewed; isolated PR preview backend deployed by hosted CI |
| **2** | `work-api` | HTTP API and typed client | `src/app/api/v1/work/route.ts` and `[id]/route.ts` (thin), `src/server/app-api/v1/work/*`, `src/server/work/WorkService.ts`, `packages/overlay-api-client/src/work/{client,types}.ts` wired in `create-overlay-app-client.ts`, contracts in `@overlay/app-core`, capability `work.use` in `@overlay/authz-contracts`, entries in `authorization-route-policy.ts` | route tests per method, route-policy suite, client tests | `api-route-catalog.mdx`, `compact-api-route-catalog.mdx`, `api-source-of-truth.mdx` | every method reachable with a session and refused without one; scope view filter works over HTTP |
| **3** | `work-shell` | Nav entry, secondary panel, empty route | `packages/overlay-app-core/src/app-shell.ts` (nav item before Agents, `work` flag), `appSidebarNav.ts` (`SecondaryPanelKind`, titles), `appSidebarPanelNav.ts` (scoped nav with List / Board / Timeline), `src/shared/workspaces/routing.ts` (`APP_SURFACES`), `src/app/app/work/page.tsx` + `loading.tsx` + `error.tsx` with a Suspense boundary, mobile drawer, `useSidebarEffects.ts` shortcuts | sidebar nav tests (extend `scopedPanelNav.test.tsx`), routing tests | `cache-components-design-decisions.md` (route and its Suspense), `feature-modules.mdx` | with the flag on, Work appears above Agents, scope and view survive reload and workspace switch, page renders an empty state; flag off hides it everywhere |
| **4** | `work-list` | The List view | `src/features/work/components/{WorkList,WorkRow,QuickAdd,StatusPicker,OwnerPicker}.tsx`, `src/features/work/lib/*` (data hook, optimistic updates, grouping) | grouping and filter unit tests, component tests for quick-add and status change | `interface-design.md` if a shared control is added | create, rename, change status and owner from the list; filters (Everything, Needs you, Assigned to me) and search work; survives refresh |
| **5** | `work-detail` | The task panel (the brief) and archive | `WorkPeek.tsx` with properties, Objective (markdown), Context, Done when, Activity and comments; move scope and archive actions; `archived-actions.ts` + `archived-items.ts` register a `work` category | editor round trip, checklist, event log, archived list and restore | `customization.mdx` only if settings change | open a task from the list, edit every field, comment, archive it and restore it from Settings → Archived. **Turn the flag on here: v1 is usable.** |
| **6** | `work-board` | The Board | `WorkBoard.tsx`, drag between columns, reorder within a column using `rank`, optimistic move with rollback | rank edge cases (first, last, equal neighbours), drop handler tests | none | drag persists across refresh and across two tabs; keyboard alternative to drag exists |
| **7a** | `work-timeline` | Timeline bars | `WorkTimeline.tsx`, objective rows, today line, drag to move or resize dates, week headers | date math tests, bar layout tests | none | dates edit from the bars; objective bar spans its tasks; scroll starts at today |
| **7b** | `work-dependencies` | Dependencies | `blockedBy` editing in the panel, arrows on the Timeline, cycle check in Convex | cycle rejection test, arrow routing test | none | cannot create a cycle; arrows follow moved bars |
| **8** | `work-polish` | Search, shortcuts, narrow screens, QA | global search entry (`GlobalSearchDialog.tsx`), `C` and Esc shortcuts, mobile layouts (List stacked, Board snap-scroll, Timeline scroll), dark mode pass, empty and error states, pagination for large lists, analytics events | targeted tests plus a browser pass | `browser-testing-with-agent-browser.md` for any new gotchas | full QA checklist below passes |

PR 7a and 7b split because the Timeline is the costliest view and dependencies add a validation rule on the backend; either can ship alone.

### Sequencing notes

- Phases 1 to 3 are invisible to users. From phase 4 on, the flag keeps work hidden.
- PR 4 and PR 6 only need PR 3 and PR 2; with two builders they can run in parallel on separate worktrees. PR 5 needs PR 4.
- Keep schema and UI in separate phase commits. This PR owns an isolated preview backend; no shared backend is deployed from the feature worktree.

## Convex and release rules (from AGENTS.md)

- New tables and indexes are additive. Hosted PR CI deploys only the scoped preview backend. Dedicated staging is an on-demand main release candidate; legacy `staging` is frozen. Customer production Convex deploys only from clean canonical `main` after matching web is live.
- `convex/` imports `@/shared/*`, never `@/server/*`. Rank, status constants and scope rules therefore live in `src/shared/work/`.
- Production web deployment is manual (`bash scripts/release/promote.sh <sha>` from clean canonical main); merging does not deploy. Stop at "merged, not deployed" unless the owner authorizes.
- New untracked test files are skipped by `scripts/ci/run-all-tests.mjs` until `git add -N <file>`; do that before running the suite.

## QA checklist per PR

Commands: `npx tsc --noEmit`, targeted ESLint on changed files, targeted tests (single-file command in the repo-testing notes), `npm run check:shared-isomorphic` for anything touching `src/shared/`, `npm run test:all` before a direct push.

Browser, flag on, both scopes, light and dark:
1. Work sits above Agents; Personal / Workspace with List, Board, Timeline beneath.
2. Add a task from the quick-add; it appears in Todo and survives refresh.
3. Switch Personal to Workspace: tasks differ, and a second member sees workspace tasks but not your personal ones.
4. Change status in List and in Board; both views agree.
5. Open a task, edit the brief, comment, archive, restore from Settings → Archived.
6. Drag a bar on the Timeline; dates change in the panel.
7. Narrow window: nothing overflows the page horizontally (Timeline scrolls inside its own area).
8. Reduced motion on: no transitions needed to understand state.

## Risks

- **Rank drift.** Fractional ranks can grow long after many inserts in the same gap. The helper rebalances a column when a rank exceeds a length bound; covered by tests.
- **Scope leakage.** The most expensive mistake. Every list goes through `listScopedRows` / `scopeContextLoader`, and PR 1 has explicit two-user tests (only one production workspace has more than one human, so tests must create their own members).
- **Timeline cost.** Rendering hundreds of bars with arrows; PR 8 adds windowing if needed.
- **Shared dev Convex.** A broken schema push affects every local session. PR 1 is therefore small and tested before it is pushed.

## After v1: agents (its own plan)

Everything is already in place: the assignee is a principal, events are logged, the brief fields exist. The follow-up plan adds a `workRuns` table, the handoff cards from the mockup (running, needs input, ready for review), a `work` tool group (`buildWorkspaceAgentTooling`, with a `LATER_GROUP_MEMBERS` entry so existing agents do not lose a group), budgets and approvals through `agentApprovalRequests`, and a "Needs you" review queue. Update `tool-catalog.md` and `agent-to-agent.md` when that lands.
