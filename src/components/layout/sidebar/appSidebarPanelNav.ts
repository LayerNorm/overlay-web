import { Settings } from 'lucide-react'
import type { OverlaySettingsSection } from '@overlay/app-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { getLastChatForView } from '@/shared/chat/last-chat-by-view'
import {
  selectConversationForView,
  type CollaborationChatView,
} from '@/shared/chat/chat-view-navigation'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import { chatsInlineItems, agentsInlineItems } from '@/components/layout/sidebar-nav'
import { filesInlineItems } from '@/components/layout/FilesCategorySidebar'
import type { InlineNavItem } from '@/components/layout/AppSidebarInlinePanels'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { SETTINGS_SECTION_ICONS, type SidebarRouteState } from './appSidebarNav'

interface SidebarRouter {
  push: (href: string) => void
}

// Incremented per chats-subview select; an in-flight fetch that resolves after
// a newer selection is stale and must not steer the route.
let chatViewNavigationVersion = 0

async function pushArchivedDestination(router: SidebarRouter, surface: string) {
  try {
    const response = await fetch('/api/v1/conversations?archived=true', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (response.ok) {
      const body = await response.json() as unknown
      const conversations = Array.isArray(body)
        ? body as Array<{ _id?: string }>
        : (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
          ? (body as { data: Array<{ _id?: string }> }).data
          : [])
      const mostRecentId = conversations[0]?._id
      if (mostRecentId) {
        router.push(`${surface}?id=${encodeURIComponent(mostRecentId)}`)
        return
      }
    }
  } catch {
    // Empty archived surface is still the right destination.
  }
  router.push(surface)
}

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
}): SecondaryPanelNav {
  const chatItems = (publicShowcase
    ? chatsInlineItems.filter((item) => item.id !== 'activity' && item.id !== 'archived')
    : chatsInlineItems).map((item) => ({ ...item, badgeCount: chatUnreadBadges[item.id] }))
  return {
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
      if (next === 'archived') {
        const surface = activeWorkspaceId
          ? buildWorkspaceHref(activeWorkspaceId, '/app/archived')
          : '/app/archived'
        await pushArchivedDestination(router, surface)
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
}

function buildFilesPanelNav({
  filesView,
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
}: {
  filesView: string
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
}): SecondaryPanelNav {
  return {
    items: filesInlineItems,
    activeId: filesView,
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      closeMobileDrawer()
      // With a file or folder open the category row is still "current", so a
      // plain equality check swallowed the click and nothing happened. Selecting
      // the category you are already in is how you get back out to its list.
      const hasOpenItem = notesOpen || currentSearchParams.has('file') || currentSearchParams.has('folder') || currentSearchParams.has('id')
      if (next === filesView && !hasOpenItem) return
      beginSecondaryNavigation(next)
      const params = new URLSearchParams(currentSearchParams.toString())
      if (publicShowcase) params.set('showcase', '1')
      if (next === 'all') params.delete('view')
      else params.set('view', next)
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
  }
}

function buildAgentsPanelNav({
  agentsView,
  effectivePendingSecondaryNavId,
  currentSearchParams,
  publicShowcase,
  canonicalWorkspaceRoute,
  activeWorkspaceId,
  buildWorkspaceHref,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  agentsView: string
  effectivePendingSecondaryNavId: string | null
  currentSearchParams: URLSearchParams
  publicShowcase: boolean
  canonicalWorkspaceRoute: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return {
    items: agentsInlineItems,
    activeId: agentsView,
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      closeMobileDrawer()
      if (next === agentsView) return
      beginSecondaryNavigation(next)
      const params = new URLSearchParams(currentSearchParams.toString())
      if (publicShowcase) params.set('showcase', '1')
      if (next === 'personal') params.delete('view')
      else params.set('view', next)
      const query = params.toString()
      const agentsHref = canonicalWorkspaceRoute && activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/agents')
        : '/app/agents'
      router.push(query ? `${agentsHref}?${query}` : agentsHref)
    },
  }
}

function buildToolsPanelNav({
  toolsView,
  effectivePendingSecondaryNavId,
  toolsItems,
  publicShowcase,
  router,
  closeMobileDrawer,
  beginSecondaryNavigation,
}: {
  toolsView: string
  effectivePendingSecondaryNavId: string | null
  toolsItems: ReadonlyArray<InlineNavItem>
  publicShowcase: boolean
  router: SidebarRouter
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
}): SecondaryPanelNav {
  return {
    items: toolsItems,
    activeId: toolsView,
    pendingId: effectivePendingSecondaryNavId,
    onSelect: (next) => {
      closeMobileDrawer()
      if (next === toolsView) return
      beginSecondaryNavigation(next)
      router.push(`/app/tools?${new URLSearchParams({
        ...(publicShowcase ? { showcase: '1' } : {}),
        view: next,
      }).toString()}`)
    },
  }
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
}: {
  panelKind: SidebarRouteState['panelKind']
  publicShowcase: boolean
  routeState: Pick<SidebarRouteState, 'chatsView' | 'filesView' | 'agentsView' | 'toolsView' | 'notesOpen' | 'canonicalWorkspaceRoute' | 'settingsSection'>
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
}): SecondaryPanelNav | undefined {
  if (panelKind === 'chat') {
    const cumulativeChatUnread = totalUnread + (shouldLoadCollaborationUnread ? collaborationUnread.total : 0)
    const chatUnreadBadges: Record<(typeof chatsInlineItems)[number]['id'], number> = {
      personal: totalUnread,
      dms: shouldLoadCollaborationUnread ? collaborationUnread.dms : 0,
      channels: shouldLoadCollaborationUnread ? collaborationUnread.channels : 0,
      activity: cumulativeChatUnread,
      // Archived chats are deliberately out of the unread count: they were put
      // away, so surfacing a badge would pull attention back to them.
      archived: 0,
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
    })
  }
  if (panelKind === 'files' || panelKind === 'notes') {
    return buildFilesPanelNav({
      filesView: routeState.filesView,
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
    })
  }
  if (panelKind === 'agents') {
    return buildAgentsPanelNav({
      agentsView: routeState.agentsView,
      effectivePendingSecondaryNavId,
      currentSearchParams,
      publicShowcase,
      canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
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
      effectivePendingSecondaryNavId,
      toolsItems,
      publicShowcase,
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
