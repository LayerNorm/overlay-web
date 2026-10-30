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
import { mergeHrefSearchParams } from '@/shared/workspaces/routing'
import { chatScopeForView } from './appSidebarNav'
import { buildScopedPanelNav } from './scopedPanelNav'
import type { PanelScope } from '@/shared/workspaces/panel-scope'

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

/** The newest AI chat in the scope, so the Chats nav item reopens where the person left off. */
export async function resolveRecentChatHref(baseHref: string, scope: 'personal' | 'workspace'): Promise<string> {
  try {
    const page = await overlayAppClient.conversations.getPage<CachedConversation & { scope?: 'personal' | 'workspace' }>({ limit: 24, view: 'personal' })
    const recent = page.data.find((chat) => (chat.scope ?? 'personal') === scope)
    if (!recent) return baseHref
    const view = scope === 'workspace' ? 'workspace-chats' : 'personal'
    return mergeHrefSearchParams(baseHref, new URLSearchParams({ view, id: recent._id }))
  } catch {
    return baseHref
  }
}

const WORKSPACE_CHATS_ITEM = { id: 'workspace-chats', label: 'Chats', icon: MessageSquare }
const WORKSPACE_CHAT_IDS = new Set(['dms', 'channels', 'activity'])

export function buildChatPanelNav({

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

  chatsView: string
  effectivePendingSecondaryNavId: string | null
  chatUnreadBadges: Record<string, number>
  router: SidebarRouter
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string, scope?: PanelScope) => string
  closeMobileDrawer: () => void
  beginSecondaryNavigation: (id: string) => void
  solo: boolean
}): SecondaryPanelNav {
  const chatItems = (chatsInlineItems).map((item) => ({ ...item, badgeCount: chatUnreadBadges[item.id] }))
  const flat: SecondaryPanelNav = {
    items: chatItems,
    activeId: chatsView,
    pendingId: effectivePendingSecondaryNavId,
    onSelect: async (next) => {
      closeMobileDrawer()
      if (next === chatsView) return
      beginSecondaryNavigation(next)
      const nextScope: PanelScope = next === 'dms' || next === 'channels' || next === 'activity' || next === 'workspace-chats'
        ? 'workspace'
        : 'personal'
      if (next === 'activity') {
        router.push(activeWorkspaceId
          ? buildWorkspaceHref(activeWorkspaceId, '/app/activity', 'workspace')
          : '/app/activity')
        return
      }
      const baseHref = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/chat', nextScope)
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
      const params = new URLSearchParams()

      params.set('view', next)
      if (conversationId) params.set('id', conversationId)
      router.push(mergeHrefSearchParams(baseHref, params))
    },
  }

  const chatScope = chatScopeForView(chatsView)
  const unreadOf = (id: string) => chatItems.find((item) => item.id === id)?.badgeCount ?? 0
  const workspaceChatItems = chatItems.filter((item) => WORKSPACE_CHAT_IDS.has(item.id) && !(solo && item.id === 'dms'))
  return buildScopedPanelNav({
    scope: chatScope,
    sub: chatScope === 'workspace' ? chatsView : null,
    // Workspace AI chats, direct messages, channels, and activity are the Workspace scope; personal chats have no sub-rows.
    subItems: { workspace: [...([WORKSPACE_CHATS_ITEM]), ...workspaceChatItems] },
    pendingId: effectivePendingSecondaryNavId,
    badges: { workspace: unreadOf('dms') + unreadOf('channels') },
    onSelect: (scope, sub) => flat.onSelect(sub ?? (scope !== 'workspace' ? scope : chatScope === 'workspace' ? chatsView : 'workspace-chats')),
  })
}
