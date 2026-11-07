'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentReasoningLevel,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import {
  DEFAULT_AGENT_TOOL_GROUP_IDS,
  enabledAgentToolGroupIds,
} from '@/shared/agents/tool-groups'
import { workspaceAgentUsesByo, workspaceAgentUsesManagedHarness } from '../lib/byo-agent-setup'
import { dispatchAgentDraftPreview } from '@/shared/workspace/sidebar-events'
import { AVATAR_FALLBACK_COLOR } from '../lib/agent-editor-utils'
import type { getInitialEditorState } from '../lib/agent-editor-state'
import type { AgentType } from './AgentEditorForm'

export function useAgentEditorForm({
  initial,
  agent,

  activeWorkspaceId,
  setLegacyHostedRuntime,
  setAgentType,
}: {
  initial: ReturnType<typeof getInitialEditorState>
  agent: WorkspaceAgentDirectoryItem | null

  activeWorkspaceId: string | null
  setLegacyHostedRuntime: Dispatch<SetStateAction<boolean>>
  setAgentType: Dispatch<SetStateAction<AgentType>>
}) {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [instructions, setInstructions] = useState(initial.instructions)
  const [modelId, setModelId] = useState<string>(initial.modelId)
  const [reasoningByModel, setReasoningByModel] = useState<Record<string, WorkspaceAgentReasoningLevel>>(() =>
    initial.reasoning && initial.reasoning !== 'provider-default' ? { [initial.modelId]: initial.reasoning } : {},
  )
  const [avatarColor, setAvatarColor] = useState(initial.avatarColor)
  const [avatarShape, setAvatarShape] = useState<WorkspaceAgentCreatureShape>(initial.avatarShape)
  const [visibility, setVisibility] = useState<WorkspaceAgentVisibility>(initial.visibility)
  const [permissionMode, setPermissionMode] = useState<'ask' | 'auto'>(
    initial.permissionMode === 'auto' ? 'auto' : 'ask',
  )
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(() => new Set(DEFAULT_AGENT_TOOL_GROUP_IDS))
  const [advanced, setAdvanced] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [version, setVersion] = useState(0)
  const versionRef = useRef(0)

  const markDirty = useCallback(() => {
    versionRef.current += 1
    setVersion(versionRef.current)
    setDirty(true)
  }, [])
  const isVersionCurrent = useCallback((candidate: number) => versionRef.current === candidate, [])

  const toggleToolGroup = (groupId: string) => {
    markDirty()
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Load a different agent, or follow live changes to this one while the form has no
  // unsaved edits. Unsaved edits are never overwritten by someone else's change.
  const [loadedAgent, setLoadedAgent] = useState(agent)
  const [formLoads, setFormLoads] = useState(0)
  if (agent !== loadedAgent) {
    setLoadedAgent(agent)
    if (agent && (agent.id !== loadedAgent?.id || !dirty)) {
      setFormLoads((count) => count + 1)
      setName(agent.name)
      setDescription(agent.description ?? '')
      setInstructions(agent.instructions)
      setModelId(agent.modelId)
      setReasoningByModel(agent.reasoning && agent.reasoning !== 'provider-default'
        ? { [agent.modelId]: agent.reasoning }
        : {})
      setAvatarColor(agent.avatarColor ?? AVATAR_FALLBACK_COLOR)
      setAvatarShape(agent.avatarShape ?? 'circle')
      setVisibility(agent.visibility)
      setPermissionMode(agent.permissionMode === 'auto' ? 'auto' : 'ask')
      setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
      // The agent record marks a removed hosted runtime via `harness`.
      setLegacyHostedRuntime(workspaceAgentUsesManagedHarness(agent))
      setAgentType(workspaceAgentUsesByo(agent) ? 'byo' : 'overlay')
      setDirty(false)
      setVersion(0)
    }
  }
  useLayoutEffect(() => {
    versionRef.current = 0
  }, [formLoads])

  // Stream unsaved identity drafts so the sidebar roster and the conversation
  // header update while typing; a clean form or an unmounted editor clears the
  // override.
  useEffect(() => {
    if (!agent || !activeWorkspaceId) return
    dispatchAgentDraftPreview({
      workspaceId: activeWorkspaceId,
      agentId: agent.id,
      principalId: agent.principalId,
      patch: dirty
        ? { name: name.trim() || 'Untitled agent', description, avatarColor, avatarShape }
        : null,
    })
  }, [ agent, activeWorkspaceId, dirty, name, description, avatarColor, avatarShape])

  useEffect(() => {
    if (!agent || !activeWorkspaceId) return
    const { id: agentIdForCleanup, principalId } = agent
    const workspaceId = activeWorkspaceId
    return () => {
      dispatchAgentDraftPreview({ workspaceId, agentId: agentIdForCleanup, principalId, patch: null })
    }
  }, [agent, activeWorkspaceId])

  const onModelReasoningChange = useCallback((reasoningModelId: string, level: WorkspaceAgentReasoningLevel | undefined) => {
    markDirty()
    setReasoningByModel(current => ({
      ...current,
      [reasoningModelId]: level ?? 'provider-default',
    }))
  }, [markDirty])
  const setReasoning = useCallback((level: WorkspaceAgentReasoningLevel | undefined) => {
    onModelReasoningChange(modelId, level)
  }, [modelId, onModelReasoningChange])
  const reasoning = reasoningByModel[modelId] ?? (agent?.modelId === modelId ? agent.reasoning : undefined)

  return {
    name,
    setName,
    description,
    setDescription,
    instructions,
    setInstructions,
    modelId,
    setModelId,
    reasoningByModel,
    onModelReasoningChange,
    setReasoning,
    reasoning,
    avatarColor,
    setAvatarColor,
    avatarShape,
    setAvatarShape,
    visibility,
    setVisibility,
    permissionMode,
    setPermissionMode,
    enabledToolGroups,
    setEnabledToolGroups,
    advanced,
    setAdvanced,
    dirty,
    setDirty,
    markDirty,
    version,
    isVersionCurrent,
    toggleToolGroup,
  }
}
