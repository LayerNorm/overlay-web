'use client'

import AppSidebar from '@/components/layout/AppSidebar'
import { AgentsInlinePanel, KnowledgeInlinePanel } from '@/components/layout/AppSidebarInlinePanels'
import { ChatInlinePanel } from '@/features/chat/components/ChatInlinePanel'
import {
  ActivityInlinePanel,
  ArchivedInlinePanel,
} from '@/features/chat/components/ChatSubviewInlinePanels'
import { AutomationsInlinePanel } from '@/features/automations/components/AutomationsInlinePanel'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SHOWCASE_CHAT_SUMMARIES } from '@/features/showcase/showcase-data'
import {
  PublicShowcaseAutomationsInlinePanel,
  PublicShowcaseFilesInlinePanel,
  PublicShowcaseProjectsInlinePanel,
} from '@/features/showcase/PublicShowcaseSidebarPanels'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { CreateWorkspaceDialog } from '@/features/workspaces/components/CreateWorkspaceDialog'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import {
  buildWorkspaceHref,
  resolveWorkspaceSurface,
} from '@/features/workspaces/lib/workspace-routing'
import { useCollaborationRealtime } from '@/features/chat/components/collaboration/CollaborationRealtimeProvider'
import { OPEN_CREATE_WORKSPACE_EVENT } from '@/shared/workspaces/personal-workspace-boundary'

export function AppShellSidebar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const publicShowcase = searchParams?.get('showcase') === '1'
  const {
    activeWorkspace,
    activeWorkspaceId,
    createWorkspace,
    switchWorkspace,
  } = useWorkspace()
  const { notifications: collaborationNotifications } = useCollaborationRealtime()
  const [createForCollaborationOpen, setCreateForCollaborationOpen] = useState(false)
  const [createForCollaborationBusy, setCreateForCollaborationBusy] = useState(false)
  const [createForCollaborationError, setCreateForCollaborationError] = useState<string | null>(null)

  useEffect(() => {
    const open = () => {
      setCreateForCollaborationError(null)
      setCreateForCollaborationOpen(true)
    }
    window.addEventListener(OPEN_CREATE_WORKSPACE_EVENT, open)
    return () => window.removeEventListener(OPEN_CREATE_WORKSPACE_EVENT, open)
  }, [])

  async function createCollaborativeWorkspace(name: string) {
    setCreateForCollaborationBusy(true)
    setCreateForCollaborationError(null)
    try {
      const workspace = await createWorkspace({ name })
      await switchWorkspace(workspace.id)
      setCreateForCollaborationOpen(false)
      router.push(`${buildWorkspaceHref(workspace.id, '/app/settings')}?section=workspace`)
    } catch (error) {
      setCreateForCollaborationError(
        error instanceof Error ? error.message : 'Could not create the workspace.',
      )
    } finally {
      setCreateForCollaborationBusy(false)
    }
  }

  const chatBaseHref = activeWorkspaceId
    ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
    : '/app/chat'

  return (
    <>
      <AppSidebar
      collaborationNotifications={collaborationNotifications}
      publicShowcase={publicShowcase}
      workspace={{
        activeWorkspaceId,
        activeWorkspaceKind: activeWorkspace?.kind ?? null,
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
            collaborationEnabled={publicShowcase || activeWorkspace?.kind === 'organization'}
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
      {createForCollaborationOpen ? (
        <CreateWorkspaceDialog
          open
          busy={createForCollaborationBusy}
          error={createForCollaborationError}
          onOpenChange={(open) => {
            if (createForCollaborationBusy) return
            setCreateForCollaborationOpen(open)
            if (!open) setCreateForCollaborationError(null)
          }}
          onCreate={createCollaborativeWorkspace}
        />
      ) : null}
    </>
  )
}
