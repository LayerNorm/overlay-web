'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { RightSidebar } from '@overlay/modules-react/shell'
import { AgentCreature } from '@/components/orb/Creature'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { AgentEditorPage } from './AgentEditorPage'
import { AgentComputerTabView } from './AgentComputerTab.parts'
import { AgentLibraryTab } from './AgentRightSidebar.parts'
import { useAgentSidebarComputer } from './use-agent-sidebar-computer'

export function AgentRightSidebar({
  agentId,
  activeWorkspaceId,
  conversationId,
  activeTab,
  onTabChange,
  onClose,
  onArchived,
  showcase = false,
  controlled,
  onTakeControl,
}: {
  agentId: string
  activeWorkspaceId: string | null
  conversationId: string
  activeTab: string
  onTabChange(id: string): void
  onClose(): void
  onArchived(): void
  showcase?: boolean
  controlled: boolean
  onTakeControl(ticketUrl: string, computerName: string, refreshTicket: () => void): void
}) {
  const { capabilities } = useOverlayCapabilities()
  const computersEnabled = capabilities.computers === true && !showcase
  const selectedTab = activeTab === 'computer' && !computersEnabled ? 'details' : activeTab
  const [agentState, setAgentState] = useState<{
    workspaceId: string | null
    agentId: string
    agent: WorkspaceAgentDirectoryItem | null
  }>({ workspaceId: null, agentId: '', agent: null })
  const computerAccess = useAgentSidebarComputer({
    activeWorkspaceId,
    agentId,
    enabled: computersEnabled,
    visible: selectedTab === 'computer',
  })

  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agents.list(activeWorkspaceId).then((result) => {
      if (!cancelled) {
        setAgentState({
          workspaceId: activeWorkspaceId,
          agentId,
          agent: result.agents.find((item) => item.id === agentId) ?? null,
        })
      }
    }).catch(() => {
      if (!cancelled) setAgentState({ workspaceId: activeWorkspaceId, agentId, agent: null })
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, agentId])

  const agent = agentState.workspaceId === activeWorkspaceId && agentState.agentId === agentId
    ? agentState.agent
    : null
  const agentName = agent?.name ?? 'Agent'
  const subtitle = agent?.description?.trim() || undefined
  const tabs = [
    {
      id: 'details',
      label: 'Details',
      content: selectedTab === 'details' ? (
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
      content: selectedTab === 'library' ? <AgentLibraryTab conversationId={conversationId} /> : null,
    },
    ...(computersEnabled ? [{
      id: 'computer',
      label: 'Computer',
      content: selectedTab === 'computer' ? (
        <AgentComputerTabView
          agentName={agentName}
          computer={computerAccess.computer}
          computerLoading={computerAccess.computerLoading}
          computerError={computerAccess.computerError}
          ticketUrl={computerAccess.ticketUrl}
          ticketError={computerAccess.ticketError}
          ticketLoading={computerAccess.ticketLoading}
          controlled={controlled}
          waking={computerAccess.waking}
          onWake={() => void computerAccess.wake()}
          onRetry={() => void (computerAccess.computerError
            ? computerAccess.loadComputer()
            : computerAccess.retryTicket())}
          onTakeControl={(ticketUrl, computerName) => {
            onTakeControl(ticketUrl, computerName, computerAccess.retryTicket)
          }}
        />
      ) : null,
    }] : []),
  ]

  return (
    <RightSidebar
      ariaLabel="Agent sidebar"
      hero={{
        avatar: <AgentCreature agent={{ name: agentName, avatarColor: agent?.avatarColor, avatarShape: agent?.avatarShape }} size={72} />,
        title: agentName,
        subtitle,
      }}
      tabs={tabs}
      activeTab={selectedTab}
      onTabChange={onTabChange}
    />
  )
}
