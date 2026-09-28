'use client'

import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Computer, ComputerSize, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { COMPUTER_TOOL_IDS, enabledAgentToolGroupIds } from '@/shared/agents/tool-groups'
import type { AgentType } from './AgentEditorForm'

export function useAgentComputer({
  showcase,
  computersAvailable,
  activeWorkspaceId,
  agent,
  agentType,
  enabledToolGroups,
  setEnabledToolGroups,
  markDirty,
  setError,
}: {
  showcase: boolean
  computersAvailable: boolean
  activeWorkspaceId: string | null
  agent: WorkspaceAgentDirectoryItem | null
  agentType: AgentType
  enabledToolGroups: Set<string>
  setEnabledToolGroups: Dispatch<SetStateAction<Set<string>>>
  markDirty(): void
  setError: Dispatch<SetStateAction<string | null>>
}) {
  const [agentComputer, setAgentComputer] = useState<Computer | null>(null)
  const [computerSize, setComputerSize] = useState<ComputerSize>('default')
  const [computerOpenBusy, setComputerOpenBusy] = useState(false)
  const [computerLifecycleBusy, setComputerLifecycleBusy] = useState<'start' | 'stop' | 'delete' | null>(null)

  // Load this agent's computer (edit mode, Overlay agents, capability on).
  // A bound machine implies the Computer tool group: force it on so the merged
  // toggle never shows "off" above a live machine.
  useEffect(() => {
    if (showcase || !computersAvailable || !activeWorkspaceId || !agent || agentType !== 'overlay') return
    let cancelled = false
    void overlayAppClient.computers.list(activeWorkspaceId).then(
      (result) => {
        if (cancelled) return
        const existing = result.computers.find(
          (computer) => computer.ownerType === 'agent' && computer.ownerId === agent.id,
        ) ?? null
        setAgentComputer(existing)
        if (existing) {
          setComputerSize(existing.size)
          if (!enabledAgentToolGroupIds(agent.allowedToolIds).has('computer')) {
            setEnabledToolGroups((current) => new Set(current).add('computer'))
            markDirty()
          }
        }
      },
      () => undefined,
    )
    return () => { cancelled = true }
  }, [showcase, computersAvailable, activeWorkspaceId, agent, agentType, markDirty, setEnabledToolGroups])

  const openAgentComputer = async () => {
    if (!activeWorkspaceId || !agentComputer) return
    setComputerOpenBusy(true)
    setError(null)
    try {
      const ticket = await overlayAppClient.computers.openDesktop(activeWorkspaceId, agentComputer.id)
      window.open(ticket.url, '_blank', 'noopener,noreferrer')
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open the desktop.')
    } finally {
      setComputerOpenBusy(false)
    }
  }

  const toggleAgentComputerPower = async () => {
    if (!activeWorkspaceId || !agentComputer || computerLifecycleBusy) return
    const action = agentComputer.status === 'ready' ? 'stop' : 'start'
    setComputerLifecycleBusy(action)
    setError(null)
    try {
      const result = action === 'stop'
        ? await overlayAppClient.computers.stop(activeWorkspaceId, agentComputer.id)
        : await overlayAppClient.computers.start(activeWorkspaceId, agentComputer.id)
      setAgentComputer(result.computer)
    } catch (powerError) {
      setError(powerError instanceof Error ? powerError.message : `Could not ${action} the computer.`)
    } finally {
      setComputerLifecycleBusy(null)
    }
  }

  const deleteAgentComputer = async () => {
    if (!activeWorkspaceId || !agentComputer || computerLifecycleBusy || !agent) return
    if (!window.confirm(`Delete ${agentComputer.name ?? "this agent's computer"}? Its disk state is destroyed permanently.`)) return
    setComputerLifecycleBusy('delete')
    setError(null)
    try {
      await overlayAppClient.computers.destroy(activeWorkspaceId, agentComputer.id)
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
      setAgentComputer(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the computer.')
    } finally {
      setComputerLifecycleBusy(null)
    }
  }

  return {
    agentComputer,
    setAgentComputer,
    computerSize,
    setComputerSize,
    computerOpenBusy,
    computerLifecycleBusy,
    openAgentComputer,
    toggleAgentComputerPower,
    deleteAgentComputer,
  }
}
