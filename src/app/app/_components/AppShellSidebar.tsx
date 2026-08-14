'use client'

import AppSidebar from '@/components/layout/AppSidebar'
import { AgentsInlinePanel, KnowledgeInlinePanel } from '@/components/layout/AppSidebarInlinePanels'
import { ChatInlinePanel } from '@/features/chat/components/ChatInlinePanel'
import {
  ActivityInlinePanel,
  ArchivedInlinePanel,
} from '@/features/chat/components/ChatSubviewInlinePanels'
import { AutomationsInlinePanel } from '@/features/automations/components/AutomationsInlinePanel'
import { useSearchParams } from 'next/navigation'
import { SHOWCASE_CHAT_SUMMARIES } from '@/features/showcase/showcase-data'
import {
  PublicShowcaseAutomationsInlinePanel,
  PublicShowcaseFilesInlinePanel,
  PublicShowcaseProjectsInlinePanel,
} from '@/features/showcase/PublicShowcaseSidebarPanels'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import {
  buildWorkspaceHref,
  resolveWorkspaceSurface,
} from '@/features/workspaces/lib/workspace-routing'
import { useCollaborationRealtime } from '@/features/chat/components/collaboration/CollaborationRealtimeProvider'

export function AppShellSidebar() {
  const searchParams = useSearchParams()
  const publicShowcase = searchParams?.get('showcase') === '1'
  const { activeWorkspaceId } = useWorkspace()
  const { notifications: collaborationNotifications } = useCollaborationRealtime()
  const chatBaseHref = activeWorkspaceId
    ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
    : '/app/chat'

  return (
    <AppSidebar
      collaborationNotifications={collaborationNotifications}
      publicShowcase={publicShowcase}
      workspace={{
        activeWorkspaceId,
        buildHref: buildWorkspaceHref,
        resolveSurface: resolveWorkspaceSurface,
        renderSwitcher: ({ compact, onNavigate, placement, userLabel, accountMenu }) => (
          <WorkspaceSwitcher
            compact={compact}
            showcase={publicShowcase}
            placement={placement}
            userLabel={userLabel}
            accountMenu={accountMenu}
            onNavigate={onNavigate}
          />
        ),
      }}
      renderChatPanel={({ refreshKey, onNavigate, view }) => (
        // Activity and Archived are their own routes with their own lists; only
        // the conversation subviews should render the chat list.
        view === 'activity' ? <ActivityInlinePanel onNavigate={onNavigate} />
        : view === 'archived' ? <ArchivedInlinePanel onNavigate={onNavigate} />
        : (
          <ChatInlinePanel
            refreshKey={refreshKey}
            searchQuery=""
            onNavigate={onNavigate}
            baseHref={chatBaseHref}
            workspaceId={activeWorkspaceId}
            seededChats={publicShowcase ? SHOWCASE_CHAT_SUMMARIES : undefined}
          />
        )
      )}
      renderAutomationsPanel={({ onNavigate }) => (
        publicShowcase
          ? <PublicShowcaseAutomationsInlinePanel onNavigate={onNavigate} />
          : <AutomationsInlinePanel onNavigate={onNavigate} />
      )}
      renderFilesPanel={publicShowcase
        ? ({ onNavigate }) => <PublicShowcaseFilesInlinePanel onNavigate={onNavigate} />
        : undefined}
      renderProjectsPanel={publicShowcase
        ? ({ onNavigate }) => <PublicShowcaseProjectsInlinePanel onNavigate={onNavigate} />
        : undefined}
      renderAgentsPanel={({ onNavigate }) => (
        publicShowcase
          ? undefined
          : (
            <AgentsInlinePanel
              workspaceId={activeWorkspaceId}
              baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/agents') : undefined}
              onNavigate={onNavigate}
            />
          )
      )}
      renderKnowledgePanel={({ onNavigate }) => (
        publicShowcase
          ? undefined
          : (
            <KnowledgeInlinePanel
              baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/knowledge') : undefined}
              onNavigate={onNavigate}
            />
          )
      )}
    />
  )
}
