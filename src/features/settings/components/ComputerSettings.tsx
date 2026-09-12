'use client'

import { useCallback, useEffect, useState } from 'react'
import { Monitor, Plus, RefreshCw, Square, Play, Trash2 } from 'lucide-react'
import type { Computer } from '@overlay/workspace-contracts'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function ComputerSettings() {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const [computers, setComputers] = useState<Computer[]>([])
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const [computerData, agentData] = await Promise.all([
        overlayAppClient.computers.list(activeWorkspaceId, { cache: 'no-store' }),
        overlayAppClient.agents.list(activeWorkspaceId, { cache: 'no-store' }),
      ])
      setComputers(computerData.computers)
      setAgentNames(Object.fromEntries(
        agentData.agents.map((agent) => [agent.id, agent.name]),
      ))
      setError(null)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Failed to load computers')
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
    setError(null)
    try {
      await overlayAppClient.computers.provision(activeWorkspaceId, {
        ownerType: 'user',
        ownerId: user.id,
      })
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not create the computer')
    } finally {
      setCreating(false)
    }
  }

  async function openDesktop(computerId: string) {
    if (!activeWorkspaceId) return
    setBusy(computerId)
    setError(null)
    try {
      const ticket = await overlayAppClient.computers.openDesktop(activeWorkspaceId, computerId)
      window.open(ticket.url, '_blank', 'noopener,noreferrer')
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not open the desktop')
    } finally {
      setBusy(null)
    }
  }

  async function setRunning(computer: Computer, running: boolean) {
    if (!activeWorkspaceId) return
    setBusy(computer.id)
    setError(null)
    try {
      if (running) {
        await overlayAppClient.computers.start(activeWorkspaceId, computer.id)
      } else {
        await overlayAppClient.computers.stop(activeWorkspaceId, computer.id)
      }
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : running ? 'Could not start the computer' : 'Could not stop the computer')
    } finally {
      setBusy(null)
    }
  }

  async function destroy(computer: Computer) {
    if (!activeWorkspaceId) return
    if (!window.confirm(`Delete ${ownerLabel(computer, agentNames)}? Its disk state is destroyed permanently.`)) return
    setBusy(computer.id)
    setError(null)
    try {
      await overlayAppClient.computers.destroy(activeWorkspaceId, computer.id)
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Could not delete the computer')
    } finally {
      setBusy(null)
    }
  }

  const hasPersonal = user ? computers.some(
    (computer) => computer.ownerType === 'user' && computer.ownerId === user.id,
  ) : false

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Computers</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Persistent cloud desktops for you and your agents. Open one to watch or drive the live screen; stopped computers keep their disk.</p>
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Workspace computers</h2>
          <div className="flex items-center gap-1">
            {!hasPersonal ? (
              <button
                type="button"
                disabled={creating || busy !== null}
                onClick={() => void provision()}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50"
              >
                <Plus size={13} /> New computer
              </button>
            ) : null}
            <button type="button" aria-label="Refresh computers" onClick={() => void refresh()} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"><RefreshCw size={15} /></button>
          </div>
        </div>
        {computers.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">No computers yet. Create one to give yourself a persistent cloud desktop.</p> : null}
        {computers.map((computer) => (
          <div key={computer.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-xl bg-[var(--surface-subtle)] text-[var(--muted)]"><Monitor size={17} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-[var(--foreground)]">{computer.name ?? 'Computer'}</h3>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">{computer.status}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">
                  {ownerLabel(computer, agentNames)} · {computer.size}
                  {computer.lastActiveAt ? ` · ${lastActiveLabel(computer.lastActiveAt)}` : ''}
                </p>
                {computer.status === 'error' ? (
                  <p className="mt-1 text-xs text-red-500">Provisioning failed — delete this computer and create a new one.</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {computer.status === 'ready' || computer.status === 'stopped' ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void openDesktop(computer.id)}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50"
                  >
                    Open
                  </button>
                ) : null}
                {computer.status === 'ready' ? (
                  <button type="button" aria-label="Stop computer" disabled={busy !== null} onClick={() => void setRunning(computer, false)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:opacity-50"><Square size={15} /></button>
                ) : null}
                {computer.status === 'stopped' ? (
                  <button type="button" aria-label="Start computer" disabled={busy !== null} onClick={() => void setRunning(computer, true)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:opacity-50"><Play size={15} /></button>
                ) : null}
                <button type="button" aria-label="Delete computer" disabled={busy !== null} onClick={() => void destroy(computer)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"><Trash2 size={15} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ownerLabel(computer: Computer, agentNames: Record<string, string>): string {
  if (computer.ownerType === 'user') return 'Personal'
  return agentNames[computer.ownerId] ?? 'Agent'
}

function lastActiveLabel(lastActiveAt: number) {
  const elapsed = Math.max(0, Date.now() - lastActiveAt)
  if (elapsed < 60_000) return 'active just now'
  if (elapsed < 60 * 60_000) return `active ${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 24 * 60 * 60_000) return `active ${Math.floor(elapsed / (60 * 60_000))}h ago`
  return `active ${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`
}
