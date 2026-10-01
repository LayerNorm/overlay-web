'use client'

import { useCallback, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { workspaceAgentUsesByo, workspaceAgentUsesManagedHarness } from '../lib/byo-agent-setup'
import type { AgentType } from './AgentEditorForm'

/**
 * Which kind of agent the editor is showing. Agents that ran on a hosted
 * runtime (Claude Code, Codex, … on Overlay Cloud) are `legacyHostedRuntime`:
 * those runtimes were removed, so such an agent is shown read-only.
 */
export function useAgentRuntime({
  showcaseAgent,
}: {
  showcaseAgent: WorkspaceAgentDirectoryItem | null
}) {
  const [agentType, setAgentType] = useState<AgentType>(() => (
    workspaceAgentUsesByo(showcaseAgent) ? 'byo' : 'overlay'
  ))
  const [legacyHostedRuntime, setLegacyHostedRuntime] = useState(() => (
    Boolean(showcaseAgent && workspaceAgentUsesManagedHarness(showcaseAgent))
  ))

  /** Called when the agent's loaded binding turns out to be a removed hosted runtime. */
  const onLegacyHostedBinding = useCallback(() => {
    setAgentType('overlay')
    setLegacyHostedRuntime(true)
  }, [])

  return { agentType, setAgentType, legacyHostedRuntime, setLegacyHostedRuntime, onLegacyHostedBinding }
}
