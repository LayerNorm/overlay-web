'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

export type EditableAgent = WorkspaceAgentDirectoryItem & { revision?: string }

export function useAgentEditorForm({
  initial,
  agent,

  activeWorkspaceId,
  setLegacyHostedRuntime,
  setAgentType,
}: {
  initial: ReturnType<typeof getInitialEditorState>
  agent: EditableAgent | null

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
  const [conflict, setConflict] = useState(false)
  const [baseRevision, setBaseRevision] = useState(agent?.revision)
  const baseRevisionRef = useRef(agent?.revision)
  const staleRevisionsRef = useRef(new Set<string>())
  const acceptedSavedAgentRef = useRef<EditableAgent | null>(null)
  const currentAgentRef = useRef(agent)
  const [version, setVersion] = useState(0)
  const versionRef = useRef(0)

  const markDirty = useCallback(() => {
    versionRef.current += 1
    setVersion(versionRef.current)
    setDirty(true)
  }, [])
  const isVersionCurrent = useCallback((candidate: number) => versionRef.current === candidate, [])
  const isBaseRevisionCurrent = useCallback((candidate?: string) => baseRevisionRef.current === candidate, [])

  const toggleToolGroup = (groupId: string) => {
    markDirty()
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const resetFieldsFromAgent = useCallback((next: EditableAgent) => {
    setName(next.name)
    setDescription(next.description ?? '')
    setInstructions(next.instructions)
    setModelId(next.modelId)
    setReasoningByModel(next.reasoning && next.reasoning !== 'provider-default'
      ? { [next.modelId]: next.reasoning }
      : {})
    setAvatarColor(next.avatarColor ?? AVATAR_FALLBACK_COLOR)
    setAvatarShape(next.avatarShape ?? 'circle')
    setVisibility(next.visibility)
    setPermissionMode(next.permissionMode === 'auto' ? 'auto' : 'ask')
    setEnabledToolGroups(enabledAgentToolGroupIds(next.allowedToolIds))
    setLegacyHostedRuntime(workspaceAgentUsesManagedHarness(next))
    setAgentType(workspaceAgentUsesByo(next) ? 'byo' : 'overlay')
  }, [setAgentType, setLegacyHostedRuntime])

  // Remote profile updates may replace the object while an edit is in flight.
  useEffect(() => {
    currentAgentRef.current = agent
    if (!agent) return
    if (dirty) {
      if (
        agent.revision !== undefined
        && agent.revision !== baseRevisionRef.current
        && !staleRevisionsRef.current.has(agent.revision)
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Remote revisions must pause autosave without replacing the dirty draft.
        setConflict(true)
      }
      return
    }
    const acceptedSavedAgent = acceptedSavedAgentRef.current
    if (
      agent.revision !== undefined
      && agent.revision !== baseRevisionRef.current
      && staleRevisionsRef.current.has(agent.revision)
    ) return
    if (acceptedSavedAgent) {
      acceptedSavedAgentRef.current = null
    }
    resetFieldsFromAgent(agent)
    baseRevisionRef.current = agent.revision
    setBaseRevision(agent.revision)
    setConflict(false)
    setDirty(false)
    versionRef.current = 0
    setVersion(0)
  }, [agent, dirty, resetFieldsFromAgent])

  const acceptSavedAgent = useCallback((
    savedAgent: EditableAgent,
    capturedVersion: number,
    expectedRevision?: string,
  ) => {
    if (expectedRevision) {
      staleRevisionsRef.current.add(expectedRevision)
      if (staleRevisionsRef.current.size > 8) {
        staleRevisionsRef.current.delete(staleRevisionsRef.current.values().next().value as string)
      }
    }
    const latestRevision = currentAgentRef.current?.revision
    acceptedSavedAgentRef.current = savedAgent
    baseRevisionRef.current = savedAgent.revision
    setBaseRevision(savedAgent.revision)
    setConflict(
      latestRevision !== undefined
      && latestRevision !== savedAgent.revision
      && !staleRevisionsRef.current.has(latestRevision),
    )
    if (versionRef.current === capturedVersion) {
      resetFieldsFromAgent(savedAgent)
      setDirty(false)
    } else {
      setDirty(true)
    }
  }, [resetFieldsFromAgent])

  const discardChanges = useCallback((source: EditableAgent | null) => {
    acceptedSavedAgentRef.current = null
    if (source) {
      resetFieldsFromAgent(source)
      baseRevisionRef.current = source.revision
      staleRevisionsRef.current.clear()
      setBaseRevision(source.revision)
    } else {
      staleRevisionsRef.current.clear()
    }
    setConflict(false)
    setDirty(false)
    versionRef.current = 0
    setVersion(0)
  }, [resetFieldsFromAgent])

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
    conflict,
    setConflict,
    baseRevision,
    acceptSavedAgent,
    discardChanges,
    markDirty,
    version,
    isVersionCurrent,
    isBaseRevisionCurrent,
    toggleToolGroup,
  }
}
