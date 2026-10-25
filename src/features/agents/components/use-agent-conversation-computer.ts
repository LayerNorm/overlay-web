'use client'

import { useCallback, useState } from 'react'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { AgentRightSidebarPreferences } from '@/shared/agents/agent-right-sidebar-preferences'
import { useAgentEditorController } from './AgentEditorPage'
import { useAgentSidebarComputer } from './use-agent-sidebar-computer'

type ComputerControl = { ticketUrl: string; computerName: string; computerId: string }

export function useAgentConversationComputer({
  activeWorkspaceId, agentId, conversationId, sidebarPreferences, onClose, onArchived,
}: {
  activeWorkspaceId: string | null
  agentId: string | null
  conversationId: string | null
  sidebarPreferences: AgentRightSidebarPreferences
  onClose(): void
  onArchived(): void
}) {
  const { capabilities } = useOverlayCapabilities()
  const [controlState, setControlState] = useState<{
    conversationId: string | null
    control: ComputerControl | null
  }>({ conversationId: null, control: null })
  const sidebarEditor = useAgentEditorController({
    mode: 'edit', agentId: agentId ?? undefined, presentation: 'panel',
    keepOpenOnSave: true, onClose, onArchived,
  })
  const computerAccess = useAgentSidebarComputer({
    activeWorkspaceId,
    agentId: agentId ?? '',
    enabled: capabilities.computers === true && Boolean(agentId),
    visible: (sidebarPreferences.open && sidebarPreferences.tab === 'computer')
      || (controlState.conversationId === conversationId && Boolean(controlState.control)),
    currentUserId: sidebarEditor.computer.currentUserId,
    state: sidebarEditor.computer,
  })
  const computerControl = controlState.conversationId === conversationId
    && Boolean(computerAccess.currentUserId)
    && controlState.control?.computerId === computerAccess.computer?.id
    && computerAccess.computer?.controlledByUserId === computerAccess.currentUserId
    ? controlState.control : null
  const updateComputerControl = useCallback((control: ComputerControl | null) => {
    setControlState({ conversationId, control })
  }, [conversationId])
  return { sidebarEditor, computerAccess, computerControl, updateComputerControl }
}
