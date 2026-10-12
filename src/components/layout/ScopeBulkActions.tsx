'use client'

import { useState } from 'react'
import { Archive, RotateCcw, User, Users } from 'lucide-react'
import type { ScopedResourceKind } from '@overlay/app-core'
import { useScopeItemActions, type ScopedItem } from '@/hooks/use-scope-item-actions'
import type { ResourceKind, ResourceScope } from '@/shared/workspaces/resource-scope'
import { announceArchived, refreshAfterRestore } from '@/shared/app/archive-toast'

const BUTTON =
  'inline-flex h-8 min-h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-0 text-xs leading-none text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)] disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Move or archive several selected items at once. A button appears only when it would work for every selected item
 * (the same rules as one item: only their creator moves them, and so on); items that fail are reported, not hidden.
 */
export function ScopeBulkActions({
  kind,
  resource,
  items,
  onDone,
}: {
  kind: ResourceKind
  resource: ScopedResourceKind
  items: readonly ScopedItem[]
  /** Called after at least one item changed, with the ids that did and whether every selected item did. */
  onDone: (changedIds: string[], all: boolean) => void
}) {
  const actions = useScopeItemActions(kind, resource)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(0)
  if (items.length === 0) return null

  const options = items.map((item) => actions.optionsFor(item))
  const moveTo = options.every((option) => option.moveTo !== null && option.moveTo === options[0]!.moveTo) ? options[0]!.moveTo : null
  const canArchive = options.every((option) => option.canArchive)
  const canRestore = options.every((option) => option.canRestore)
  if (!moveTo && !canArchive && !canRestore) return null

  async function run(request: (id: string) => Promise<unknown>, archiving = false) {
    setBusy(true)
    setFailed(0)
    const results = await Promise.allSettled(items.map((item) => request(item._id)))
    const changedIds = items.filter((_, index) => results[index]!.status === 'fulfilled').map((item) => item._id)
    const failures = items.length - changedIds.length
    setFailed(failures)
    setBusy(false)
    if (changedIds.length > 0) onDone(changedIds, failures === 0)
    if (archiving && changedIds.length > 0) {
      announceArchived({
        name: changedIds.length === 1 ? (items.find((item) => item._id === changedIds[0]) as { name?: string; title?: string } | undefined)?.name ?? '1 item' : `${changedIds.length} items`,
        ...(changedIds.length > 1 ? { summary: `Archived ${changedIds.length} items` } : {}),
        undo: async () => { await Promise.all(changedIds.map((id) => actions.restore(id))) },
        onUndone: () => refreshAfterRestore(resource),
      })
    }
  }

  const count = items.length
  const move = (to: ResourceScope) => run((id) => actions.move(id, to))
  return (
    <>
      {moveTo ? (
        <button type="button" disabled={busy} onClick={() => void move(moveTo)} className={BUTTON}>
          {moveTo === 'workspace' ? <Users size={13} /> : <User size={13} />}
          {moveTo === 'workspace' ? 'Move to Workspace' : 'Move to Personal'} ({count})
        </button>
      ) : null}
      {canArchive ? (
        <button type="button" disabled={busy} onClick={() => void run(actions.archive, true)} className={BUTTON}>
          <Archive size={13} />
          Archive ({count})
        </button>
      ) : null}
      {canRestore ? (
        <button type="button" disabled={busy} onClick={() => void run(actions.restore)} className={BUTTON}>
          <RotateCcw size={13} />
          Restore ({count})
        </button>
      ) : null}
      {failed > 0 ? <span role="alert" className="text-xs text-red-500">{failed} could not be changed.</span> : null}
    </>
  )
}
