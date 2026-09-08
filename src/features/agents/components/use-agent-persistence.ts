'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { workspaceAgentUsesByo } from '../lib/byo-agent-setup'
import type { AgentType } from './AgentEditorForm'

/**
 * Owns everything about persisting the agent editor so AgentEditorPage stays
 * under the complexity budget: debounced instant-save for edit mode (no save
 * button), explicit create for new mode, and the quiet Saved indicator.
 */
export function useAgentPersistence(args: {
  mode: 'new' | 'edit'
  showcase: boolean
  loading: boolean
  agent: WorkspaceAgentDirectoryItem | null
  activeWorkspaceId: string | null
  agentType: AgentType
  environmentId: string
  adapterId: string
  workingDirectory: string
  valid: boolean
  busy: boolean
  setBusy(next: boolean): void
  setError(next: string | null): void
  buildInput(): import('@overlay/workspace-contracts').WorkspaceAgentCreateInput
  afterCreate(saved: WorkspaceAgentDirectoryItem): void
  afterEdit(saved: WorkspaceAgentDirectoryItem): void
}) {
  const {
    mode, showcase, loading, agent, activeWorkspaceId, agentType,
    environmentId, adapterId, workingDirectory, valid, busy, setBusy, setError,
    buildInput, afterCreate, afterEdit,
  } = args
  const [savedFlash, setSavedFlash] = useState(false)
  const [dirtySince, setDirtySince] = useState<number | null>(null)

  // Edit mode instant-saves: every change marks the form dirty, and the
  // effect below persists it after a quiet period. There is no save button.
  const markDirty = useCallback(() => {
    if (mode !== 'edit' || showcase) return
    setSavedFlash(false)
    setDirtySince(Date.now())
  }, [mode, showcase])

  const persistEdit = useCallback(async () => {
    if (showcase || !activeWorkspaceId || !agent) return
    setBusy(true)
    setError(null)
    try {
      const saved = await overlayAppClient.agents.update(activeWorkspaceId, agent.id, buildInput())
      if (agentType === 'byo') {
        try {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } catch (bindingError) {
          afterEdit(saved.agent)
          throw bindingError
        }
      } else if (agent && workspaceAgentUsesByo(agent)) {
        // Switched a connected agent back to Overlay: drop its binding once.
        await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
          .catch(() => undefined)
      }
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      afterEdit(saved.agent)
      setDirtySince(null)
      setSavedFlash(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
    } finally {
      setBusy(false)
    }
  }, [showcase, activeWorkspaceId, agent, agentType, environmentId, adapterId,
    workingDirectory, buildInput, afterEdit, setBusy, setError])

  // New mode keeps one explicit step: a single in-flow Create button.
  const persistNew = useCallback(async () => {
    if (showcase || !activeWorkspaceId || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await overlayAppClient.agents.create(activeWorkspaceId, buildInput())
      if (agentType === 'byo') {
        try {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } catch (bindingError) {
          // Agent identity may already be durable even if its remote binding
          // fails. Land on the edit page so a retry never creates a duplicate.
          afterEdit(saved.agent)
          throw bindingError
        }
      }
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      afterCreate(saved.agent)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
    } finally {
      setBusy(false)
    }
  }, [showcase, activeWorkspaceId, busy, agentType, environmentId, adapterId,
    workingDirectory, buildInput, afterCreate, afterEdit, setBusy, setError])

  // Instant save: persist a quiet moment after the last edit. Skips while a
  // save is in flight (the completion re-runs this effect when still dirty)
  // and while the form is invalid.
  useEffect(() => {
    if (mode !== 'edit' || showcase || loading || !agent || dirtySince === null || busy) return
    if (!valid) return
    const timer = window.setTimeout(() => {
      void persistEdit()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [mode, showcase, loading, agent, dirtySince, busy, valid, persistEdit])

  return { savedFlash, markDirty, persistNew, resetSaveState }

  function resetSaveState() {
    setSavedFlash(false)
    setDirtySince(null)
  }
}

/**
 * Resets editor form fields whenever a different agent loads. Agent switches
 * clear the save indicator via onAgentSwitch; saves of the same agent leave
 * it alone. Kept out of the page component for the complexity budget.
 */
export function useAgentFormHydration(args: {
  agent: WorkspaceAgentDirectoryItem | null
  onHydrate(loaded: WorkspaceAgentDirectoryItem): void
  onAgentSwitch(): void
}) {
  const { agent, onHydrate, onAgentSwitch } = args
  const lastAgentId = useRef<string | null>(null)
  useEffect(() => {
    if (!agent) return
    if (lastAgentId.current !== agent.id) {
      lastAgentId.current = agent.id
      onAgentSwitch()
    }
    onHydrate(agent)
  }, [agent, onHydrate, onAgentSwitch])
}
