'use client'

import { useEffect, useState } from 'react'
import { useAgent, useAgentDirectory } from '@/hooks/use-agent-directory'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { getInitialEditorState } from '../lib/agent-editor-state'

export function useAgentEditorBootstrap({

  mode,
  agentId,
  activeWorkspaceId,
  initial,
}: {

  mode: 'new' | 'edit'
  agentId: string | undefined
  activeWorkspaceId: string | null
  initial: ReturnType<typeof getInitialEditorState>
}) {
  const { capabilities } = useOverlayCapabilities()
  const live = useAgent(mode === 'edit' && activeWorkspaceId ? agentId ?? null : null)
  const directory = useAgentDirectory({ enabled: mode === 'new' })
  // A save answers before the live query does; prefer whichever copy is newer.
  const [saved, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(initial.agent)
  const agent = mode === 'edit'
    ? newerAgent(live, saved?.id === agentId ? saved : null)
    : saved
  const loading = mode === 'edit' ? live === undefined && !agent : directory.status === 'loading'
  const loadFailed = mode === 'edit' ? live === null && !agent : directory.status === 'unavailable'
  const canCreate = mode === 'edit' ? initial.canCreate : directory.canCreate
  const [connectedAgentsEnabled, setConnectedAgentsEnabled] = useState(false)
  /** Whether the connected-agents check has answered; the settings wait for it so the agent-type choice does not pop in. */
  const [connectedAgentsChecked, setConnectedAgentsChecked] = useState(false)

  // Connected-agent availability gates the BYO type.
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId)
      .then((result) => { if (!cancelled) {
        setConnectedAgentsEnabled(capabilities.externalAgents === true && result.launchEnabled === true)
        setConnectedAgentsChecked(true)
      } })
      .catch(() => { if (!cancelled) { setConnectedAgentsEnabled(false); setConnectedAgentsChecked(true) } })
    return () => { cancelled = true }
  }, [activeWorkspaceId, capabilities.externalAgents, ])

  return { agent, setAgent, loading, loadFailed, canCreate, connectedAgentsEnabled, connectedAgentsChecked }
}

function newerAgent(
  live: WorkspaceAgentDirectoryItem | null | undefined,
  saved: WorkspaceAgentDirectoryItem | null,
): WorkspaceAgentDirectoryItem | null {
  if (!live) return live === null ? null : saved
  return saved && saved.updatedAt > live.updatedAt ? saved : live
}
