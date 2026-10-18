'use client'

import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'

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
    return <h2 className="truncate text-sm font-semibold text-(--foreground)">{workspace.name}</h2>
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
      <Button variant="ghost"
        type="button"
        onClick={() => {
          setDraft(workspace.name)
          setEditing(true)
        }}
        title="Rename workspace"
        className={unstyledButton(`group -mx-1 inline-flex max-w-full items-center gap-1.5 rounded-sm px-1 text-left`)}
      >
        <h2 className="truncate text-sm font-semibold text-(--foreground)">{workspace.name}</h2>
        <Pencil size={11} className="shrink-0 text-(--muted-light) opacity-0 transition-opacity group-hover:opacity-100" />
      </Button>
    )
  }
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Workspace name"
          value={draft}
          maxLength={80}
          disabled={busy}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') setEditing(false)
          }}
          className={unstyledInput(`min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface-subtle) px-2 py-1 text-sm font-semibold text-(--foreground) outline-hidden`)}
        />
        <Button variant="ghost" type="button" aria-label="Save name" disabled={busy} onClick={() => void save()} className={unstyledButton(`rounded-sm p-1 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </Button>
        <Button variant="ghost" type="button" aria-label="Cancel" disabled={busy} onClick={() => setEditing(false)} className={unstyledButton(`rounded-sm p-1 text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)`)}>
          <X size={13} />
        </Button>
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  )
}
