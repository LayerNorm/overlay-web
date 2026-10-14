'use client'

import AppSidebar from '@/components/layout/AppSidebar'
import { AgentsInlinePanel } from '@/components/layout/AppSidebarAgentsPanel'
import { ChatInlinePanel } from '@/features/chat/components/ChatInlinePanel'
import {
  ActivityInlinePanel,
} from '@/features/chat/components/ChatSubviewInlinePanels'
import { AutomationsInlinePanel } from '@/features/automations/components/AutomationsInlinePanel'
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSavedPanelScope } from '@/hooks/use-panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { ARCHIVED_SETTINGS_PATH, isLegacyArchivedScope, resolvePanelScope } from '@/shared/workspaces/panel-scope'
import { SHOWCASE_CHAT_SUMMARIES } from '@/features/showcase/showcase-data'
import {
  PublicShowcaseAutomationsInlinePanel,
  PublicShowcaseFilesInlinePanel,
} from '@/features/showcase/PublicShowcaseSidebarPanels'
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import {
  buildWorkspaceHref,
  resolveWorkspaceSurface,
} from '@/shared/workspaces/routing'
import { useCollaborationRealtime } from '@/features/chat/components/collaboration/CollaborationRealtimeProvider'

export function AppShellSidebar({ publicShowcase: forcedPublicShowcase = false }: { publicShowcase?: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  // Archived used to be a scope (`?scope=archived`, or `?view=archived` on agents); old links and bookmarks now open
  // Settings → Archived, where everything archived lives.
  const legacyArchived = isLegacyArchivedScope(searchParams?.get('scope')) || isLegacyArchivedScope(searchParams?.get('view'))
  useEffect(() => {
    if (legacyArchived) router.replace(ARCHIVED_SETTINGS_PATH)
  }, [legacyArchived, router])
  const publicShowcase = forcedPublicShowcase || searchParams?.get('showcase') === '1'
  const { activeWorkspaceId } = useWorkspace()
  const { notifications: collaborationNotifications } = useCollaborationRealtime()
  const chatBaseHref = activeWorkspaceId
    ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
    : '/app/chat'
  // `?view=` is the pre-scope spelling of the agents tab.
  const agentsView = resolvePanelScope({
    param: searchParams?.get('scope') ?? searchParams?.get('view'),
    saved: useSavedPanelScope(),
    solo: useIsSoloWorkspace(),
  })

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
        // Activity is its own route with its own list; only the conversation subviews render the chat list.
        view === 'activity' ? <ActivityInlinePanel onNavigate={onNavigate} />
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
      renderAgentsPanel={({ onNavigate }) => (
        publicShowcase
          ? undefined
          : (
            <AgentsInlinePanel
              workspaceId={activeWorkspaceId}
              baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/agents') : undefined}
              view={agentsView}
              onNavigate={onNavigate}
            />
          )
      )}
    />
  )
}
