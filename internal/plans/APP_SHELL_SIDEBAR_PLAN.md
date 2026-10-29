# App shell redesign: single sidebar plan

Mockup: `internal/plans/mockups/app-shell-sidebar-mockup.html`

## Goal

Replace the primary rail + secondary panel with one shadcn-style sidebar (ChatGPT / Devin feel) by default, and keep the current two-rail layout as a setting. Redesign the header and page body to match: no divider lines between sidebar, header and body.

## Decisions (from the mockup review)

1. **One sidebar by default.** Top to bottom: brand lockup + search + collapse, Personal/Workspace toggle, main nav (Work, Agents, Chats, Automations, Explore), the current page's items, account/workspace footer.
2. **Explore** holds Files and Extensions. It opens on hover (and on click, Enter, or ArrowRight), closes on pointer leave after a short delay, and shows the active page name when you are on Files or Extensions.
3. **Header tabs** are for different views of the same data: Work (List, Board, Timeline), Files (All, Notes, Files, Outputs), Extensions (Skills, MCPs, Connectors, Apps).
4. **Sidebar sections** are for things you open one at a time. Chats in both scopes: Activity, Chats (AI chats), Channels, Direct messages, each collapsible with unread counts and a "+" action.
   - Personal: your personal-scope AI chats; channels and DMs whose other participants are only agents (or nobody); activity for those.
   - Workspace: workspace-scope AI chats (shared with members); channels and DMs that include other people; workspace activity.
   - Work has no item list: selecting Work opens the task list for the selected scope.
5. **Chat header** shows only the open conversation: avatar + name, or "# channel" + member count, plus search and a menu. Activity shows "Mark all read".
6. **No dividers.** The header is sticky, translucent with backdrop blur, no bottom border. The sidebar sits on `--sidebar-surface` with no right border.
7. **Two-rail layout** stays available in Settings, Customization: "Sidebar layout: Single sidebar / Rail + panel".
8. **Agent identity stays.** Agent rows keep the `Creature` avatars (shapes and googly eyes) from `src/components/orb/Creature.tsx`.
9. **Rollout:** single sidebar is the default for everyone at once; dividers ship as "None" only. Web only (no desktop or mobile app changes).
10. **Collapse to icons** with Ctrl/Cmd+B (existing shortcut and `sidebarCollapsedStore`). On phones the sidebar is a sheet with the same content.

## Current state (what we build on)

| Area | Where |
| --- | --- |
| Shell composition | `src/components/layout/AppSidebar.tsx`: `AppSidebarPrimaryRail` (w-56 / 72px) + `AppSidebarSecondaryPanel` (w-60) + `MobileSidebar` |
| Route to panel state | `resolveSidebarRouteState` in `src/components/layout/sidebar/appSidebarNav.ts` (`panelKind`, `scope`, `chatsView`, `workView`, `filesView`, `toolsView`) |
| Panel nav builders | `src/components/layout/sidebar/appSidebarPanelNav.ts`, `scopedPanelNav.ts`, `workPanelNav.ts` |
| Page item lists | `renderChatPanel` / `renderAgentsPanel` / `renderAutomationsPanel` / `renderFilesPanel` in `src/app/app/_components/AppShellSidebar.tsx`; `ChatInlinePanel` (filters by `conversationType`), `ActivityInlinePanel`, `AgentsInlinePanel`, `FilesInlinePanel` |
| Nav contract | `DEFAULT_OVERLAY_NAVIGATION` in `packages/overlay-app-core/src/app-shell.ts` (already has the subviews) |
| shadcn sidebar parts | `packages/overlay-ui/src/components/ui/sidebar.tsx` (`SidebarHeader`, `SidebarGroup`, `SidebarMenuButton`, `SidebarMenuBadge`, `SidebarMenuAction`, ...) |
| Header + shell | `AppScreenShell` / `AppScreenHeader` in `packages/overlay-modules-react/src/shell.tsx` (`border = true` default, `tabs` prop exists, sidebar `aside` has `border-r`) |
| Layout setting | `userUiSettings.useSecondarySidebar` already exists in `convex/schema.ts` and `convex/platform/uiSettings.ts` (default `false`) but is stripped from the public payload in `src/server/app-api/v1/settings/route.ts` and `AppSettingsProvider.tsx` |

`useSecondarySidebar` is dormant and defaults to `false`, so reusing it means everyone gets the single sidebar and only people who opt in get two rails. No migration needed.

## Target architecture

- **`UnifiedSidebar`** (new, `packages/overlay-shell-react/src/sidebar/UnifiedSidebar.tsx`), built only from `@overlay/ui` sidebar primitives. It reuses `useAppSidebarState` for routing, gating, badges and account state, so feature flags, capabilities, white-label brand and public showcase keep working.
- **`AppSidebar`** picks the layout: `useSecondarySidebar ? <ClassicSidebar /> : <UnifiedSidebar />`. Classic is today's rail + panel, minus borders.
- **Nav placement** becomes data: add `placement?: 'primary' | 'explore'` to `OverlayNavigationItem` (Files and Extensions are `explore`), so white-label configs can move items without code changes.
- **Global scope.** One Personal/Workspace value drives every page via the existing `resolvePanelScope` (URL `?scope=`, then the saved choice). Chats stop deriving scope from `chatsView`: `chatScopeForView` only maps old links. Solo workspaces hide the toggle, like today.
- **Page tabs** go in `AppScreenHeader tabs` with the `@overlay/ui` `Tabs` / `SegmentedControl`, driven by the existing `?view=` params. The single sidebar no longer renders sub-rows; classic keeps them in its panel.
- **Workspace AI chats (backend).** Conversations have no `scope` today (AI chats are always private to their creator). Add optional `scope: 'personal' | 'workspace'` to `conversations` following `src/shared/workspaces/resource-scope.ts` (missing = personal), list workspace-scope AI chats for active members in `GET /api/v1/conversations?view=personal&scope=`, enforce read/write access for members, and add "Move to Workspace / Personal" in the chat menu via the existing scope route. New chats inherit the selected scope. Expand-only schema change; Convex deploys follow the normal main lane.
- **Chat sections.** Split `ChatInlinePanel` into one data hook (all conversations for the workspace) and a `ChatSidebarSections` view that groups by `conversationType`. Collapsed state per section is saved to localStorage. The "+" actions reuse `NewChannelDialog`, `NewDirectMessageDialog` and `createChat`. URLs stay as they are (`/app/chat?view=dms&id=`, `/app/activity`) so deep links and notifications still work.

## Phases (one PR each, all target main, all need `needs-preview`)

1. **Foundations, no visual change.** Expose `useSecondarySidebar` in `AppSettings` (`src/shared/schemas/settings.ts`, settings route, provider). Cache it in localStorage so the boot layout does not flash. Add nav `placement` to app-core with tests. Add `border` / `sticky` / `translucent` options to `AppScreenShell` and `AppScreenHeader` without changing defaults.
2. **`UnifiedSidebar` on desktop.** Brand, search (opens `GlobalSearchDialog`), collapse, scope toggle, main nav with badges, Explore hover menu (controlled `Popover`/`DropdownMenu` with open/close delays, full keyboard support, click on touch), account footer reusing `DesktopAccountSlot` / `SidebarAccountMenu`, icon-collapsed mode with tooltips. The settings toggle ships here.
3. **Header and body.** Single layout: no sidebar `border-r`, header without `border-b`, sticky with blur. Move Work, Files and Extensions sub-navigation into header tabs. Reorder Extensions to Skills, MCPs, Connectors, Apps. Audit hard-coded header borders: `WorkPage`, `WorkToolbar`, `ChatSuspenseBoundary` skeleton, `DirectMessageExperience.parts`, `AgentEditorPage.parts`.
4. **Chats.** `ChatSidebarSections` (Activity, Chats, Channels, Direct messages; Personal recents), unread badges from the current `chatUnreadBadges` and collaboration notifications, a simpler `DirectMessageExperience` header, and an Activity header action.
5. **Page items for every page.** Agents (`AgentsInlinePanel`, keeping `Creature` avatars), Automations, Files (recent), Extensions (installed). Work shows no list.
5b. **Workspace AI chats.** Conversation `scope` field, list/access rules, move-scope action, new chats inherit scope.
6. **Phone widths + default.** Replace the two-step `MobileSidebar` with a `Sheet` that renders `UnifiedSidebar` content. Single is the default for everyone from the first PR that ships it (no staged rollout). Update docs.

## Verification per PR

- `npm run typecheck`, targeted ESLint on changed files, `npm run check:raw-controls`, `npm run ui:test`, `npm run app-core:test`. Update the existing tests: `appSidebarNav.test.ts`, `scopedPanelNav.test.tsx`, `AppSidebarPrimaryRail.test.tsx`, `AppSidebarSecondaryPanel.test.tsx`, `AppSidebarInlinePanels.test.tsx`.
- New tests: `UnifiedSidebar` (scope switch keeps page, Explore hover and keyboard, collapsed tooltips, solo workspace), `ChatSidebarSections` (grouping, collapse persistence, unread), layout setting round trip.
- Preview QA (light and dark, desktop and phone widths): every main page, Personal and Workspace, Explore by hover and keyboard, tabs update `?view=` and survive reload, a chat deep link and a notification open the right conversation, Ctrl/Cmd+B collapse, switching layout in Settings applies right away and survives reload, public showcase and a solo workspace.
- Watch boot: the `(shell)` / `AppShellLayout` hydration stall (see the `singleplayer` note in AGENTS.md). Keep `useSearchParams` users inside `Suspense` and avoid new blocking work in the layout.

## Docs to update

`docs/develop/customization.mdx` (layout setting), `docs/develop/feature-modules.mdx` (nav `placement`), `internal/develop/interface-design.md` (sidebar and header rules: tabs vs sections, no dividers), root `CHANGELOG.md`.

## Answered

1. Both scopes get AI chats, DMs, channels and activity (workspace AI chats need the conversation `scope` field).
2. Work in the sidebar just opens the scoped task list.
3. Default for everyone at once.
4. Dividers: none.
