import { useEffect, useRef } from 'react'
import type {
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
} from '@overlay/workspace-contracts'
import { dispatchAgentIdentityPreview } from '@/shared/agents/agent-identity-preview'

export function useAgentIdentityPreview(args: {
  mode: 'new' | 'edit'
  showcase: boolean
  activeWorkspaceId: string | null
  agent: WorkspaceAgentDirectoryItem | null
  name: string
  avatarColor: string
  avatarShape: WorkspaceAgentCreatureShape
}): void {
  const {
    mode,
    showcase,
    activeWorkspaceId,
    agent,
    name,
    avatarColor,
    avatarShape,
  } = args
  const latestAgentRef = useRef(agent)
  const latestWorkspaceIdRef = useRef(activeWorkspaceId)
  const latestEditorModeRef = useRef({ mode, showcase })

  useEffect(() => {
    latestAgentRef.current = agent
    latestWorkspaceIdRef.current = activeWorkspaceId
    latestEditorModeRef.current = { mode, showcase }
  }, [activeWorkspaceId, agent, mode, showcase])

  useEffect(() => {
    if (mode !== 'edit' || showcase || !agent || !activeWorkspaceId) return
    dispatchAgentIdentityPreview({
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      principalId: agent.principalId,
      name: name.trim() || agent.name,
      avatarColor,
      avatarShape,
    })
  }, [activeWorkspaceId, agent, avatarColor, avatarShape, mode, name, showcase])

  useEffect(() => () => {
    const currentAgent = latestAgentRef.current
    const workspaceId = latestWorkspaceIdRef.current
    const { mode: currentMode, showcase: isShowcase } = latestEditorModeRef.current
    if (currentMode !== 'edit' || isShowcase || !currentAgent || !workspaceId) return
    dispatchAgentIdentityPreview({
      workspaceId,
      agentId: currentAgent.id,
      principalId: currentAgent.principalId,
      name: currentAgent.name,
      avatarColor: currentAgent.avatarColor,
      avatarShape: currentAgent.avatarShape,
    })
  }, [])
}
