'use client'

import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input, toast } from '@overlay/ui/primitives'
import { useConvexAuth, useMutation } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../../../convex/_generated/api'
import { useEffect, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import type { WorkspaceManagementClient, WorkspaceSummary } from '@/shared/workspaces/types'

type EditableWorkspace = Pick<WorkspaceSummary, 'id' | 'name' | 'role'> & { updatedAt?: number }

function updateDirectoryName(
  store: OptimisticLocalStore,
  args: { workspaceId: string; name: string; expectedUpdatedAt: number },
) {
  for (const query of store.getAllQueries(api.collaboration.nativeWorkspaces.listDirectory)) {
    if (query.value === undefined) continue
    const page = query.value.page.map(workspace => workspace.id === args.workspaceId
      ? {
          ...workspace,
          name: args.name,
        }
      : workspace)
    if (page.some((workspace, index) => workspace !== query.value!.page[index])) {
      store.setQuery(api.collaboration.nativeWorkspaces.listDirectory, query.args, {
        ...query.value,
        page,
      })
    }
  }
}

export function WorkspaceNameEditor({
  workspace,
  client,
}: {
  workspace: EditableWorkspace
  client: Pick<WorkspaceManagementClient, 'renameWorkspace'>
}) {
  const configuration = useConvexAuthConfiguration()
  if (!configuration.nativeAuthConfigured) {
    return <LegacyWorkspaceNameEditor workspace={workspace} client={client} />
  }
  if (!configuration.hasConvexClient) {
    return <h2 className="truncate text-sm font-semibold text-(--foreground)">{workspace.name}</h2>
  }
  return <NativeWorkspaceNameEditor key={workspace.id} workspace={workspace} />
}

function LegacyWorkspaceNameEditor({
  workspace,
  client,
}: {
  workspace: EditableWorkspace
  client: Pick<WorkspaceManagementClient, 'renameWorkspace'>
}) {
  const { refresh } = useWorkspace()
  const canRename = workspace.role === 'owner' || workspace.role === 'admin'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(workspace.name)
  const [busy, setBusy] = useState(false)

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
    try {
      await client.renameWorkspace(workspace.id, name)
      await refresh()
      setEditing(false)
      toast.success('Workspace renamed.')
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not rename the workspace.')
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
    </div>
  )
}

function NativeWorkspaceNameEditor({ workspace }: { workspace: EditableWorkspace }) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const renameMutation = useMutation(api.collaboration.nativeWorkspaces.rename)
    .withOptimisticUpdate(updateDirectoryName)
  const canRename = (workspace.role === 'owner' || workspace.role === 'admin')
    && !isLoading
    && isAuthenticated
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(workspace.name)
  const [editStart, setEditStart] = useState<{ name: string; updatedAt: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    if (!editing || !editStart) return
    if (busy && workspace.name === draft.trim()) return
    if (workspace.name !== editStart.name || workspace.updatedAt !== editStart.updatedAt) {
      setConflict(true)
    }
  }, [busy, draft, editStart, editing, workspace.name, workspace.updatedAt])

  if (!canRename) {
    return <h2 className="truncate text-sm font-semibold text-(--foreground)">{workspace.name}</h2>
  }

  async function save() {
    const name = draft.trim()
    if (!name || !editStart || name === editStart.name) {
      setEditing(false)
      setConflict(false)
      return
    }
    setBusy(true)
    try {
      await renameMutation({
        workspaceId: workspace.id,
        name,
        expectedUpdatedAt: editStart.updatedAt,
      })
      setEditing(false)
      setConflict(false)
      toast.success('Workspace renamed.')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not rename the workspace.'
      if (message.includes('WORKSPACE_REVISION_CONFLICT')) {
        setConflict(true)
      } else {
        toast.error(message)
      }
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
          setEditStart({ name: workspace.name, updatedAt: workspace.updatedAt ?? 0 })
          setConflict(false)
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
      {conflict ? (
        <p role="alert" className="mt-1 text-xs text-red-500">
          This workspace changed while you were editing. Your draft is preserved; cancel and reopen to review the latest name.
        </p>
      ) : null}
    </div>
  )
}
