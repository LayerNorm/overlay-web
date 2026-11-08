'use client'

import { useState } from 'react'
import { useAgent, useAgentDirectory } from '@/hooks/use-agent-directory'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { useConnectedAgentLaunchEnabled } from '@/hooks/use-connections'
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
  // Connected-agent availability gates the BYO type; live, so a rollout change shows without reopening the editor.
  const launch = useConnectedAgentLaunchEnabled(activeWorkspaceId)
  const connectedAgentsEnabled = capabilities.externalAgents === true && launch === true
  /** Whether the connected-agents check has answered; the settings wait for it so the agent-type choice does not pop in. */
  const connectedAgentsChecked = launch !== undefined || !activeWorkspaceId

  return { agent, setAgent, loading, loadFailed, canCreate, connectedAgentsEnabled, connectedAgentsChecked }
}

function newerAgent(
  live: WorkspaceAgentDirectoryItem | null | undefined,
  saved: WorkspaceAgentDirectoryItem | null,
): WorkspaceAgentDirectoryItem | null {
  if (!live) return live === null ? null : saved
  return saved && saved.updatedAt > live.updatedAt ? saved : live
}
