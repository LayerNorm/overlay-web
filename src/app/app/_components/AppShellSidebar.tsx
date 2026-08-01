'use client'

import AppSidebar from '@/components/layout/AppSidebar'
import { AgentsInlinePanel, KnowledgeInlinePanel } from '@/components/layout/AppSidebarInlinePanels'
import { ChatInlinePanel } from '@/features/chat/components/ChatInlinePanel'
import { AutomationsInlinePanel } from '@/features/automations/components/AutomationsInlinePanel'
import { useSearchParams } from 'next/navigation'
import { SHOWCASE_CHAT_SUMMARIES } from '@/features/showcase/showcase-data'
import {
  PublicShowcaseAutomationsInlinePanel,
  PublicShowcaseAgentsInlinePanel,
  PublicShowcaseFilesInlinePanel,
  PublicShowcaseKnowledgeInlinePanel,
  PublicShowcaseProjectsInlinePanel,
} from '@/features/showcase/PublicShowcaseSidebarPanels'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import {
  buildWorkspaceHref,
  resolveWorkspaceSurface,
} from '@/features/workspaces/lib/workspace-routing'

export function AppShellSidebar() {
  const searchParams = useSearchParams()
  const publicShowcase = searchParams?.get('showcase') === '1'
  const { activeWorkspaceId } = useWorkspace()
  const chatBaseHref = activeWorkspaceId
    ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
    : '/app/chat'

  return (
    <AppSidebar
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
      renderChatPanel={({ refreshKey, onNavigate }) => (
        <ChatInlinePanel
          refreshKey={refreshKey}
          searchQuery=""
          onNavigate={onNavigate}
          baseHref={chatBaseHref}
          workspaceId={activeWorkspaceId}
          seededChats={publicShowcase ? SHOWCASE_CHAT_SUMMARIES : undefined}
        />
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
          ? <PublicShowcaseAgentsInlinePanel onNavigate={onNavigate} />
          : <AgentsInlinePanel
            workspaceId={activeWorkspaceId}
            baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/agents') : undefined}
            onNavigate={onNavigate}
          />
      )}
      renderKnowledgePanel={({ onNavigate }) => (
        publicShowcase
          ? <PublicShowcaseKnowledgeInlinePanel onNavigate={onNavigate} />
          : <KnowledgeInlinePanel
            baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/knowledge') : undefined}
            onNavigate={onNavigate}
          />
      )}
    />
  )
}
