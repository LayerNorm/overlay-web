import type { ReactNode } from 'react'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'
import type { WorkspaceKind } from '@overlay/workspace-contracts'

export interface AppSidebarNavigateContext {
  onNavigate: () => void
}

export interface AppSidebarChatPanelContext extends AppSidebarNavigateContext {
  refreshKey: number
  /**
   * Which Chats subview is selected. Activity and Archived are their own lists,
   * not the chat list — without this the panel rendered conversations no matter
   * which nav item was chosen.
   */
  view: string
}

export interface AppSidebarWorkspaceAdapter {
  activeWorkspaceId: string | null
  activeWorkspaceKind?: WorkspaceKind | null
  resolveSurface?: (path: string) => string | null
  buildHref?: (workspaceId: string, href: string) => string
  renderSwitcher?: (props: {
    compact: boolean
    onNavigate: () => void
    placement: 'footer' | 'header'
    userLabel: string
    accountMenu: React.ReactNode
  }) => React.ReactNode
}

export interface AppSidebarProps {
  collaborationNotifications?: WorkspaceNotification[]
  /** Public landing mode keeps the production shell but swaps repositories for static data. */
  publicShowcase?: boolean
  /** Injected from app shell — keeps chat feature UI out of shared layout code. */
  renderChatPanel?: (context: AppSidebarChatPanelContext) => ReactNode
  /** Injected from app shell — keeps automations feature UI out of shared layout code. */
  renderAutomationsPanel?: (context: AppSidebarNavigateContext) => ReactNode
  renderFilesPanel?: (context: AppSidebarNavigateContext) => ReactNode
  renderProjectsPanel?: (context: AppSidebarNavigateContext) => ReactNode
  renderAgentsPanel?: (context: AppSidebarNavigateContext) => ReactNode
  renderKnowledgePanel?: (context: AppSidebarNavigateContext) => ReactNode
  workspace?: AppSidebarWorkspaceAdapter
}
