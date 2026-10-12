'use client'

import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { WorkspaceManagementClient, WorkspaceSummary } from '@/shared/workspaces/types'

/**
 * A workspace's name in its settings header. Owners and admins can rename it in place; everyone else just reads it.
 */
export function WorkspaceNameEditor({
  workspace,
  client,
}: {
  workspace: Pick<WorkspaceSummary, 'id' | 'name' | 'role'>
  client: Pick<WorkspaceManagementClient, 'renameWorkspace'>
}) {
  const { refresh } = useWorkspace()
  const canRename = workspace.role === 'owner' || workspace.role === 'admin'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(workspace.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canRename) {
    return <h2 className="truncate text-sm font-semibold text-[var(--foreground)]">{workspace.name}</h2>
  }

  async function save() {
    const name = draft.trim()
    if (!name || name === workspace.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await client.renameWorkspace(workspace.id, name)
      await refresh()
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename the workspace.')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(workspace.name)
          setEditing(true)
        }}
        title="Rename workspace"
        className="group -mx-1 inline-flex max-w-full items-center gap-1.5 rounded px-1 text-left"
      >
        <h2 className="truncate text-sm font-semibold text-[var(--foreground)]">{workspace.name}</h2>
        <Pencil size={11} className="shrink-0 text-[var(--muted-light)] opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          aria-label="Workspace name"
          value={draft}
          maxLength={80}
          disabled={busy}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just asked to rename; focus belongs in the field
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1 text-sm font-semibold text-[var(--foreground)] outline-none"
        />
        <button type="button" aria-label="Save name" disabled={busy} onClick={() => void save()} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button type="button" aria-label="Cancel" disabled={busy} onClick={() => setEditing(false)} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
          <X size={13} />
        </button>
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
