'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button, toast } from '@overlay/ui/primitives'

import { useCallback, useEffect, useState } from 'react'
import { Monitor, Plus, RefreshCw, Square, Play, Trash2 } from 'lucide-react'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type { Computer } from '@overlay/workspace-contracts'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

/**
 * An Overlay Cloud environment's sandbox is also its bound agent's machine —
 * listed here alongside computer rows so "Computers" is the single desktop
 * surface rather than a parallel primitive.
 */
type EnvironmentMachineRow = {
  environment: AgentEnvironmentResource
  /** Name of the agent bound to this environment, when one is. */
  agentName: string | null
}

export function ComputerSettings() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const [computers, setComputers] = useState<Computer[]>([])
  const [environmentMachines, setEnvironmentMachines] = useState<EnvironmentMachineRow[]>([])
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const [computerData, agentData, environmentData, bindingData] = await Promise.all([
        overlayAppClient.computers.list(activeWorkspaceId, { cache: 'no-store' }),
        overlayAppClient.agents.list(activeWorkspaceId, { cache: 'no-store' }),
        overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' })
          .catch(() => ({ environments: [] as AgentEnvironmentResource[] })),
        overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId, undefined, { cache: 'no-store' })
          .catch(() => ({ bindings: [] as Array<{ agentId: string; environmentId: string; enabled: boolean }> })),
      ])
      setComputers(computerData.computers)
      const names = Object.fromEntries(
        agentData.agents.map((agent) => [agent.id, agent.name]),
      )
      setAgentNames(names)
      const agentByEnvironment = new Map(
        bindingData.bindings
          .filter((binding) => binding.enabled)
          .map((binding) => [binding.environmentId, binding.agentId] as const),
      )
      setEnvironmentMachines(
        environmentData.environments
          .filter((environment) => environment.kind === 'overlay_cloud' && environment.status !== 'revoked')
          .map((environment) => {
            const agentId = agentByEnvironment.get(environment.id)
            return { environment, agentName: agentId ? names[agentId] ?? null : null }
          }),
      )
      setLoadError(null)
    } catch (value) {
      setLoadError(value instanceof Error ? value.message : 'Failed to load computers')
    }
  }, [activeWorkspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (computers.length === 0) return
    const refreshInterval = computers.some((computer) => computer.status === 'provisioning')
      ? 3_000
      : 15_000
    const timer = window.setInterval(() => void refresh(), refreshInterval)
    return () => window.clearInterval(timer)
  }, [computers, refresh])

  async function provision() {
    if (!activeWorkspaceId || !user) return
    setCreating(true)
    try {
      await overlayAppClient.computers.provision(activeWorkspaceId, {
        ownerType: 'user',
        ownerId: user.id,
      })
      await refresh()
      toast.success('Computer creation started.')
    } catch (value) {
      toast.error(value instanceof Error ? value.message : 'Could not create the computer')
    } finally {
      setCreating(false)
    }
  }

  async function openDesktop(computerId: string) {
    if (!activeWorkspaceId) return
    setBusy(computerId)
    try {
      const ticket = await overlayAppClient.computers.openDesktop(activeWorkspaceId, computerId)
      window.open(ticket.url, '_blank', 'noopener,noreferrer')
      await refresh()
    } catch (value) {
      toast.error(value instanceof Error ? value.message : 'Could not open the desktop')
    } finally {
      setBusy(null)
    }
  }

  async function controlComputer(computer: Computer) {
    if (!activeWorkspaceId) return
    const action = computer.controlledByUserId ? 'release' : 'take'
    setBusy(computer.id)
    try {
      await overlayAppClient.computers.control(activeWorkspaceId, computer.id, action)
      await refresh()
      toast.success(action === 'take' ? 'You have control of the computer.' : 'Control handed back to the agent.')
    } catch (value) {
      toast.error(value instanceof Error ? value.message : 'Could not change computer control.')
    } finally {
      setBusy(null)
    }
  }

  async function openEnvironmentDesktop(environmentId: string) {
    if (!activeWorkspaceId) return
    setBusy(environmentId)
    try {
      const ticket = await overlayAppClient.agentEnvironments.openDesktop(activeWorkspaceId, environmentId)
      window.open(ticket.url, '_blank', 'noopener,noreferrer')
    } catch (value) {
      toast.error(value instanceof Error ? value.message : 'Could not open the desktop')
    } finally {
      setBusy(null)
    }
  }

  async function setRunning(computer: Computer, running: boolean) {
    if (!activeWorkspaceId) return
    setBusy(computer.id)
    try {
      if (running) {
        await overlayAppClient.computers.start(activeWorkspaceId, computer.id)
      } else {
        await overlayAppClient.computers.stop(activeWorkspaceId, computer.id)
      }
      await refresh()
      toast.success(running ? 'Computer started.' : 'Computer stopped.')
    } catch (value) {
      toast.error(value instanceof Error ? value.message : running ? 'Could not start the computer' : 'Could not stop the computer')
    } finally {
      setBusy(null)
    }
  }

  async function destroy(computer: Computer) {
    if (!activeWorkspaceId) return
    if (!window.confirm(`Delete ${ownerLabel(computer, agentNames)}? Its disk state is destroyed permanently.`)) return
    setBusy(computer.id)
    try {
      await overlayAppClient.computers.destroy(activeWorkspaceId, computer.id)
      await refresh()
      toast.success('Computer deleted.')
    } catch (value) {
      toast.error(value instanceof Error ? value.message : 'Could not delete the computer')
    } finally {
      setBusy(null)
    }
  }

  const hasPersonal = user ? computers.some(
    (computer) => computer.ownerType === 'user' && computer.ownerId === user.id,
  ) : false

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
        <h2 className="text-sm font-semibold text-(--foreground)">Computers</h2>
        <p className="mt-1 text-sm text-(--muted)">Persistent cloud desktops for you and your agents. Open one to watch or drive the live screen; stopped computers keep their disk.</p>
      </div>

      {loadError ? <p role="alert" className="text-sm text-red-500">{loadError}</p> : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-(--foreground)">Workspace computers</h2>
          <div className="flex items-center gap-1">
            {!hasPersonal ? (
              <Button variant="secondary" size="sm"
                type="button"
                disabled={creating || busy !== null}
                onClick={() => void provision()}
              >
                <Plus size={13} /> New computer
              </Button>
            ) : null}
            <Button variant="ghost" type="button" aria-label="Refresh computers" onClick={() => void refresh()} className={unstyledButton(`rounded-lg p-2 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}><RefreshCw size={15} /></Button>
          </div>
        </div>
        {computers.length === 0 && environmentMachines.length === 0 ? <p className="rounded-xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted)">No computers yet. Create one to give yourself a persistent cloud desktop.</p> : null}
        {environmentMachines.map(({ environment, agentName }) => (
          <div key={environment.id} className="rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-xl bg-(--surface-subtle) text-(--muted)"><Monitor size={17} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-(--foreground)">{environment.name}</h3>
                  <span className="rounded-full border border-(--border) px-2 py-0.5 text-[10px] uppercase tracking-wide text-(--muted)">{environment.status}</span>
                  <span className="rounded-full border border-(--border) px-2 py-0.5 text-[10px] uppercase tracking-wide text-(--muted)">Agent machine</span>
                </div>
                <p className="mt-1 truncate text-xs text-(--muted)">
                  {agentName ?? 'Unbound agent environment'} · lifecycle managed by Overlay
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="secondary" size="sm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void openEnvironmentDesktop(environment.id)}
                >
                  Open
                </Button>
              </div>
            </div>
          </div>
        ))}
        {computers.map((computer) => (
          <ComputerSettingsCard
            key={computer.id}
            computer={computer}
            agentNames={agentNames}
            userId={user?.id}
            busy={busy !== null}
            controlBusy={busy === computer.id}
            onControl={() => void controlComputer(computer)}
            onOpenDesktop={() => void openDesktop(computer.id)}
            onSetRunning={(running) => void setRunning(computer, running)}
            onDelete={() => void destroy(computer)}
          />
        ))}
      </div>
    </div>
  )
}

export function ComputerSettingsCard({ computer, agentNames, userId, busy, controlBusy, onControl, onOpenDesktop, onSetRunning, onDelete }: {
  computer: Computer
  agentNames: Record<string, string>
  userId?: string
  busy: boolean
  controlBusy: boolean
  onControl(): void
  onOpenDesktop(): void
  onSetRunning(running: boolean): void
  onDelete(): void
}) {
  const controlStatus = computerControlStatus(computer, agentNames, userId)
  return (
    <div className="rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-xl bg-(--surface-subtle) text-(--muted)"><Monitor size={17} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-(--foreground)">{computer.name ?? 'Computer'}</h3>
            <span className="rounded-full border border-(--border) px-2 py-0.5 text-[10px] uppercase tracking-wide text-(--muted)">{computer.status}</span>
          </div>
          {controlStatus ? (
            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-(--muted)">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${controlStatus.color}`} />
              {controlStatus.text}
            </p>
          ) : (
            <p className="mt-1 truncate text-xs text-(--muted)">
              {ownerLabel(computer, agentNames)} · {computer.size}
              {computer.lastActiveAt ? ` · ${lastActiveLabel(computer.lastActiveAt)}` : ''}
            </p>
          )}
          {computer.status === 'error' ? (
            <p className="mt-1 text-xs text-red-500">Provisioning failed. Delete this computer and create a new one.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(computer.controlledByUserId || computer.status === 'ready') ? (
            <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={onControl}>
              {controlBusy ? (computer.controlledByUserId ? 'Handing back…' : 'Taking control…') : computer.controlledByUserId ? 'Hand back' : 'Take control'}
            </Button>
          ) : null}
          {computer.status === 'ready' || computer.status === 'stopped' ? (
            <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={onOpenDesktop}>Open</Button>
          ) : null}
          {computer.status === 'ready' ? (
            <Button variant="ghost" type="button" aria-label="Stop computer" disabled={busy} onClick={() => onSetRunning(false)} className={unstyledButton(`rounded-lg p-2 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:opacity-50`)}><Square size={15} /></Button>
          ) : null}
          {computer.status === 'stopped' ? (
            <Button variant="ghost" type="button" aria-label="Start computer" disabled={busy} onClick={() => onSetRunning(true)} className={unstyledButton(`rounded-lg p-2 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:opacity-50`)}><Play size={15} /></Button>
          ) : null}
          <Button variant="ghost" type="button" aria-label="Delete computer" disabled={busy} onClick={onDelete} className={unstyledButton(`rounded-lg p-2 text-(--muted) hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50`)}><Trash2 size={15} /></Button>
        </div>
      </div>
    </div>
  )
}

function ownerLabel(computer: Computer, agentNames: Record<string, string>): string {
  if (computer.ownerType === 'user') return 'Personal'
  return agentNames[computer.ownerId] ?? 'Agent'
}

function computerControlStatus(computer: Computer, agentNames: Record<string, string>, userId?: string) {
  if (computer.controlledByUserId) {
    if (computer.controlledByUserId === userId) {
      const agentName = computer.ownerType === 'agent' ? agentNames[computer.ownerId] ?? 'Agent' : null
      return {
        text: agentName ? `You have control. ${agentName} is paused.` : 'You have control.',
        color: 'bg-blue-500',
      }
    }
    return { text: 'Someone else has control', color: 'bg-blue-500' }
  }
  if (computer.ownerType === 'agent' && computer.lastActiveAt && Date.now() - computer.lastActiveAt < 120_000) {
    return { text: `${agentNames[computer.ownerId] ?? 'Agent'} is using it`, color: 'bg-green-500' }
  }
  return null
}

function lastActiveLabel(lastActiveAt: number) {
  const elapsed = Math.max(0, Date.now() - lastActiveAt)
  if (elapsed < 60_000) return 'active just now'
  if (elapsed < 60 * 60_000) return `active ${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 24 * 60 * 60_000) return `active ${Math.floor(elapsed / (60 * 60_000))}h ago`
  return `active ${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`
}
