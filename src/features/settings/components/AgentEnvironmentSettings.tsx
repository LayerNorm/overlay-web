'use client'

import { useCallback, useEffect, useState } from 'react'
import { Laptop, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

type Environment = {
  id: string
  name: string
  kind: string
  status: 'pending' | 'online' | 'offline' | 'revoked'
  hostVersion?: string
  platform?: string
  lastSeenAt?: number
  verificationPhrase?: string
  filesystemGrant?: { mode: 'selected_roots'; roots: string[] } | { mode: 'all_user_files' }
}

export function AgentEnvironmentSettings() {
  const { activeWorkspaceId } = useWorkspace()
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [roots, setRoots] = useState<Record<string, string>>({})
  const [editingRoots, setEditingRoots] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const data = await overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' })
      setEnvironments(data.environments as Environment[])
      setError(null)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Failed to load environments')
    }
  }, [activeWorkspaceId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (environments.length === 0) return
    const refreshInterval = environments.some((environment) => environment.status === 'pending')
      ? 3_000
      : 15_000
    const timer = window.setInterval(() => void refresh(), refreshInterval)
    return () => window.clearInterval(timer)
  }, [environments, refresh])

  async function approve(environmentId: string) {
    const environment = environments.find((candidate) => candidate.id === environmentId)
    const selectedRoots = parseRoots(roots[environmentId] ?? (environment?.kind === 'overlay_cloud' ? '/workspace' : ''))
    if (selectedRoots.length === 0) {
      setError('Enter at least one absolute project root')
      return
    }
    setBusy(environmentId)
    setError(null)
    try {
      if (!activeWorkspaceId) throw new Error('Choose a workspace first')
      await overlayAppClient.agentEnvironments.approve(
        activeWorkspaceId,
        environmentId,
        { mode: 'selected_roots', roots: selectedRoots },
      )
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Approval failed')
    } finally {
      setBusy(null)
    }
  }

  async function updateRoots(environmentId: string) {
    const selectedRoots = parseRoots(roots[environmentId] ?? '')
    if (selectedRoots.length === 0) {
      setError('Enter at least one absolute project root')
      return
    }
    setBusy(environmentId)
    setError(null)
    try {
      if (!activeWorkspaceId) throw new Error('Choose a workspace first')
      await overlayAppClient.agentEnvironments.updateRoots(
        activeWorkspaceId,
        environmentId,
        { mode: 'selected_roots', roots: selectedRoots },
      )
      setEditingRoots(null)
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Project root update failed')
    } finally {
      setBusy(null)
    }
  }

  async function revoke(environmentId: string) {
    setBusy(environmentId)
    setError(null)
    try {
      if (!activeWorkspaceId) throw new Error('Choose a workspace first')
      await overlayAppClient.agentEnvironments.revoke(activeWorkspaceId, environmentId)
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Revocation failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Environment access</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Create or connect an environment while setting up a Bring Your Own Agent. Manage its access, health, and revocation here.</p>
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Environments</h2>
          <button type="button" aria-label="Refresh environments" onClick={() => void refresh()} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"><RefreshCw size={15} /></button>
        </div>
        {environments.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">No environments connected yet.</p> : null}
        {environments.map((environment) => (
          <div key={environment.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-xl bg-[var(--surface-subtle)] text-[var(--muted)]"><Laptop size={17} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-[var(--foreground)]">{environment.name}</h3>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">{environment.status}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">
                  {environment.platform ?? environment.kind}{environment.hostVersion ? ` · host ${environment.hostVersion}` : ''}
                  {environment.lastSeenAt ? ` · ${lastSeenLabel(environment.lastSeenAt)}` : ''}
                </p>
                {environment.status === 'pending' ? (
                  <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                    <div className="flex items-center gap-2 text-sm text-[var(--foreground)]"><ShieldCheck size={16} className="text-[var(--muted)]" /> Verify phrase: <strong>{environment.verificationPhrase ?? 'waiting'}</strong></div>
                    <label className="block text-xs text-[var(--muted)]">Approved project roots, one per line
                      <textarea value={roots[environment.id] ?? (environment.kind === 'overlay_cloud' ? '/workspace' : '')} onChange={(event) => setRoots((current) => ({ ...current, [environment.id]: event.target.value }))} placeholder={environment.kind === 'overlay_cloud' ? '/workspace' : '/Users/you/Projects'} className="mt-2 min-h-20 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--muted)]" />
                    </label>
                    <button type="button" disabled={busy !== null} onClick={() => void approve(environment.id)} className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50">Approve environment</button>
                  </div>
                ) : null}
                {environment.status !== 'pending' && environment.status !== 'revoked' && environment.filesystemGrant ? (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    {editingRoots === environment.id ? (
                      <div className="space-y-2">
                        <label className="block text-xs text-[var(--muted)]">Approved project roots, one per line
                          <textarea value={roots[environment.id] ?? ''} onChange={(event) => setRoots((current) => ({ ...current, [environment.id]: event.target.value }))} className="mt-2 min-h-20 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--muted)]" />
                        </label>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy !== null} onClick={() => void updateRoots(environment.id)} className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-elevated)] disabled:opacity-50">Save roots</button>
                          <button type="button" disabled={busy !== null} onClick={() => setEditingRoots(null)} className="rounded-full px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 text-xs text-[var(--muted)]">
                          <p className="font-medium text-[var(--foreground)]">Filesystem access</p>
                          <p className="mt-1 truncate">{environment.filesystemGrant.mode === 'all_user_files' ? 'All user files' : environment.filesystemGrant.roots.join(', ')}</p>
                        </div>
                        <button type="button" onClick={() => {
                          setRoots((current) => ({ ...current, [environment.id]: environment.filesystemGrant?.mode === 'selected_roots' ? environment.filesystemGrant.roots.join('\n') : '' }))
                          setEditingRoots(environment.id)
                        }} className="shrink-0 rounded-full px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">Change roots</button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              {environment.status !== 'revoked' ? <button type="button" aria-label={`Revoke ${environment.name}`} disabled={busy !== null} onClick={() => void revoke(environment.id)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"><Trash2 size={15} /></button> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function parseRoots(value: string) {
  return value.split(/[,\n]/).map((root) => root.trim()).filter(Boolean)
}

function lastSeenLabel(lastSeenAt: number) {
  const elapsed = Math.max(0, Date.now() - lastSeenAt)
  if (elapsed < 60_000) return 'seen just now'
  if (elapsed < 60 * 60_000) return `seen ${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 24 * 60 * 60_000) return `seen ${Math.floor(elapsed / (60 * 60_000))}h ago`
  return `seen ${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`
}
