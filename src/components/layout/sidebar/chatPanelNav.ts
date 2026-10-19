import { MessageSquare } from 'lucide-react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { getLastChatForView } from '@/shared/chat/last-chat-by-view'
import {
  selectConversationForView,
  type CollaborationChatView,
} from '@/shared/chat/chat-view-navigation'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import { chatsInlineItems } from '@/components/layout/sidebar-nav'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { chatScopeForView } from './appSidebarNav'
import { buildScopedPanelNav } from './scopedPanelNav'
import { soloPanelScope } from '@/shared/workspaces/solo-workspace'

export interface SidebarRouter {
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

const WORKSPACE_CHATS_ITEM = { id: 'workspace-chats', label: 'AI chats', icon: MessageSquare }
const WORKSPACE_CHAT_IDS = new Set(['dms', 'channels', 'activity'])

export function buildChatPanelNav({
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
      .map((item) => (item.id === 'personal' ? { ...item, label: 'AI chats' } : item))
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
    // Workspace AI chats, direct messages, channels, and activity are the Workspace scope; personal chats have no sub-rows.
    subItems: { workspace: [...(publicShowcase ? [] : [WORKSPACE_CHATS_ITEM]), ...chatItems.filter((item) => WORKSPACE_CHAT_IDS.has(item.id))] },
    pendingId: effectivePendingSecondaryNavId,
    badges: { workspace: unreadOf('dms') + unreadOf('channels') },
    onSelect: (scope, sub) => flat.onSelect(sub ?? (scope !== 'workspace' ? scope : chatScope === 'workspace' ? chatsView : publicShowcase ? 'dms' : 'workspace-chats')),
  })
}
