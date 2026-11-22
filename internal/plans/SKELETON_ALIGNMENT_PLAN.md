# Skeleton alignment plan

Status: Phases 1–6 implemented on `codex/skeleton-alignment` (2026-11-22); awaiting preview QA and merge. Skipped: Files `?view=outputs` (that view loads as a list); the unreachable Knowledge `mode="knowledge"` memories path still exists.

Goal: every loading state looks like the thing that replaces it — same column, width, gutters, row height, shape and
count — and each surface shows **one** loading state, not a sequence of different ones.

## Rules we will hold to

1. **Real chrome, skeleton data.** Headers, breadcrumbs, view tabs, search, section headers and composers render for
   real (disabled if needed); only the data area is a placeholder. Work's composer and the sidebar section headers
   already do this.
2. **Skeletons are built from the same layout wrapper as the real view** (export the column/row wrapper and use it in
   both), so a width change in one place moves both.
3. **One skeleton per surface across every stage** (route `loading.tsx`, Suspense fallback, dynamic-import loader, data
   loading). No `null`/empty-div gaps between stages.
4. One style: `ui-skeleton-line` / `ui-skeleton-mesh` shimmer. No `animate-pulse bg-(--surface-subtle)` blocks.
5. No skeletons for removed areas (Projects, Knowledge, Outputs pages) and no unused exports.

## Root causes (fixing these clears most findings)

| # | Cause | Effect | Fix |
|---|---|---|---|
| R1 | `.ui-skeleton-mesh` has `min-height: 4rem` (`packages/overlay-ui/src/styles.css:117`, `src/app/globals.css:349`) | Every 40px icon/avatar placeholder renders 64px tall | Drop the shared min-height; set it only on large blocks |
| R2 | `SidebarListSkeleton` (`overlay-ui/.../feedback/Skeleton.tsx:7`) draws two-line ~40px rows, `space-y-2`, as `<div>` inside `<ul>` | Every sidebar list (Chats, Work, Files, Automations, Suspense fallback) and Activity is ~45% too tall and jumps up | Single-line `<li>` rows `h-8 px-2 gap-2.5`, 14–16px icon, `gap-0.5` |
| R3 | `PageHeaderSkeleton` (`AppRouteSkeletons.tsx:23`) is `h-16 px-4` with a title+subtitle and square buttons | Every non-chat route header shifts 8px, loses a line, wrong on mobile | Render the real `AppScreenHeader` with the route's title/tabs instead |
| R4 | Wrong skeleton reused across routes: `ChatRouteSkeleton` for Activity/Tools/Agents/Archived/Notes/app main fallback; `WorkRouteSkeleton` for Organization and every route with no `loading.tsx` | Users see a chat or task list before an unrelated page | One skeleton per route; neutral fallback (header + empty body) where none exists |
| R5 | Multi-stage loading with different shapes per stage | Work: 3 stages, Notes: 4, Agents: 4, Tools: 3, Chat: 2 | Rule 3 |

## Findings by surface

Severity: **H** = wrong shape/position, obvious jump; **M** = noticeable shift; **L** = minor.

### Work
- **H** Route `WorkRouteSkeleton` (`AppRouteSkeletons.tsx:87`) and in-page `ListSkeleton` (`WorkPage.tsx:32`) are both full-width `px-6`, with divider lines, no status-group header, no due/avatar cluster; route skeleton has no composer. Real list: `mx-auto max-w-4xl px-3 sm:px-4`, group header then `h-10` rows. *(The reported bug.)*
- **M** Board and Timeline show the list skeleton (`WorkPage.tsx:91`).
- **M** Organization uses the Work list skeleton (`work/organization/page.tsx:6`) then plain "Loading organization…" text (`OrganizationPage.tsx:67`); real page is a centred chart.
- **M** Task peek loading (`WorkPeek.tsx:220-239`, duplicated): title in body at `px-6 py-10`; loaded title is in the header and body is `px-7 pt-2` → ~32px jump.
- **L** Assignment panel loading (`WorkAssignments.tsx:139`): `px-6 py-10`, small title; real `px-7 pt-6`, `text-2xl` title, property grid.
- **M** Work sidebar sections: R2 rows (14px round status icon in real); "Needs you"/"Everything" flash their empty text before assignments load because `LoadingFirstPage` is ignored (`WorkSidebarSection.tsx:66`).

### Chat, rooms, agents, activity, archived
- **M** `ChatRouteSkeleton` uses `max-w-3xl` transcript/composer; real is `max-w-4xl`, `px-3 sm:px-4`. A second, different `ChatSuspenseFallback` (`ChatSuspenseBoundary.tsx:16`) follows it. Empty `/app/chat` really shows a centred greeting, not a fake transcript.
- **L** `ChatMessageListSkeleton`: column correct, but no right-aligned user bubble and a "Loading conversation" label.
- **H** DM/channel/agent-thread loader (`ConversationExperienceRouter.tsx:35`) has no header and no composer and is top-anchored; room transcript is bottom-anchored with its own different skeleton.
- **M** Room transcript skeleton (`DirectMessageExperience.parts.tsx:541`): three full-width pulse blocks; real rows are 36px avatar + name/time/body, own messages right-aligned bubbles.
- **H** Agents route: chat skeleton → bouncing dots → `null` → transcript-only placeholder (`agents/page.tsx:7`, `AgentConversationWorkspace.parts.tsx:84`, `AgentConversationWorkspace.tsx:445`).
- **L** Conversation scope gate returns `null` (`conversationScopeVerification.tsx:79`) → blank frame.
- **H** Activity route shows the chat skeleton (`activity/page.tsx:7`, `ClientSessionRoutes.tsx:24,45`), then **M** in-page uses `SidebarListSkeleton` (`ChatActivityView.tsx:120`); real rows are 28px round icon + title/body/time, `px-3 py-3`.
- **L** Archived shows the chat skeleton with a composer; real has a notice footer instead.
- **L** New-DM dialog rows (`NewDirectMessageDialog.tsx:211`): filled blocks vs avatar + two lines.

### Agent editor
- **M** `AgentEditorSkeleton` (`EditorLoadGate.tsx:11`): heading bar the form doesn't have, four solid cards, `space-y-4` without `mt-5`; real is avatar picker then label+field pairs (`mt-5 space-y-5`). Route Suspense is `fallback={null}` (`agents/[agentId]/page.tsx`).
- **L** Computer tab caption centred and repeated; real is left-aligned with a status dot.

### Sidebars
- **H** Agents panel (`AppSidebarAgentsPanel.tsx:640`): `h-8` rows with 14px square vs real `h-10` rows with 24px creature avatar; no placeholder for the ~100px pinned chief tiles.
- **M** Agent threads (`AppSidebarAgentThreads.tsx:47`): 28px rows with an icon vs real 30px rows (CSS in `double-sidebar.css:180`), no icon when idle, title at ~39px; always 3 rows even when the agent has none.
- **H/M** Chats, Work, Files tree, Automations: R2. Automations also swaps icon when the agent directory resolves.
- **M** Chats can show "No channels yet" before the skeleton (`ChatInlinePanel.tsx:261`: loading false while Convex auth/workspace not ready).
- **M** Shared panel Suspense fallback (`AppSidebarChrome.tsx:212`) shows six generic rows, then the panel's own skeleton, then data.
- **L** Workspace switcher list/trigger (`WorkspaceSwitcherView.tsx:37,233`): avatar `h-7 rounded-lg` vs `h-6 rounded-md`, single bar vs two-line `px-3 py-2` items, pulse style.

### Extensions / Tools
- **H** `IntegrationsRouteSkeleton` (`AppRouteSkeletons.tsx:270`): `max-w-2xl` single column of tiny rows; real catalog is `max-w-[920px] px-10`, title, search, Add, pill tabs, 2-column grid of 40px-tile rows.
- **H** Tools: integrations skeleton → chat skeleton → blank (`ClientSessionRoutes.tsx:33,55`, `ToolsView.tsx:11`).
- **M** Catalog's own skeleton (`catalog-page.tsx:165`) is correct per row but lacks the `h-8` section heading → ~40px jump; shows one section where there are several.

### Settings
- **H** Page Suspense fallback (`settings/page.tsx:342`) renders `SettingsSectionSkeleton` outside `SettingsPageShell`: no header, no `max-w-3xl`, edge to edge. Memories section (`fullBleed`) the same.
- **H** `SettingsSectionSkeleton` shape: separate `rounded-2xl p-5` cards with a (64px-tall, R1) tile; real is one `rounded-xl divide-y` group of `px-4 py-3.5` rows with an 18px icon.
- **M** `SettingsRouteSkeleton`: header `px-4`, body `p-5 space-y-3`; real `px-6 py-6`, `gap-4`.
- **M** Workspace settings (`WorkspaceSettingsPanel.tsx:156,421`): bordered cards vs flush `divide-y` member rows; one block vs four toggle cards + summary card. **L** gate is a spinner.

### Notes
- **H** Four stages: Knowledge card grid (`notes/loading.tsx`) → chat skeleton → empty div → empty div (`ClientSessionRoutes.tsx:26,50`, `notes/editor.tsx:525`). Real is a centred ~900px document (title, meta, paragraphs).

### Files
- Matches (list `max-w-3xl` rows, cards grid). **L/M** `?view=outputs` always gets the list skeleton (`FilesRouteLoadingSkeleton.tsx:9`, `files/page.tsx:33`). **M** `FileTreeSkeleton` in the Files list view (`knowledge/panels.tsx:48`) fakes tree indentation and is ~110px short over 10 rows. **L** `KnowledgeFileCardsSkeleton` `py-2.5` vs `py-2`, note cards `h-36` vs `h-28`.

### Automations
- **M** Editor flow placeholder `h-80` vs real hint + bordered `h-96` canvas (`editor-form.tsx:394`). **L** Run replay omits the scrubber (`run-viewer.tsx:262`).

### App shell, marketing, share, auth
- **H** Routes without their own `loading.tsx` (chat, activity, agents, archived, account, home, workspaces, `x/*`) fall back to `WorkRouteSkeleton` via `InitialAppLoading` (`AppRouteSkeletons.tsx:43`).
- **M** `AppMainFallback` (`AppShellLayout.tsx:30`) is always the chat skeleton; the outside-shell fallback drops the rail/sidebar after boot; cold load may put the full-screen boot loader beside the sidebar (verify in browser).
- **M** Marketing skeleton (`RouteLoadingFallbacks.tsx:7`): left-aligned hero, borderless nav; real is centred hero under a 60px bordered nav.
- **M** Share skeleton (`RouteLoadingFallbacks.tsx:89`): `max-w-4xl`, one card; real `max-w-3xl` header with pill + message bubbles.
- **L** Auth form skeleton lacks field labels and the "or" divider (~56px short); sign-in Suspense `fallback={null}`.

## Dead code to delete

- Route skeletons: `memories/loading.tsx`, `outputs/loading.tsx`, `(app)/chat/loading.tsx`, `(app)/notes/loading.tsx` (redirect-only pages); `KnowledgeRouteSkeleton`, `KnowledgeLoadingRouteSkeleton`, `NotesLoadingRouteSkeleton`, `OutputsLoadingRouteSkeleton`, `ProjectsRouteSkeleton` (+ its test case).
- `@overlay/ui` feedback: `OutputCardSkeleton`, `OutputListRowSkeleton`, `ProjectsPageSkeleton`, `IntegrationsGridSkeleton`, `IntegrationListSkeleton`, `IntegrationDialogRowSkeleton`, `AutomationListSkeleton`, `RunDetailSkeleton`, `FileViewerSkeleton`, `KnowledgeListSkeleton` (with the unreachable `mode="knowledge"` memories path); `TileSkeleton` and the unused `Tile*`/`ListRow` primitives. Update `Primitives.stories.tsx` (also drop its "Projects" nav item) and `docs/developer/contribute/architecture.mdx:22`.

Already correct: chat transcript frame, Work composer during loading, sidebar headers/section headers/segmented control, Files list and cards, auth split layout, catalog rows, agent computer frame.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1. Foundations | R1 mesh min-height; single-line sidebar rows primitive (R2); real-header route skeletons (R3); neutral in-shell fallback and per-route `loading.tsx` for chat/agents/activity (R4); delete dead code | Implemented, not merged |
| 2. Work | Shared centred list skeleton for route + in-page (with group header, row cluster, composer); Board and Timeline variants; Organization skeleton; peek/assignment panels; sidebar assignment gating | Implemented, not merged |
| 3. Conversations | One `max-w-4xl` chat skeleton for all chat stages; room/thread skeleton (header, bottom-anchored rows, composer) for DMs, channels, agent threads and the Agents route; Activity and Archived; new-DM dialog; agent editor | Implemented, not merged |
| 4. Sidebars | Agents panel (tiles + `h-10` rows), threads (30px rows), Chats empty-flash, Automations icon, per-panel Suspense fallback, workspace switcher | Implemented, not merged |
| 5. Pages | Extensions/Tools single catalog skeleton with section headings; Settings in shell with grouped rows; workspace settings; Notes document skeleton; Files outputs/list; automation editor and replay | Implemented, not merged |
| 6. Outside the app | Marketing, share, auth | Implemented, not merged |

**Verification per phase:** in the PR preview, throttle the network and record each route from a cold load and a
client navigation in light/dark and desktop/narrow; the skeleton's column edges must line up with the loaded content
(compare bounding boxes of the main column and first row). Consider a small Playwright check that asserts the left edge
and width of the skeleton column equal the loaded column for each route.
