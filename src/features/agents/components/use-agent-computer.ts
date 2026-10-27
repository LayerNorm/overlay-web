'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Computer, ComputerSize, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { COMPUTER_TOOL_IDS, enabledAgentToolGroupIds } from '@/shared/agents/tool-groups'
import { toast } from '@overlay/ui/primitives'
import { changeAgentComputerControl } from '../lib/agent-computer-control'
import { AgentComputerCoordinator } from './agent-computer-coordinator'
import type { AgentType } from './AgentEditorForm'

export function useAgentComputer({

  computersAvailable,
  activeWorkspaceId,
  agent,
  agentType,
  enabledToolGroups,
  setEnabledToolGroups,
  markDirty,
}: {

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
  const coordinatorRef = useRef<AgentComputerCoordinator | null>(null)
  if (!coordinatorRef.current) coordinatorRef.current = new AgentComputerCoordinator()
  const coordinator = coordinatorRef.current
  coordinator.setScope(scopeKey)
  // Which workspace/agent computer has been read once (derived, so the first render already knows it is loading).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const initialLoading = Boolean(
    computersAvailable && activeWorkspaceId && agent && agentType === 'overlay' && loadedFor !== scopeKey,
  )
  const currentAgentComputer = agentComputer?.workspaceId === activeWorkspaceId
    && agentComputer.ownerType === 'agent' && agentComputer.ownerId === agent?.id ? agentComputer : null

  useEffect(() => {
    coordinator.setScope(scopeKey)
    setAgentComputerState(null)
    setLoadedFor(null)
    setComputerLoadError(null)
    setComputerLifecycleBusy(null)
    return () => coordinator.invalidate()
  }, [coordinator, scopeKey])

  // Load this agent's computer (edit mode, Overlay agents, capability on).
  // A bound machine implies the Computer tool group: force it on so the merged
  // toggle never shows "off" above a live machine.
  useEffect(() => {
    if (!computersAvailable || !activeWorkspaceId || !agent || agentType !== 'overlay') return
    const request = coordinator.beginRefresh()
    if (!request) return
    let cancelled = false
    setComputerLoadError(null)
    void overlayAppClient.computers.list(activeWorkspaceId).then(
      (result) => {
        if (cancelled || !coordinator.isCurrent(request)) return
        setLoadedFor(scopeKey)
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
        if (cancelled || !coordinator.isCurrent(request)) return
        setComputerLoadError(error instanceof Error ? error.message : 'Could not load the computer.')
        setLoadedFor(scopeKey)
      },
    )
    return () => { cancelled = true }
  }, [ computersAvailable, activeWorkspaceId, agent, agentType, coordinator, refreshRevision, scopeKey, markDirty, setEnabledToolGroups])

  const setAgentComputer = useCallback((next: Computer | null) => {
    if (next && (next.workspaceId !== activeWorkspaceId || next.ownerType !== 'agent' || next.ownerId !== agent?.id)) return
    if (!coordinator.acceptSnapshot(scopeKey)) return
    setAgentComputerState(next)
    setLoadedFor(scopeKey)
  }, [activeWorkspaceId, agent?.id, coordinator, scopeKey])

  const retryComputerLoad = useCallback(() => {
    const refresh = coordinator.beginRefresh()
    if (!refresh) return
    setComputerLoadError(null)
    setRefreshRevision(refresh.revision)
  }, [coordinator])
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

  const runMutation = async <T,>(kind: 'start' | 'stop' | 'control' | 'delete', work: () => Promise<T>, apply: (value: T) => void) => {
    return coordinator.mutate(kind, work, {
      start: () => setComputerLifecycleBusy(kind),
      apply: (result) => { apply(result); setComputerLoadError(null) },
      error: (error) => toast.error(error instanceof Error ? error.message : 'Computer request failed.'),
      finish: (queued) => {
        setComputerLifecycleBusy(null)
        if (queued) queueMicrotask(retryComputerLoad)
      },
    })
  }

  const startAgentComputer = async () => {
    if (!activeWorkspaceId || !currentAgentComputer) return null
    return runMutation('start', () => overlayAppClient.computers.start(activeWorkspaceId, currentAgentComputer.id),
      (result) => { setAgentComputerState(result.computer); toast.success('Computer started.') })
  }

  const toggleAgentComputerPower = async () => {
    if (!activeWorkspaceId || !currentAgentComputer) return
    if (currentAgentComputer.status !== 'ready') return startAgentComputer()
    return runMutation('stop', () => overlayAppClient.computers.stop(activeWorkspaceId, currentAgentComputer.id),
      (result) => { setAgentComputerState(result.computer); toast.success('Computer stopped.') })
  }

  const deleteAgentComputer = async () => {
    if (!activeWorkspaceId || !currentAgentComputer || computerLifecycleBusy || !agent) return
    if (!window.confirm(`Delete ${currentAgentComputer.name ?? "this agent's computer"}? Its disk state is destroyed permanently.`)) return
    await runMutation('delete', async () => {
      await overlayAppClient.computers.destroy(activeWorkspaceId, currentAgentComputer.id)
      // The machine is already gone, so persist the merged toggle off right
      // away — otherwise the saved grant would keep offering computer tools
      // the agent can no longer use. Strip computer ids from the *stored*
      // grant so the user's other unsaved edits stay unsaved.
      await overlayAppClient.agents.update(activeWorkspaceId, agent.id, {
        allowedToolIds: agent.allowedToolIds.filter((id) => !(COMPUTER_TOOL_IDS as readonly string[]).includes(id)),
      })
      return true
    }, () => {
      const nextGroups = new Set(enabledToolGroups)
      nextGroups.delete('computer')
      setEnabledToolGroups(nextGroups)
      setAgentComputerState(null)
      toast.success('Computer deleted.')
    })
  }

  const controlAgentComputer = async () => {
    if (!activeWorkspaceId || !currentAgentComputer) return
    const action = currentAgentComputer.controlledByUserId ? 'release' : 'take'
    try {
      const updated = await updateAgentComputerControl(action)
      if (updated) toast.success(action === 'take' ? 'You have control of the computer.' : 'Control handed back to the agent.')
    } catch (controlError) {
      toast.error(controlError instanceof Error ? controlError.message : 'Could not change computer control.')
    }
  }

  const updateAgentComputerControl = async (action: 'take' | 'release') => {
    if (!activeWorkspaceId || !currentAgentComputer || !user?.id) {
      return null
    }
    const updated = await runMutation('control', () => changeAgentComputerControl({
        computer: currentAgentComputer,
        userId: user.id,
        action,
        request: (workspaceId, computerId, nextAction) => overlayAppClient.computers.control(workspaceId, computerId, nextAction),
      }), setAgentComputerState)
    return updated
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
    startAgentComputer,
  }
}
