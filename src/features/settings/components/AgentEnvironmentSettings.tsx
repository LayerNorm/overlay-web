'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Cloud, Copy, Laptop, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
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
  const [command, setCommand] = useState('')
  const [roots, setRoots] = useState<Record<string, string>>({})
  const [editingRoots, setEditingRoots] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
    if (!command || (environments.length > 0 && !environments.some((environment) => environment.status === 'pending' || environment.status === 'offline'))) return
    const timer = window.setInterval(() => void refresh(), 3_000)
    return () => window.clearInterval(timer)
  }, [command, environments, refresh])

  async function createEnrollment() {
    setBusy('create')
    setError(null)
    try {
      if (!activeWorkspaceId) throw new Error('Choose a workspace first')
      const data = await overlayAppClient.agentEnvironments.createEnrollment(activeWorkspaceId)
      setCommand(data.command)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Failed to create enrollment')
    } finally {
      setBusy(null)
    }
  }

  async function createManagedEnvironment() {
    setBusy('managed')
    setError(null)
    try {
      if (!activeWorkspaceId) throw new Error('Choose a workspace first')
      const data = await overlayAppClient.agentEnvironments.createManaged(activeWorkspaceId)
      setRoots((current) => ({ ...current, [data.environment.id]: data.setup.approvedRoot }))
      await refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Overlay Cloud provisioning failed')
    } finally {
      setBusy(null)
    }
  }

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
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Connect an environment</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Run Overlay agents on a computer, VPS, or sandbox through one outbound connection.</p>
          </div>
          <button type="button" disabled={!activeWorkspaceId || busy !== null} onClick={() => void createEnrollment()} className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:opacity-85 disabled:opacity-50">
            Create connection
          </button>
        </div>
        {command ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-2">
            <code className="min-w-0 flex-1 overflow-x-auto px-1 text-xs text-[var(--foreground)]">{command}</code>
            <button type="button" aria-label="Copy connection command" onClick={() => void navigator.clipboard.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="rounded-xl bg-[var(--surface-elevated)] p-2 text-[var(--muted)]"><Cloud size={17} /></div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Overlay Cloud</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">A managed environment for running connected agents without setting up your own machine.</p>
            </div>
          </div>
          <button type="button" disabled={!activeWorkspaceId || busy !== null} onClick={() => void createManagedEnvironment()} className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:opacity-85 disabled:opacity-50">
            {busy === 'managed' ? 'Creating…' : 'Create environment'}
          </button>
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Environments</h2>
          <button type="button" aria-label="Refresh environments" onClick={() => void refresh()} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"><RefreshCw size={15} /></button>
        </div>
        {environments.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">No environments connected yet.</p> : null}
        {environments.map((environment) => (
          <div key={environment.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-[var(--surface-elevated)] p-2 text-[var(--muted)]"><Laptop size={17} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-[var(--foreground)]">{environment.name}</h3>
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">{environment.status}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{environment.platform ?? environment.kind}{environment.hostVersion ? ` · host ${environment.hostVersion}` : ''}</p>
                {environment.status === 'pending' ? (
                  <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                    <div className="flex items-center gap-2 text-sm text-[var(--foreground)]"><ShieldCheck size={16} className="text-[var(--muted)]" /> Verify phrase: <strong>{environment.verificationPhrase ?? 'waiting'}</strong></div>
                    <label className="block text-xs text-[var(--muted)]">Approved project roots, one per line
                      <textarea value={roots[environment.id] ?? (environment.kind === 'overlay_cloud' ? '/workspace' : '')} onChange={(event) => setRoots((current) => ({ ...current, [environment.id]: event.target.value }))} placeholder={environment.kind === 'overlay_cloud' ? '/workspace' : '/Users/you/Projects'} className="mt-2 min-h-20 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--muted)]" />
                    </label>
                    <button type="button" disabled={busy !== null} onClick={() => void approve(environment.id)} className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:opacity-85 disabled:opacity-50">Approve environment</button>
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
                          <button type="button" disabled={busy !== null} onClick={() => void updateRoots(environment.id)} className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:opacity-85 disabled:opacity-50">Save roots</button>
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
                        }} className="shrink-0 rounded-full px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]">Change roots</button>
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
