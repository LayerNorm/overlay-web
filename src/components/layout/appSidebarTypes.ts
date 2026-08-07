import type { ReactNode } from 'react'

export interface AppSidebarNavigateContext {
  onNavigate: () => void
}

export interface AppSidebarChatPanelContext extends AppSidebarNavigateContext {
  refreshKey: number
}

export interface AppSidebarWorkspaceAdapter {
  activeWorkspaceId: string | null
  resolveSurface?: (path: string) => string | null
  buildHref?: (workspaceId: string, href: string) => string
}

export interface AppSidebarProps {
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
