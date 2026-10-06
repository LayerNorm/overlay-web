'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { workspaceManagementClient } from '../lib/workspace-client'

/**
 * The first thing a new person does: name their workspace. It starts as "<First name>’s workspace"; this lets them keep
 * that or call it something else before the tour. Skipping keeps the default.
 */
export function NameWorkspaceStep({ onDone }: { onDone: () => void }) {
  const { activeWorkspace, refresh } = useWorkspace()
  const [name, setName] = useState(activeWorkspace?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!activeWorkspace) return null

  async function save() {
    const next = name.trim()
    if (!activeWorkspace || !next || next === activeWorkspace.name) {
      onDone()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await workspaceManagementClient.renameWorkspace(activeWorkspace.id, next)
      await refresh()
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the name. You can change it later in Settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-workspace-title"
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-2xl"
      >
        <h3 id="name-workspace-title" className="text-sm font-semibold text-[var(--foreground)]">Name your workspace</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Your chats, files, and agents live here, and you can invite people to it later. You can rename it any time in Settings.
        </p>
        <input
          aria-label="Workspace name"
          value={name}
          maxLength={80}
          disabled={busy}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to ask for this one thing
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void save() }}
          className="mt-4 w-full rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
        />
        {error ? <p role="alert" className="mt-2 text-xs text-red-500">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)]">
            Keep this name
          </button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] hover:opacity-80 disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
