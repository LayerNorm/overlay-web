'use client'

import { AgentSurfacesSection } from './AgentEditorForm'
import type { useAgentSurfaces } from './use-agent-surfaces'

/** Binds the editor's surfaces hook to the "Reachable on" section. */
export function AgentSurfacesField({ agentName, hasAgent, surfaces }: {
  agentName: string
  hasAgent: boolean
  surfaces: ReturnType<typeof useAgentSurfaces>
}) {
  return (
    <AgentSurfacesSection
      agentName={agentName}
      hasAgent={hasAgent}
      loading={surfaces.loading}
      connections={surfaces.connections}
      bindings={surfaces.bindings}
      canBind={surfaces.canBind}
      canBindResolved={surfaces.enabled}
      channelPicker={surfaces.channelPicker}
      busyId={surfaces.busyBindingId}
      error={surfaces.error}
      notice={surfaces.notice}
      onConnectSlack={surfaces.connectSlack}
      onToggleChannelPicker={(connectionId) => {
        if (surfaces.channelPicker?.connectionId === connectionId) surfaces.closeChannelPicker()
        else void surfaces.openChannelPicker(connectionId)
      }}
      onSelectChannel={(connectionId, channel) => void surfaces.createBinding(connectionId, channel)}
      onRemoveBinding={(bindingId) => void surfaces.removeBinding(bindingId)}
    />
  )
}
