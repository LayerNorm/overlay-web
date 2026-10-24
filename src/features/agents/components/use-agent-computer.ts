'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Computer, ComputerSize, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { COMPUTER_TOOL_IDS, enabledAgentToolGroupIds } from '@/shared/agents/tool-groups'
import { toast } from '@overlay/ui/primitives'
import { changeAgentComputerControl } from '../lib/agent-computer-control'
import type { AgentType } from './AgentEditorForm'

export function isCurrentAgentComputerRequest(
  currentScope: string | null,
  requestScope: string | null,
  currentGeneration: number,
  requestGeneration: number,
) {
  return currentScope === requestScope && currentGeneration === requestGeneration
}

export function useAgentComputer({
  showcase,
  computersAvailable,
  activeWorkspaceId,
  agent,
  agentType,
  enabledToolGroups,
  setEnabledToolGroups,
  markDirty,
}: {
  showcase: boolean
  computersAvailable: boolean
  activeWorkspaceId: string | null
  agent: WorkspaceAgentDirectoryItem | null
  agentType: AgentType
  enabledToolGroups: Set<string>
  setEnabledToolGroups: Dispatch<SetStateAction<Set<string>>>
  markDirty(): void
}) {
  const [agentComputer, setAgentComputerState] = useState<Computer | null>(null)
  const { user } = useAuth()
  const [computerSize, setComputerSize] = useState<ComputerSize>('default')
  const [computerLoadError, setComputerLoadError] = useState<string | null>(null)
  const [computerProvisionFailure, setComputerProvisionFailure] = useState<{ agentId: string; message: string } | null>(null)
  const [computerOpenBusy, setComputerOpenBusy] = useState(false)
  const [computerLifecycleBusy, setComputerLifecycleBusy] = useState<'start' | 'stop' | 'delete' | 'control' | null>(null)
  const scopeKey = activeWorkspaceId && agent ? `${activeWorkspaceId}:${agent.id}` : null
  const scopeRef = useRef(scopeKey)
  const generationRef = useRef(0)
  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey
    generationRef.current += 1
  }
  const inventoryPausedRef = useRef(false)
  // Which workspace/agent computer has been read once (derived, so the first render already knows it is loading).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const initialLoading = Boolean(
    !showcase && computersAvailable && activeWorkspaceId && agent && agentType === 'overlay' && loadedFor !== scopeKey,
  )
  const currentAgentComputer = agentComputer?.workspaceId === activeWorkspaceId
    && agentComputer.ownerType === 'agent' && agentComputer.ownerId === agent?.id ? agentComputer : null

  // Load this agent's computer (edit mode, Overlay agents, capability on).
  // A bound machine implies the Computer tool group: force it on so the merged
  // toggle never shows "off" above a live machine.
  useEffect(() => {
    if (showcase || !computersAvailable || !activeWorkspaceId || !agent || agentType !== 'overlay'
      || loadedFor === scopeKey || inventoryPausedRef.current) return
    let cancelled = false
    const requestScope = scopeKey
    const requestGeneration = generationRef.current
    setComputerLoadError(null)
    void overlayAppClient.computers.list(activeWorkspaceId).then(
      (result) => {
        if (cancelled || !isCurrentAgentComputerRequest(scopeRef.current, requestScope, generationRef.current, requestGeneration)) return
        setLoadedFor(requestScope)
        setComputerLoadError(null)
        const existing = result.computers.find(
          (computer) => computer.ownerType === 'agent' && computer.ownerId === agent.id,
        ) ?? null
        setAgentComputerState(existing)
        if (existing) {
          setComputerSize(existing.size)
          if (!enabledAgentToolGroupIds(agent.allowedToolIds).has('computer')) {
            setEnabledToolGroups((current) => new Set(current).add('computer'))
            markDirty()
          }
        }
      },
      (error: unknown) => {
        if (cancelled || !isCurrentAgentComputerRequest(scopeRef.current, requestScope, generationRef.current, requestGeneration)) return
        setComputerLoadError(error instanceof Error ? error.message : 'Could not load the computer.')
        setLoadedFor(requestScope)
      },
    )
    return () => { cancelled = true }
  }, [showcase, computersAvailable, activeWorkspaceId, agent, agentType, loadedFor, scopeKey, markDirty, setEnabledToolGroups])

  useEffect(() => {
    setAgentComputerState(null)
    setLoadedFor(null)
    setComputerLoadError(null)
  }, [scopeKey])

  const setAgentComputer = useCallback((next: Computer | null) => {
    if (scopeRef.current !== scopeKey) return
    if (next && (next.workspaceId !== activeWorkspaceId || next.ownerType !== 'agent' || next.ownerId !== agent?.id)) return
    setAgentComputerState(next)
  }, [activeWorkspaceId, agent?.id, scopeKey])

  const retryComputerLoad = useCallback(() => {
    generationRef.current += 1
    setComputerLoadError(null)
    setLoadedFor(null)
  }, [])
  const computerProvisionError = computerProvisionFailure?.agentId === agent?.id
    ? computerProvisionFailure?.message ?? null
    : null
  const setComputerProvisionError = (message: string | null, agentId = agent?.id) => {
    if (!message) {
      setComputerProvisionFailure(null)
      return
    }
    if (agentId) setComputerProvisionFailure({ agentId, message })
  }

  const openAgentComputer = async () => {
    if (!activeWorkspaceId || !currentAgentComputer) return
    setComputerOpenBusy(true)
    try {
      const ticket = await overlayAppClient.computers.openDesktop(activeWorkspaceId, currentAgentComputer.id)
      window.open(ticket.url, '_blank', 'noopener,noreferrer')
    } catch (openError) {
      toast.error(openError instanceof Error ? openError.message : 'Could not open the desktop.')
    } finally {
      setComputerOpenBusy(false)
    }
  }

  const toggleAgentComputerPower = async () => {
    if (!activeWorkspaceId || !currentAgentComputer || computerLifecycleBusy) return
    const requestScope = scopeKey
    const requestGeneration = ++generationRef.current
    inventoryPausedRef.current = true
    const action = currentAgentComputer.status === 'ready' ? 'stop' : 'start'
    setComputerLifecycleBusy(action)
    try {
      const result = action === 'stop'
        ? await overlayAppClient.computers.stop(activeWorkspaceId, currentAgentComputer.id)
        : await overlayAppClient.computers.start(activeWorkspaceId, currentAgentComputer.id)
      if (isCurrentAgentComputerRequest(scopeRef.current, requestScope, generationRef.current, requestGeneration)) {
        setAgentComputerState(result.computer)
      }
      toast.success(action === 'stop' ? 'Computer stopped.' : 'Computer started.')
    } catch (powerError) {
      toast.error(powerError instanceof Error ? powerError.message : `Could not ${action} the computer.`)
    } finally {
      inventoryPausedRef.current = false
      setComputerLifecycleBusy(null)
    }
  }

  const deleteAgentComputer = async () => {
    if (!activeWorkspaceId || !currentAgentComputer || computerLifecycleBusy || !agent) return
    if (!window.confirm(`Delete ${currentAgentComputer.name ?? "this agent's computer"}? Its disk state is destroyed permanently.`)) return
    const requestScope = scopeKey
    const requestGeneration = ++generationRef.current
    inventoryPausedRef.current = true
    setComputerLifecycleBusy('delete')
    try {
      await overlayAppClient.computers.destroy(activeWorkspaceId, currentAgentComputer.id)
      // The machine is already gone, so persist the merged toggle off right
      // away — otherwise the saved grant would keep offering computer tools
      // the agent can no longer use. Strip computer ids from the *stored*
      // grant so the user's other unsaved edits stay unsaved.
      const nextGroups = new Set(enabledToolGroups)
      nextGroups.delete('computer')
      setEnabledToolGroups(nextGroups)
      await overlayAppClient.agents.update(activeWorkspaceId, agent.id, {
        allowedToolIds: agent.allowedToolIds.filter((id) => !(COMPUTER_TOOL_IDS as readonly string[]).includes(id)),
      })
      if (isCurrentAgentComputerRequest(scopeRef.current, requestScope, generationRef.current, requestGeneration)) setAgentComputerState(null)
      toast.success('Computer deleted.')
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete the computer.')
    } finally {
      inventoryPausedRef.current = false
      setComputerLifecycleBusy(null)
    }
  }

  const controlAgentComputer = async () => {
    if (!activeWorkspaceId || !currentAgentComputer || computerLifecycleBusy) return
    const action = currentAgentComputer.controlledByUserId ? 'release' : 'take'
    try {
      await updateAgentComputerControl(action)
      toast.success(action === 'take' ? 'You have control of the computer.' : 'Control handed back to the agent.')
    } catch (controlError) {
      toast.error(controlError instanceof Error ? controlError.message : 'Could not change computer control.')
    }
  }

  const updateAgentComputerControl = async (action: 'take' | 'release') => {
    if (!activeWorkspaceId || !currentAgentComputer || !user?.id || computerLifecycleBusy) {
      throw new Error('Could not change computer control.')
    }
    const requestScope = scopeKey
    const requestGeneration = ++generationRef.current
    inventoryPausedRef.current = true
    setComputerLifecycleBusy('control')
    try {
      const updated = await changeAgentComputerControl({
        computer: currentAgentComputer,
        userId: user.id,
        action,
        request: (workspaceId, computerId, nextAction) => overlayAppClient.computers.control(workspaceId, computerId, nextAction),
      })
      if (isCurrentAgentComputerRequest(scopeRef.current, requestScope, generationRef.current, requestGeneration)) {
        setAgentComputerState(updated)
      }
      return updated
    } finally {
      inventoryPausedRef.current = false
      setComputerLifecycleBusy(null)
    }
  }

  return {
    initialLoading,
    agentComputer: currentAgentComputer,
    currentUserId: user?.id,
    setAgentComputer,
    computerSize,
    setComputerSize,
    computerLoadError,
    computerProvisionError,
    setComputerProvisionError,
    retryComputerLoad,
    computerOpenBusy,
    computerLifecycleBusy,
    openAgentComputer,
    toggleAgentComputerPower,
    deleteAgentComputer,
    controlAgentComputer,
    updateAgentComputerControl,
  }
}
