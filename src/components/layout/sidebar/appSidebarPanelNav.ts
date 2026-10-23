import { Settings } from 'lucide-react'
import type { OverlaySettingsSection } from '@overlay/app-core'
import { chatsInlineItems } from '@/components/layout/sidebar-nav'
import { filesInlineItems } from '@/components/layout/FilesCategorySidebar'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { SETTINGS_SECTION_ICONS, type SidebarRouteState } from './appSidebarNav'
import { buildScopedPanelNav } from './scopedPanelNav'
import { buildWorkPanelNav } from './workPanelNav'
import { buildChatPanelNav, type SidebarRouter } from './chatPanelNav'
import { withPanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'

function buildFilesPanelNav({
  filesView,
  scope,
  effectivePendingSecondaryNavId,
  notesOpen,
  currentSearchParams,
  publicShowcase,
  canonicalWorkspaceRoute,
  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  filesView: string
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  notesOpen: boolean
  currentSearchParams: URLSearchParams
  publicShowcase: boolean
  canonicalWorkspaceRoute: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
    solo,
    sub: filesView,
    subItems: { personal: filesInlineItems, workspace: filesInlineItems },
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (nextScope, nextSub) => {
      closeMobileDrawer()
      const nextView = nextSub ?? filesView
      // With a file or folder open the category row is still "current", so a
      // plain equality check swallowed the click and nothing happened. Selecting
      // the category you are already in is how you get back out to its list.
      const hasOpenItem = notesOpen || currentSearchParams.has('file') || currentSearchParams.has('folder') || currentSearchParams.has('id')
      if (nextScope === scope && nextView === filesView && !hasOpenItem) return
      beginSecondaryNavigation(nextSub ? `${nextScope}:${nextSub}` : nextScope)
      const params = withPanelScope(currentSearchParams, nextScope)
      if (publicShowcase) params.set('showcase', '1')
      if (nextView === 'all') params.delete('view')
      else params.set('view', nextView)
      params.delete('file')
      params.delete('folder')
      params.delete('id')
      params.delete('memory')
      const query = params.toString()
      const filesHref = canonicalWorkspaceRoute && activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/files')
        : '/app/files'
      router.push(query ? `${filesHref}?${query}` : filesHref)
    },
  })
}

function buildAgentsPanelNav({
  scope,
  effectivePendingSecondaryNavId,
  currentSearchParams,
  publicShowcase,
  canonicalWorkspaceRoute,
  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams
  publicShowcase: boolean
  canonicalWorkspaceRoute: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
    solo,
    soloLabel: 'Agents',
    sub: null,
    subItems: {},
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      closeMobileDrawer()
      if (next === scope) return
      beginSecondaryNavigation(next)
      const params = withPanelScope(currentSearchParams, next)
      // The tab used to be `?view=`; the scope replaces it.
      params.delete('view')
      params.delete('agent')
      params.delete('agentId')
      params.delete('id')
      if (publicShowcase) params.set('showcase', '1')
      params.set('scope', next)
      const query = params.toString()
      const agentsHref = canonicalWorkspaceRoute && activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/agents')
        : '/app/agents'
      router.push(query ? `${agentsHref}?${query}` : agentsHref)
    },
  })
}

function buildToolsPanelNav({
  toolsView,
  scope,
  effectivePendingSecondaryNavId,
  toolsItems,
  currentSearchParams,
  publicShowcase,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  toolsView: string
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  toolsItems: ReadonlyArray<InlineNavItem>
  currentSearchParams: URLSearchParams
  publicShowcase: boolean
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
    solo,
    sub: toolsView,
    subItems: { personal: toolsItems, workspace: toolsItems },
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (nextScope, nextSub) => {
      closeMobileDrawer()
      const nextView = nextSub ?? toolsView
      if (nextScope === scope && nextView === toolsView) return
      beginSecondaryNavigation(nextSub ? `${nextScope}:${nextSub}` : nextScope)
      const params = withPanelScope(new URLSearchParams(currentSearchParams.toString()), nextScope)
      if (publicShowcase) params.set('showcase', '1')
      params.set('view', nextView)
      router.push(`/app/tools?${params.toString()}`)
    },
  })
}

function buildAutomationsPanelNav({
  scope,
  effectivePendingSecondaryNavId,
  currentSearchParams,
  publicShowcase,
  canonicalWorkspaceRoute,
  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams
  publicShowcase: boolean
  canonicalWorkspaceRoute: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
    solo,
    soloLabel: 'Automations',
    sub: null,
    subItems: {},
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      closeMobileDrawer()
      if (next === scope) return
      beginSecondaryNavigation(next)
      const params = withPanelScope(currentSearchParams, next)
      // Leave an open automation behind: it may not exist in the scope being switched to.
      params.delete('id')
      params.delete('automation')
      if (publicShowcase) params.set('showcase', '1')
      const query = params.toString()
      const href = canonicalWorkspaceRoute && activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/automations')
        : '/app/automations'
      router.push(query ? `${href}?${query}` : href)
    },
  })
}

function buildSettingsPanelNav({
  settingsSections,
  settingsSection,
  effectivePendingSecondaryNavId,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  settingsSections: readonly OverlaySettingsSection[]
  settingsSection: string
  effectivePendingSecondaryNavId: string | null
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return {
    items: settingsSections.map(({ id, label, href: sectionHref }) => ({
      id,
      label,
      icon: SETTINGS_SECTION_ICONS[id] ?? Settings,
      href: sectionHref ?? `/app/settings?section=${id}`,
    })),
    activeId: settingsSection,
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      if (next !== settingsSection) beginSecondaryNavigation(next)
      closeMobileDrawer()
    },
  }
}

export function resolveSecondaryPanelNav({
  panelKind,
  publicShowcase,
  routeState,
  effectivePendingSecondaryNavId,
  totalUnread,
  collaborationUnread,
  shouldLoadCollaborationUnread,
  router,
  activeWorkspaceId,
  buildWorkspaceHref,
  currentSearchParams,
  toolsItems,
  settingsSections,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  panelKind: SidebarRouteState['panelKind']
  publicShowcase: boolean
  routeState: Pick<SidebarRouteState, 'chatsView' | 'filesView' | 'scope' | 'toolsView' | 'workView' | 'notesOpen' | 'canonicalWorkspaceRoute' | 'settingsSection'>
  effectivePendingSecondaryNavId: string | null
  totalUnread: number
  collaborationUnread: { dms: number; channels: number; total: number }
  shouldLoadCollaborationUnread: boolean
  router: SidebarRouter
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  currentSearchParams: URLSearchParams
  toolsItems: ReadonlyArray<InlineNavItem>
  settingsSections: readonly OverlaySettingsSection[]
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  /** The workspace is one person: no Personal/Workspace split (see `isSoloWorkspace`). */
  solo: boolean
}): SecondaryPanelNav | undefined {
  if (panelKind === 'chat') {
    const cumulativeChatUnread = totalUnread + (shouldLoadCollaborationUnread ? collaborationUnread.total : 0)
    const chatUnreadBadges: Record<(typeof chatsInlineItems)[number]['id'], number> = {
      personal: totalUnread,
      dms: shouldLoadCollaborationUnread ? collaborationUnread.dms : 0,
      channels: shouldLoadCollaborationUnread ? collaborationUnread.channels : 0,
      activity: cumulativeChatUnread,
    }
    return buildChatPanelNav({
      publicShowcase,
      chatsView: routeState.chatsView,
      effectivePendingSecondaryNavId,
      chatUnreadBadges,
      router,
      activeWorkspaceId,
      buildWorkspaceHref,
      closeMobileDrawer,
      beginSecondaryNavigation,
      solo,
    })
  }
  if (panelKind === 'files' || panelKind === 'notes') {
    return buildFilesPanelNav({
      filesView: routeState.filesView,
      scope: routeState.scope,
      effectivePendingSecondaryNavId,
      notesOpen: routeState.notesOpen,
      currentSearchParams,
      publicShowcase,
      canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
      solo,
    })
  }
  if (panelKind === 'agents') {
    return buildAgentsPanelNav({
      scope: routeState.scope,
      effectivePendingSecondaryNavId,
      currentSearchParams,
      publicShowcase,
      canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
      solo,
    })
  }
  if (panelKind === 'automations') {
    return buildAutomationsPanelNav({
      scope: routeState.scope,
      effectivePendingSecondaryNavId,
      currentSearchParams,
      publicShowcase,
      canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
      solo,
    })
  }
  if (panelKind === 'tools') {
    return buildToolsPanelNav({
      toolsView: routeState.toolsView,
      scope: routeState.scope,
      currentSearchParams,
      effectivePendingSecondaryNavId,
      toolsItems,
      publicShowcase,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
      solo,
    })
  }
  if (panelKind === 'work') {
    return buildWorkPanelNav({
      scope: routeState.scope,
      workView: routeState.workView,
      effectivePendingSecondaryNavId,
      currentSearchParams,
      canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
      solo,
    })
  }
  if (panelKind === 'settings') {
    return buildSettingsPanelNav({
      settingsSections,
      settingsSection: routeState.settingsSection,
      effectivePendingSecondaryNavId,
      closeMobileDrawer,
      beginSecondaryNavigation,
    })
  }
  return undefined
}
