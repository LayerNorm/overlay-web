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

  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  filesView: string
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  notesOpen: boolean
  currentSearchParams: URLSearchParams

  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string, scope?: PanelScope) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
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

      if (nextView === 'all') params.delete('view')
      else params.set('view', nextView)
      params.delete('file')
      params.delete('folder')
      params.delete('id')
      params.delete('memory')
      params.delete('scope')
      const query = params.toString()
      if (activeWorkspaceId) {
        router.push(buildWorkspaceHref(
          activeWorkspaceId,
          `/app/files${query ? `?${query}` : ''}`,
          nextScope,
        ))
      } else {
        params.set('scope', nextScope)
        router.push(query ? `${'/app/files'}?${params.toString()}` : `/app/files?scope=${nextScope}`)
      }
    },
  })
}

function buildAgentsPanelNav({
  scope,
  effectivePendingSecondaryNavId,
  currentSearchParams,

  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams

  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string, scope?: PanelScope) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
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

      for (const selector of ['agent', 'agentId', 'id', 'thread', 'threadId', 'conversationId']) {
        params.delete(selector)
      }
      params.delete('scope')
      const query = params.toString()
      const route = query ? `/app/agents?${query}` : '/app/agents'
      const agentsHref = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, route, next)
        : route
      if (!activeWorkspaceId) {
        const legacyParams = new URLSearchParams(route.split('?')[1] ?? '')
        legacyParams.set('scope', next)
        router.push(`/app/agents?${legacyParams.toString()}`)
      } else {
        router.push(agentsHref)
      }
    },
  })
}

function buildToolsPanelNav({
  toolsView,
  scope,
  effectivePendingSecondaryNavId,
  toolsItems,
  currentSearchParams,

  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  toolsView: string
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  toolsItems: ReadonlyArray<InlineNavItem>
  currentSearchParams: URLSearchParams

  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string, scope?: PanelScope) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
    sub: toolsView,
    subItems: { personal: toolsItems, workspace: toolsItems },
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (nextScope, nextSub) => {
      closeMobileDrawer()
      const nextView = nextSub ?? toolsView
      if (nextScope === scope && nextView === toolsView) return
      beginSecondaryNavigation(nextSub ? `${nextScope}:${nextSub}` : nextScope)
      const params = withPanelScope(new URLSearchParams(currentSearchParams.toString()), nextScope)

      params.set('view', nextView)
      params.delete('scope')
      const legacyHref = `/app/tools?${params.toString()}`
      const scopedHref = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, legacyHref, nextScope)
        : `${legacyHref}${legacyHref.includes('?') ? '&' : '?'}scope=${nextScope}`
      router.push(scopedHref)
    },
  })
}

function buildAutomationsPanelNav({
  scope,
  effectivePendingSecondaryNavId,
  currentSearchParams,

  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  scope: PanelScope
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams

  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string, scope?: PanelScope) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return buildScopedPanelNav({
    scope,
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
      params.delete('automationId')
      params.delete('scope')

      const query = params.toString()
      if (activeWorkspaceId) {
        router.push(buildWorkspaceHref(
          activeWorkspaceId,
          `/app/automations${query ? `?${query}` : ''}`,
          next,
        ))
      } else {
        params.set('scope', next)
        router.push(`/app/automations?${params.toString()}`)
      }
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

  routeState: Pick<SidebarRouteState, 'chatsView' | 'filesView' | 'scope' | 'toolsView' | 'workView' | 'notesOpen' | 'settingsSection'>
  effectivePendingSecondaryNavId: string | null
  totalUnread: number
  collaborationUnread: { dms: number; channels: number; total: number }
  shouldLoadCollaborationUnread: boolean
  router: SidebarRouter
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string, scope?: PanelScope) => string
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

      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
    })
  }
  if (panelKind === 'agents') {
    return buildAgentsPanelNav({
      scope: routeState.scope,
      effectivePendingSecondaryNavId,
      currentSearchParams,

      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
    })
  }
  if (panelKind === 'automations') {
    return buildAutomationsPanelNav({
      scope: routeState.scope,
      effectivePendingSecondaryNavId,
      currentSearchParams,

      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
    })
  }
  if (panelKind === 'tools') {
    return buildToolsPanelNav({
      toolsView: routeState.toolsView,
      scope: routeState.scope,
      currentSearchParams,
      effectivePendingSecondaryNavId,
      toolsItems,

      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
    })
  }
  if (panelKind === 'work') {
    return buildWorkPanelNav({
      scope: routeState.scope,
      workView: routeState.workView,
      effectivePendingSecondaryNavId,
      currentSearchParams,
      activeWorkspaceId,
      buildWorkspaceHref,
      router,
      closeMobileDrawer,
      beginSecondaryNavigation,
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
