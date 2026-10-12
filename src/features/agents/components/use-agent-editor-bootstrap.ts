'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { getInitialEditorState } from '../lib/agent-editor-state'

export function useAgentEditorBootstrap({
  showcase,
  mode,
  agentId,
  activeWorkspaceId,
  initial,
}: {
  showcase: boolean
  mode: 'new' | 'edit'
  agentId: string | undefined
  activeWorkspaceId: string | null
  initial: ReturnType<typeof getInitialEditorState>
}) {
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(initial.agent)
  const [loading, setLoading] = useState(initial.loading)
  const [loadFailed, setLoadFailed] = useState(false)
  const [canCreate, setCanCreate] = useState(initial.canCreate)
  const [connectedAgentsEnabled, setConnectedAgentsEnabled] = useState(false)
  /** Whether the connected-agents check has answered; the settings wait for it so the agent-type choice does not pop in. */
  const [connectedAgentsChecked, setConnectedAgentsChecked] = useState(showcase)

  // Reset the load state when the load parameters change (before the effect
  // below kicks off the next fetch).
  const [loadParams, setLoadParams] = useState({ showcase, mode, agentId, activeWorkspaceId })
  if (
    loadParams.showcase !== showcase || loadParams.mode !== mode
    || loadParams.agentId !== agentId || loadParams.activeWorkspaceId !== activeWorkspaceId
  ) {
    setLoadParams({ showcase, mode, agentId, activeWorkspaceId })
    if (!showcase && activeWorkspaceId) {
      setLoading(true)
      setLoadFailed(false)
    }
  }

  // Load the agent (edit) or the create permission (new).
  useEffect(() => {
    if (showcase) return
    if (!activeWorkspaceId) return
    let cancelled = false
    if (mode === 'edit' && agentId) {
      void overlayAppClient.agents.get(activeWorkspaceId, agentId).then(
        (result) => { if (!cancelled) { setAgent(result.agent); setLoading(false) } },
        () => { if (!cancelled) { setAgent(null); setLoadFailed(true); setLoading(false) } },
      )
    } else {
      void overlayAppClient.agents.list(activeWorkspaceId).then(
        (result) => { if (!cancelled) { setCanCreate(result.canCreate); setLoading(false) } },
        () => { if (!cancelled) { setLoadFailed(true); setLoading(false) } },
      )
    }
    return () => { cancelled = true }
  }, [activeWorkspaceId, agentId, mode, showcase])

  // Connected-agent availability gates the BYO type.
  useEffect(() => {
    if (showcase || !activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId)
      .then(() => { if (!cancelled) { setConnectedAgentsEnabled(true); setConnectedAgentsChecked(true) } })
      .catch(() => { if (!cancelled) { setConnectedAgentsEnabled(false); setConnectedAgentsChecked(true) } })
    return () => { cancelled = true }
  }, [activeWorkspaceId, showcase])

  return { agent, setAgent, loading, loadFailed, canCreate, connectedAgentsEnabled, connectedAgentsChecked }
}
