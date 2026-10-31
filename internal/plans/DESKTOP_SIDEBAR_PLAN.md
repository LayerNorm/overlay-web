# Desktop sidebar plan

Status: approved, in implementation. Mockup: `internal/plans/mockups/desktop-parity-mockup.html` (sidebar is the approved direction). Parent plan: `DESKTOP_PARITY_PLAN.md` (this expands item #5).

## Goal

The desktop left sidebar is the web `UnifiedSidebar`, not a lookalike. One sidebar that scrolls as a whole: page links on top, then the current page's list sections underneath. Same header, scope toggle, sections, settings mode and footer workspace menu as web, plus a few Mac-only rows.

## What the mockup settles

| Area | Behavior |
| --- | --- |
| Header | Overlay lockup (no dropdown), Search (⌘K), collapse. Sits below the macOS traffic lights, inside the drag region. |
| Scope | Personal / Workspace segmented toggle under the header. Hidden in Settings and when collapsed. |
| Nav | Home, Work, Agents, Chats, Automations, More. More opens Files, Extensions, then a "This Mac" group with Voice and Browser. |
| Sections | Below nav, one scroll area with the nav. Sticky 30px headers that pin to top and bottom, chevron to collapse, count badge, always visible +. |
| Per page | Home: Recent. Work: Assigned to me. Agents: agent rows (creature avatar, +) with threads nested under the open agent. Chats: Personal shows Chats; Workspace shows Direct messages, Channels, Activity, AI chats. Files: tree. Extensions: Installed. Automations: list. Voice: sessions with app name. Browser: tabs. |
| Page tabs | List / Board / Timeline and Connectors / Skills / MCPs / Apps stay as tabs on the page, never duplicated in the sidebar (web `TAB_PANEL_KINDS`). |
| Settings | Sidebar swaps to the settings list: Back to app, Search settings, groups Personal, Workspace, Integrations, This Mac, Support. The settings page has no inner nav. |
| Footer | Workspace button (workspace icon, workspace name, user name, chevron). Opens upward: Workspaces list with check and member count, Create workspace, All workspaces, Usage, Storage, Account, Settings, Sign out. |
| Collapsed | 56px icon rail; footer shows only the workspace icon and still opens the menu. |
| Breadcrumbs | Personal or Workspace > Page > Item. Settings > Page with no scope. |

## Current state

Web (source of truth):
- `src/components/layout/sidebar/UnifiedSidebar.tsx`: header, `ScopeToggle`, nav rows, `MoreMenu` (Files, Extensions), `PageSections`, `SettingsSidebarNav`, footer. 264px default, resizable 220 to 420, collapsed `w-14`.
- `PageSections.tsx`: sticky collapsible sections. `settingsSearch.ts`: settings groups and keywords.
- Page lists come from render props in `src/app/app/_components/AppShellSidebar.tsx` (`renderChatPanel`, `renderAgentsPanel`, `renderAutomationsPanel`, `renderWorkSection`) and `src/components/layout/AppSidebarInlinePanels.tsx`.
- Footer menu: `src/features/workspaces/components/WorkspaceSwitcher.tsx` + `WorkspaceSwitcherView.tsx` (placement `footer`), account items from `SidebarAccountMenu.tsx`.
- Built on shadcn `packages/overlay-ui/src/components/ui/sidebar.tsx`, `popover`, `collapsible`, `tooltip`, `button`, `input`, Tailwind v4.

Desktop (to replace):
- `src/renderer/src/pages/MainWindow.tsx` (1540 lines) draws the sidebar with inline styles (`sidebarRowStyle`, `EXPANDED_WIDTH`/`COLLAPSED_WIDTH`), a `ActiveTool` switch, and an account button that opens `components/AccountDialog.tsx` (workspaces, Settings, Sign out).
- Lists live in separate pages: `ChatsListPage` (722), `FilesListPage` (576), `ProjectsListPage` (410), `BrowserListPage` (305), `TranscriptionListPage` (288), `AgentsListPage` (249).
- Vendored `packages/overlay-ui` has only `primitives` (no `components/ui` shadcn set, no `SidebarResourceRow`). Renderer is on Tailwind `^3.4.19`; MainWindow and the list pages use no `className` at all.

## Approach

Share, do not port. Move the sidebar shell out of `src/` into a package both apps import, and give it two small adapters (navigation and data). A desktop copy would drift the same way the vendored packages already have.

New package `packages/overlay-shell-react` (workspace name `@overlay/shell-react`):

```
UnifiedSidebar, PageSections, SettingsSidebarNav, ScopeToggle, MoreMenu,
WorkspaceSwitcher(View), SidebarAccountMenu, settingsSearch, panel nav builders
```

Adapter contracts (in `@overlay/app-core/app-shell`, next to `DEFAULT_OVERLAY_NAVIGATION`):

```ts
interface ShellNavigator {
  current: { page: string; scope: PanelScope; itemId?: string; settingsSection?: string }
  go(target: ShellTarget): void           // web: router.push(href); desktop: setActiveTool + state
  hrefFor?(target: ShellTarget): string   // web only, for real links and middle click
}

interface ShellDataSources {
  chats(scope: PanelScope): SectionList   // DMs, channels, activity, AI chats
  agents(): AgentRows                      // agent + threads
  work(): TaskRows
  files(): FileTree
  automations(): Rows
  extensions(): Rows
  workspaces(): WorkspaceMenuData         // list, active id, usage, storage
}
```

Web implements these with the existing hooks; desktop implements them with `ChatProvider`, `WorkspaceProvider`, `EnvironmentProvider` and the `/api/v1` client. Mac-only rows (Home, This Mac group, Voice, Browser) are passed as extra nav items and section sources, not forks.

## Work items

| # | Item | Notes | Size |
| --- | --- | --- | --- |
| S1 | Decide shared-code path | Same as parity #1. Monorepo (`apps/desktop`) makes S3 a normal import; vendoring needs the sync script to carry the new package. | decision |
| S2 | Tailwind v4 and tokens in desktop renderer | Upgrade from 3.4 to v4, import the same CSS variables (`--sidebar-surface`, `--surface-subtle`, `--muted`, ...) and Geist. Keep existing inline-styled pages working during migration. | 1 session |
| S3 | Vendor shadcn `components/ui` into desktop | sidebar, popover, collapsible, tooltip, dropdown-menu, button, input, scroll-area, separator. From `packages/overlay-ui/src/components/ui`, not upstream. | 0.5 |
| S4 | Extract `@overlay/shell-react` on web | Move the files listed above out of `src/components/layout/sidebar` and `src/features/workspaces/components`. Replace `next/link` and `useSearchParams` with `ShellNavigator`. Web behavior must not change: existing tests (`UnifiedSidebar.test.tsx`, `PageSections`, `scopedPanelNav.test.tsx`, `settingsSearch.test.ts`, `SidebarAccountMenu.test.tsx`) pass unchanged. | 2 |
| S5 | Desktop navigator adapter | Map `ShellTarget` to `ActiveTool` plus selected item. Drop `projects` and `transcriptions` from `ActiveTool` (Voice replaces Transcriptions). Persist scope and collapsed state per workspace like web. | 0.5 |
| S6 | Desktop data adapters | Chats from `ChatProvider` (split by scope; DMs and channels need the conversation channel routes desktop does not call yet, see parity audit). Agents and threads from `/api/v1/agents`. Work from the work routes (new to desktop). Files from the existing files store. Voice sessions from the transcription store. Browser tabs from the browser service. | 2 |
| S7 | Mount the shared sidebar in `MainWindow` | Replace the inline-styled sidebar and the separate list pages. Header leaves room for traffic lights and is `-webkit-app-region: drag` except buttons. Keep ⌘K search and the collapse shortcut. | 1 |
| S8 | Footer workspace menu | Use shared `WorkspaceSwitcher` in footer placement. Account opens the Account page, Settings opens Settings, Sign out calls the native auth service. Delete `AccountDialog.tsx`. | 0.5 |
| S9 | Settings mode | Shared `SettingsSidebarNav` with the web groups plus a This Mac group (Voice, Overlay pill, Permissions, Local models, Browser, Updates). Remove the desktop settings inner tab bar. Settings search keywords include the Mac sections. | 0.5 |
| S10 | Remove dead desktop UI | `ProjectsListPage` from navigation (keep data reachable from Files), old list pages once their sections render, `sidebarRowStyle` helpers. | 0.5 |
| S11 | Tests and QA | Unit: adapter mapping, scope split, sticky section behavior, More menu, footer menu items. macOS E2E: navigate every page, collapse and expand, switch scope, switch workspace, open Settings and back, sign out. Visual check light and dark against the mockup. | 1 |

Rough total: about 10 sessions after S1. S2 and S3 can run in parallel with S4.

## Risks

- Tailwind 3 to 4 in the desktop renderer can change existing pages that do use classes (chat, notebook). Land S2 behind a visual pass of those pages.
- DMs, channels and Work need API routes desktop does not call today. Until S6 lands for them, hide those sections rather than show empty ones.
- Extracting the web sidebar touches a hot surface. S4 is a pure move with tests green before and after; no behavior changes in the same PR.
- Sticky headers inside the Electron scroll container need a check on macOS overlay scrollbars.

## Decisions

1. Keep the Home row on desktop.
2. Voice and Browser stay under More, in the "This Mac" group.
3. Scope toggle mimics web: always shown, solo workspaces only change the default scope (`useIsSoloWorkspace`).
4. S1: keep vendoring for now. Desktop main has no sync script or `packages/UPSTREAM.json` (an unmerged `devin/1760594400-desktop-phase0-vendor-sync` branch exists), so this work copies `@overlay/ui` and the new `@overlay/shell-react` by hand and records the source SHA. The monorepo move (parity #1) stays a separate decision.

## Delivery

| PR | Repo | Items |
| --- | --- | --- |
| A | overlay-web | S4: extract `@overlay/shell-react` (pure move, web unchanged). Web-only dependencies (`next/link`, `rememberPanelScope`, workspace avatar, create dialog, solo check) come in through a `ShellAdapterProvider` context or props. |
| B | overlay-desktop | S2, S3: Tailwind v4 (no preflight) and web tokens in the renderer; sync `@overlay/ui` with `components/ui`. |
| C | overlay-desktop | S5 to S10: vendor `@overlay/shell-react`, adapters, mount in `MainWindow`, footer menu, settings mode, remove old sidebar, list panel column and `AccountDialog`. |
| D | overlay-desktop | S11: tests and QA. |
