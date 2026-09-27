'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import {
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
} from '@/shared/agents/tool-groups'
import { workspaceAgentUsesByo, workspaceAgentUsesManagedHarness } from '../lib/byo-agent-setup'
import { dispatchAgentDraftPreview } from '@/shared/workspace/sidebar-events'
import { AVATAR_COLORS } from '../lib/agent-editor-utils'
import type { getInitialEditorState } from '../lib/agent-editor-state'
import type { AgentType } from './AgentEditorForm'

export function useAgentEditorForm({
  initial,
  showcaseAgent,
  agent,
  showcase,
  activeWorkspaceId,
  setHostedRuntime,
  setAgentType,
  setModelAccess,
}: {
  initial: ReturnType<typeof getInitialEditorState>
  showcaseAgent: WorkspaceAgentDirectoryItem | null
  agent: WorkspaceAgentDirectoryItem | null
  showcase: boolean
  activeWorkspaceId: string | null
  setHostedRuntime: Dispatch<SetStateAction<string>>
  setAgentType: Dispatch<SetStateAction<AgentType>>
  setModelAccess: Dispatch<SetStateAction<string>>
}) {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [instructions, setInstructions] = useState(initial.instructions)
  const [modelId, setModelId] = useState<string>(initial.modelId)
  const [avatarColor, setAvatarColor] = useState(initial.avatarColor)
  const [avatarShape, setAvatarShape] = useState<WorkspaceAgentCreatureShape>(initial.avatarShape)
  const [visibility, setVisibility] = useState<WorkspaceAgentVisibility>(initial.visibility)
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(() => (showcaseAgent
    ? enabledAgentToolGroupIds(showcaseAgent.allowedToolIds)
    : new Set(DEFAULT_AGENT_TOOL_GROUP_IDS)))
  const [advanced, setAdvanced] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Explicit save model: every change marks the form dirty; nothing persists
  // until Save. Cancel discards back to the loaded agent and closes.
  const markDirty = useCallback(() => {
    setSavedFlash(false)
    setDirty(true)
  }, [])

  const toggleToolGroup = (groupId: string) => {
    markDirty()
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Reset the form whenever a different agent loads.
  const [loadedAgent, setLoadedAgent] = useState(agent)
  if (agent !== loadedAgent) {
    setLoadedAgent(agent)
    if (agent) {
      setName(agent.name)
      setDescription(agent.description ?? '')
      setInstructions(agent.instructions)
      setModelId(agent.modelId)
      setAvatarColor(agent.avatarColor ?? AVATAR_COLORS[0]!)
      setAvatarShape(agent.avatarShape ?? 'circle')
      setVisibility(agent.visibility)
      setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
      // The agent record marks a managed harness via `harness`; the binding load
      // (`onManagedBinding`) fills in the environment and picked model.
      setHostedRuntime(workspaceAgentUsesManagedHarness(agent) ? agent.harness : 'overlay')
      setAgentType(workspaceAgentUsesByo(agent) ? 'byo' : 'overlay')
      // `onManagedBinding` restores the saved access for managed agents.
      setModelAccess('overlay')
      setDirty(false)
      setSavedFlash(false)
    }
  }

  // Stream unsaved identity drafts so the sidebar roster and the conversation
  // header update while typing; a clean form or an unmounted editor clears the
  // override.
  useEffect(() => {
    if (showcase || !agent || !activeWorkspaceId) return
    dispatchAgentDraftPreview({
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      principalId: agent.principalId,
      patch: dirty
        ? { name: name.trim() || 'Untitled agent', description, avatarColor, avatarShape }
        : null,
    })
  }, [showcase, agent, activeWorkspaceId, dirty, name, description, avatarColor, avatarShape])

  useEffect(() => {
    if (!agent || !activeWorkspaceId) return
    const { id: agentIdForCleanup, principalId } = agent
    const workspaceId = activeWorkspaceId
    return () => {
      dispatchAgentDraftPreview({ workspaceId, agentId: agentIdForCleanup, principalId, patch: null })
    }
  }, [agent, activeWorkspaceId])

  return {
    name,
    setName,
    description,
    setDescription,
    instructions,
    setInstructions,
    modelId,
    setModelId,
    avatarColor,
    setAvatarColor,
    avatarShape,
    setAvatarShape,
    visibility,
    setVisibility,
    enabledToolGroups,
    setEnabledToolGroups,
    advanced,
    setAdvanced,
    savedFlash,
    setSavedFlash,
    dirty,
    setDirty,
    markDirty,
    toggleToolGroup,
  }
}
