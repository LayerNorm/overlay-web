'use client'

import { useCallback, useState } from 'react'
import type { AgentType } from './AgentEditorForm'

/**
 * Which kind of agent the editor is showing. Agents that ran on a hosted
 * runtime (Claude Code, Codex, … on Overlay Cloud) are `legacyHostedRuntime`:
 * those runtimes were removed, so such an agent is shown read-only.
 */
export function useAgentRuntime() {
  const [agentType, setAgentType] = useState<AgentType>('overlay')
  const [legacyHostedRuntime, setLegacyHostedRuntime] = useState(false)

  const [cloudAgent, setCloudAgent] = useState(false)
  /** The agent's binding is an Overlay Cloud machine. */
  const onCloudBinding = useCallback(() => setCloudAgent(true), [])

  /** Called when the agent's loaded binding turns out to be a removed hosted runtime. */
  const onLegacyHostedBinding = useCallback(() => {
    setAgentType('overlay')
    setLegacyHostedRuntime(true)
  }, [])

  return { agentType, setAgentType, legacyHostedRuntime, setLegacyHostedRuntime, onLegacyHostedBinding, cloudAgent, onCloudBinding }
}
