'use client'

import { useState } from 'react'
import { Archive, RotateCcw, User, Users } from 'lucide-react'
import type { ScopedResourceKind } from '@overlay/app-core'
import { useScopeItemActions, type ScopedItem } from '@/hooks/use-scope-item-actions'
import type { ResourceKind, ResourceScope } from '@/shared/workspaces/resource-scope'
import { announceArchived, refreshAfterRestore } from '@/shared/app/archive-toast'

export type ScopeChange =
  | { action: 'move'; to: ResourceScope }
  | { action: 'archive' }
  | { action: 'restore' }

const ICON_BUTTON =
  'shrink-0 rounded p-1 text-[var(--muted-light)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:opacity-50'
const TEXT_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50'

/**
 * Move to Workspace/Personal, Archive, and Restore for one item. Only what the person may do is shown (the server
 * enforces the same rules), so it renders nothing when there is nothing to offer.
 *
 * `icons` is for hover rows; `buttons` is for dialogs and detail panes.
 */
export function ScopeItemActions({
  kind,
  resource,
  item,
  variant = 'icons',
  label,
  onChanged,
}: {
  kind: ResourceKind
  resource: ScopedResourceKind
  item: ScopedItem
  variant?: 'icons' | 'buttons'
  /** The item's name, for the "Archived" note; read from the item's `name` or `title` when omitted. */
  label?: string
  onChanged?: (change: ScopeChange) => void
}) {
  const actions = useScopeItemActions(kind, resource)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = actions.optionsFor(item)
  if (!options.moveTo && !options.canArchive && !options.canRestore) return null

  async function run(change: ScopeChange, request: Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await request
      onChanged?.(change)
      if (change.action === 'archive') {
        const named = item as ScopedItem & { name?: string; title?: string }
        announceArchived({
          name: label ?? named.name ?? named.title ?? 'Item',
          undo: async () => { await actions.restore(item._id) },
          onUndone: () => refreshAfterRestore(resource),
        })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const items: Array<{ key: string; label: string; icon: typeof Users; onClick: () => void }> = []
  if (options.moveTo) {
    const to = options.moveTo
    items.push({
      key: 'move',
      label: to === 'workspace' ? 'Move to Workspace' : 'Move to Personal',
      icon: to === 'workspace' ? Users : User,
      onClick: () => void run({ action: 'move', to }, actions.move(item._id, to)),
    })
  }
  if (options.canArchive) {
    items.push({ key: 'archive', label: 'Archive', icon: Archive, onClick: () => void run({ action: 'archive' }, actions.archive(item._id)) })
  }
  if (options.canRestore) {
    items.push({ key: 'restore', label: 'Restore', icon: RotateCcw, onClick: () => void run({ action: 'restore' }, actions.restore(item._id)) })
  }

  if (variant === 'buttons') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {items.map(({ key, label, icon: Icon, onClick }) => (
          <button key={key} type="button" disabled={busy} onClick={onClick} className={TEXT_BUTTON}>
            <Icon size={13} />
            {label}
          </button>
        ))}
        {error ? <span role="alert" className="text-xs text-red-500">{error}</span> : null}
      </div>
    )
  }
  return (
    <>
      {items.map(({ key, label, icon: Icon, onClick }) => (
        <button
          key={key}
          type="button"
          title={error ?? label}
          aria-label={label}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
          className={`${ICON_BUTTON}${error ? ' text-red-500' : ''}`}
        >
          <Icon size={12} />
        </button>
      ))}
    </>
  )
}
