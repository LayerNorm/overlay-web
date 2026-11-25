'use client'
import { Button, toast } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { useState } from 'react'
import { Archive, RotateCcw, Users } from 'lucide-react'
import type { ScopedResourceKind } from '@overlay/app-core'
import { useScopeItemActions, type ScopedItem } from '@/hooks/use-scope-item-actions'
import type { ResourceKind } from '@/shared/workspaces/resource-scope'
import { announceArchived } from '@/shared/app/archive-toast'
import { MoveToWorkspaceDialog } from './MoveToWorkspaceDialog'

export type ScopeChange =
  | { action: 'move'; to: 'workspace' }
  | { action: 'archive' }
  | { action: 'restore' }

const ICON_BUTTON =
  'shrink-0 rounded-sm p-1 transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) disabled:opacity-50'
const TEXT_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs text-(--foreground) transition-colors hover:bg-(--surface-subtle) disabled:opacity-50'

/**
 * Move to Workspace (one-way, after a confirmation), Archive, and Restore for one item. Only what the person may do is shown (the server
 * enforces the same rules), so it renders nothing when there is nothing to offer.
 *
 * `icons` is for hover rows; `header` is for side-panel headers; `buttons` is for dialogs and detail panes.
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
  variant?: 'icons' | 'header' | 'buttons'
  /** The item's name, for the "Archived" note; read from the item's `name` or `title` when omitted. */
  label?: string
  onChanged?: (change: ScopeChange) => void
}) {
  const actions = useScopeItemActions(kind, resource)
  const [busy, setBusy] = useState(false)
  const [confirmingMove, setConfirmingMove] = useState(false)
  const options = actions.optionsFor(item)
  if (!options.moveTo && !options.canArchive && !options.canRestore) return null

  async function run(change: ScopeChange, request: () => Promise<unknown>) {
    setBusy(true)
    try {
      await request()
      if (change.action === 'move') setConfirmingMove(false)
      onChanged?.(change)
      if (change.action === 'archive') {
        const named = item as ScopedItem & { name?: string; title?: string }
        announceArchived({
          name: label ?? named.name ?? named.title ?? 'Item',
          undo: async () => { await actions.restore(item._id) },
        })
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const items: Array<{ key: string; label: string; icon: typeof Users; onClick: () => void }> = []
  if (options.moveTo) {
    items.push({ key: 'move', label: 'Move to Workspace', icon: Users, onClick: () => setConfirmingMove(true) })
  }
  if (options.canArchive) {
    items.push({ key: 'archive', label: 'Archive', icon: Archive, onClick: () => void run({ action: 'archive' }, () => actions.archive(item._id)) })
  }
  if (options.canRestore) {
    items.push({ key: 'restore', label: 'Restore', icon: RotateCcw, onClick: () => void run({ action: 'restore' }, () => actions.restore(item._id)) })
  }

  const confirm = options.moveTo ? (
    <MoveToWorkspaceDialog
      open={confirmingMove}
      resource={resource}
      items={[item]}
      busy={busy}
      onCancel={() => setConfirmingMove(false)}
      onConfirm={({ withAgent }) => void run({ action: 'move', to: 'workspace' }, () => actions.move(item._id, { withAgent }))}
    />
  ) : null

  if (variant === 'buttons') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {items.map(({ key, label, icon: Icon, onClick }) => (
          <Button variant="ghost" key={key} type="button" disabled={busy} onClick={onClick} className={unstyledButton(TEXT_BUTTON)}>
            <Icon size={13} />
            {label}
          </Button>
        ))}
        {confirm}
      </div>
    )
  }
  if (variant === 'header') {
    return (
      <>
        {items.map(({ key, label, icon: Icon, onClick }) => (
          <Button key={key} variant="ghost" size="icon-sm" type="button" title={label} aria-label={label} disabled={busy} onClick={onClick} className="text-(--muted) hover:text-(--foreground)">
            <Icon size={16} aria-hidden />
          </Button>
        ))}
        {confirm}
      </>
    )
  }
  return (
    <>
      {items.map(({ key, label, icon: Icon, onClick }) => (
        <Button variant="ghost"
          key={key}
          type="button"
          title={label}
          aria-label={label}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
          className={unstyledButton(`${ICON_BUTTON} text-(--muted-light)`)}
        >
          <Icon size={12} />
        </Button>
      ))}
      {confirm}
    </>
  )
}
