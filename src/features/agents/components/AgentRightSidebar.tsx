'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { RightSidebar } from '@overlay/modules-react/shell'
import { AgentCreature } from '@/components/orb/Creature'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { AgentEditorPage } from './AgentEditorPage'
import { AgentLibraryTab } from './AgentRightSidebar.parts'

export function AgentRightSidebar({
  agentId,
  activeWorkspaceId,
  conversationId,
  activeTab,
  onTabChange,
  onClose,
  onArchived,
}: {
  agentId: string
  activeWorkspaceId: string | null
  conversationId: string
  activeTab: string
  onTabChange(id: string): void
  onClose(): void
  onArchived(): void
}) {
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId) {
      setAgent(null)
      return
    }
    let cancelled = false
    void overlayAppClient.agents.list(activeWorkspaceId).then((result) => {
      if (!cancelled) setAgent(result.agents.find((item) => item.id === agentId) ?? null)
    }).catch(() => {
      if (!cancelled) setAgent(null)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, agentId])

  const agentName = agent?.name ?? 'Agent'
  const subtitle = agent?.description?.trim() || undefined

  return (
    <RightSidebar
      ariaLabel="Agent sidebar"
      hero={{
        avatar: <AgentCreature agent={{ name: agentName, avatarColor: agent?.avatarColor, avatarShape: agent?.avatarShape }} size={72} />,
        title: agentName,
        subtitle,
      }}
      tabs={[
        {
          id: 'details',
          label: 'Details',
          content: activeTab === 'details' ? (
            <AgentEditorPage
              mode="edit"
              agentId={agentId}
              presentation="panel"
              embedded
              onClose={onClose}
              onArchived={onArchived}
            />
          ) : null,
        },
        {
          id: 'library',
          label: 'Library',
          content: activeTab === 'library' ? <AgentLibraryTab conversationId={conversationId} /> : null,
        },
      ]}
      activeTab={activeTab}
      onTabChange={onTabChange}
    />
  )
}
