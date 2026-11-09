import { MessageSquare } from 'lucide-react'
import { chatsInlineItems } from '@/components/layout/sidebar-nav'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'
import { mergeHrefSearchParams } from '@/shared/workspaces/routing'
import { chatScopeForView } from './appSidebarNav'
import { buildScopedPanelNav } from './scopedPanelNav'
import type { PanelScope } from '@/shared/workspaces/panel-scope'

export interface SidebarRouter {
  push: (href: string) => void
}

/** The newest AI chat in the scope, so the Chats nav item reopens where the person left off. */
export async function resolveRecentChatHref(
  baseHref: string,
  scope: 'personal' | 'workspace',
  findRecent: (scope: 'personal' | 'workspace') => Promise<string | null>,
): Promise<string> {
  try {
    const recentId = await findRecent(scope)
    if (!recentId) return baseHref
    const view = scope === 'workspace' ? 'workspace-chats' : 'personal'
    return mergeHrefSearchParams(baseHref, new URLSearchParams({ view, id: recentId }))
  } catch {
    return baseHref
  }
}

const WORKSPACE_CHATS_ITEM = { id: 'workspace-chats', label: 'Chats', icon: MessageSquare }
const WORKSPACE_CHAT_IDS = new Set(['dms', 'channels'])

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
    onSelect: (next) => {
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
      const params = new URLSearchParams()

      params.set('view', next)
      if (next === 'dms' || next === 'channels') params.set('select', 'recent')
      router.push(mergeHrefSearchParams(baseHref, params))
    },
  }

  const chatScope = chatScopeForView(chatsView)
  const unreadOf = (id: string) => chatItems.find((item) => item.id === id)?.badgeCount ?? 0
  const workspaceChatItems = chatItems.filter((item) => WORKSPACE_CHAT_IDS.has(item.id) && !(solo && item.id === 'dms'))
  return buildScopedPanelNav({
    scope: chatScope,
    sub: chatScope === 'workspace' ? chatsView : null,
    // Workspace AI chats, direct messages, and channels have sub-rows; personal chats do not.
    subItems: { workspace: [...([WORKSPACE_CHATS_ITEM]), ...workspaceChatItems] },
    pendingId: effectivePendingSecondaryNavId,
    badges: { workspace: unreadOf('dms') + unreadOf('channels') },
    onSelect: (scope, sub) => flat.onSelect(sub ?? (scope !== 'workspace' ? scope : chatScope === 'workspace' ? chatsView : 'workspace-chats')),
  })
}
