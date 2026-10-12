import { Settings } from 'lucide-react'
import type { OverlaySettingsSection } from '@overlay/app-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { getLastChatForView } from '@/shared/chat/last-chat-by-view'
import {
  selectConversationForView,
  type CollaborationChatView,
} from '@/shared/chat/chat-view-navigation'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import { chatsInlineItems } from '@/components/layout/sidebar-nav'
import { filesInlineItems } from '@/components/layout/FilesCategorySidebar'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { SETTINGS_SECTION_ICONS, chatScopeForView, type SidebarRouteState } from './appSidebarNav'
import { buildScopedPanelNav } from './scopedPanelNav'
import { withPanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'
import { soloPanelScope } from '@/shared/workspaces/solo-workspace'

interface SidebarRouter {
  push: (href: string) => void
}

// Incremented per chats-subview select; an in-flight fetch that resolves after
// a newer selection is stale and must not steer the route.
let chatViewNavigationVersion = 0

async function resolveViewConversationId({
  view,
  activeWorkspaceId,
  navigationVersion,
}: {
  view: string
  activeWorkspaceId: string | null
  navigationVersion: number
}): Promise<{ stale: boolean; conversationId: string | null }> {
  try {
    const page = await overlayAppClient.conversations.getPage<CachedConversation>({
      limit: 24,
      view: view as CollaborationChatView,
    })
    if (navigationVersion !== chatViewNavigationVersion) {
      return { stale: true, conversationId: null }
    }
    return {
      stale: false,
      conversationId: selectConversationForView(
        page.data,
        getLastChatForView(activeWorkspaceId, view),
      )?._id ?? null,
    }
  } catch {
    // Stay in the selected subview with its empty state. Reusing an
    // unvalidated id here can mix a DM and channel after a failed fetch.
    return { stale: false, conversationId: null }
  }
}

function buildChatPanelNav({
  publicShowcase,
  chatsView,
  effectivePendingSecondaryNavId,
  chatUnreadBadges,
  router,
  activeWorkspaceId,
  buildWorkspaceHref,
  closeMobileDrawer,
  beginSecondaryNavigation,
  solo,
}: {
  publicShowcase: boolean
  chatsView: string
  effectivePendingSecondaryNavId: string | null
  chatUnreadBadges: Record<string, number>
  router: SidebarRouter
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  const chatItems = (publicShowcase
    ? chatsInlineItems.filter((item) => item.id !== 'activity')
    : chatsInlineItems).map((item) => ({ ...item, badgeCount: chatUnreadBadges[item.id] }))
  const flat: SecondaryPanelNav = {
    items: chatItems,
    activeId: chatsView,
    pendingId: effectivePendingSecondaryNavId,
    onSelect: async (next) => {
      closeMobileDrawer()
      if (next === chatsView) return
      beginSecondaryNavigation(next)
      if (next === 'activity') {
        router.push(activeWorkspaceId
          ? buildWorkspaceHref(activeWorkspaceId, '/app/activity')
          : '/app/activity')
        return
      }
      const baseHref = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
        : '/app/chat'
      const navigationVersion = ++chatViewNavigationVersion
      let conversationId: string | null = null
      if (next === 'dms' || next === 'channels') {
        const result = await resolveViewConversationId({
          view: next,
          activeWorkspaceId,
          navigationVersion,
        })
        if (result.stale) return
        conversationId = result.conversationId
      }
      router.push(`${baseHref}?${new URLSearchParams({
        ...(publicShowcase ? { showcase: '1' } : {}),
        view: next,
        ...(conversationId ? { id: conversationId } : {}),
      }).toString()}`)
    },
  }

  const chatScope = chatScopeForView(chatsView)
  const unreadOf = (id: string) => chatItems.find((item) => item.id === id)?.badgeCount ?? 0
  if (solo) {
    // One person: no direct messages or activity feed, just chats and channels (rooms with agents).
    const soloRows = chatItems
      .filter((item) => item.id === 'personal' || item.id === 'channels')
      .map((item) => (item.id === 'personal' ? { ...item, label: 'Chats' } : item))
    return buildScopedPanelNav({
      scope: soloPanelScope(chatScope, true),
      sub: chatsView === 'channels' ? 'channels' : chatScope === 'personal' ? 'personal' : null,
      subItems: { personal: soloRows },
      pendingId: effectivePendingSecondaryNavId,
      solo: true,
      onSelect: (scope, sub) => flat.onSelect(sub ?? scope),
    })
  }
  return buildScopedPanelNav({
    scope: chatScope,
    sub: chatScope === 'workspace' ? chatsView : null,
    // Direct messages, channels, and activity are the Workspace scope; personal chats and archived chats have no sub-rows.
    subItems: { workspace: chatItems.filter((item) => item.id === 'dms' || item.id === 'channels' || item.id === 'activity') },
    pendingId: effectivePendingSecondaryNavId,
    badges: { workspace: unreadOf('dms') + unreadOf('channels') },
    onSelect: (scope, sub) => flat.onSelect(sub ?? (scope === 'workspace' ? (chatScope === 'workspace' ? chatsView : 'dms') : scope)),
  })
}

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
      if (publicShowcase) params.set('showcase', '1')
      // With an agent open, Personal must stay explicit in the URL — the
      // panel auto-corrects bare `?agent=` links to the agent's own tab, so
      // a missing `scope` would read as an uncorrected link and fight the
      // deliberate switch.
      if (next === 'personal' && params.has('agent')) params.set('scope', 'personal')
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
  routeState: Pick<SidebarRouteState, 'chatsView' | 'filesView' | 'scope' | 'toolsView' | 'notesOpen' | 'canonicalWorkspaceRoute' | 'settingsSection'>
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
