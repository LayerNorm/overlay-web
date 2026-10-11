'use client'

import { useState } from 'react'
import { AlignLeft, Archive, ArchiveRestore, Loader2, Trash2, X } from 'lucide-react'
import type { WorkItemDoc } from '@overlay/api-client'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { workItemKey } from '@/shared/work/work-item-ui'
import { WorkItemFields } from './WorkItemFields'
import { WorkItemSubtasks } from './WorkItemSubtasks'
import { useWorkItemDrawer } from './useWorkItemDrawer'

const iconButtonClass = 'rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:opacity-50'

function deleteDescription(item: WorkItemDoc | null, subtasks: number): string {
  const what = item ? `“${item.title}”` : 'This task'
  const gone = subtasks === 0 ? '' : ` and its ${subtasks === 1 ? 'subtask' : `${subtasks} subtasks`}`
  return `${what}${gone} will be deleted and cannot be brought back. To keep it out of the way and restore it later, archive it instead.`
}

/**
 * Right-hand detail drawer for a single work item: editable fields,
 * description, subtasks, and archive/delete actions. Opened via `?item=`.
 */
export function WorkItemDrawer({
  itemId,
  headers,
  members,
  onClose,
  onChanged,
  onDeleted,
}: {
  itemId: string
  headers?: RequestInit
  members: Record<string, string>
  onClose: () => void
  /** Something about the item changed (the list refetches: archive and restore also change which list it is in). */
  onChanged: () => void
  onDeleted: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { item, children, missing, busy, error, patch, archiveOrRestore, addSubtask, remove } = useWorkItemDrawer({
    itemId, headers, onChanged, onDeleted,
  })
  const archived = Boolean(item?.archivedAt)
  const subtasks = children.filter((child) => !child.deletedAt)

  return (
    <div className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface-elevated)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <span className="font-mono text-[11px] text-[var(--muted)]">{item ? workItemKey(item) : ''}</span>
        <div className="flex items-center gap-1">
          {item ? (
            <button type="button" aria-label={archived ? 'Restore' : 'Archive'} title={archived ? 'Restore' : 'Archive'} disabled={busy}
              onClick={() => void archiveOrRestore(archived ? 'restore' : 'archive')} className={iconButtonClass}>
              {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </button>
          ) : null}
          <button type="button" aria-label="Delete" title="Delete" disabled={busy || !item}
            onClick={() => setConfirmingDelete(true)} className={`${iconButtonClass} hover:text-[var(--danger)]`}>
            <Trash2 size={14} />
          </button>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className={iconButtonClass}>
            <X size={14} />
          </button>
        </div>
      </div>

      {error ? <p role="alert" className="border-b border-[var(--border)] px-5 py-2 text-xs text-[var(--danger)]">{error}</p> : null}

      {item === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
          {missing ? 'That task is gone.' : <Loader2 size={16} className="animate-spin" />}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4">
            <input
              key={`title-${item.title}`}
              defaultValue={item.title}
              maxLength={200}
              onBlur={(event) => {
                const title = event.target.value.trim()
                if (title && title !== item.title) void patch({ title })
                else event.target.value = item.title
              }}
              disabled={archived || busy}
              className="w-full bg-transparent text-[15px] font-medium leading-snug outline-none disabled:opacity-70"
            />
          </div>

          <WorkItemFields item={item} members={members} disabled={busy || archived} onPatch={(body) => void patch(body)} />

          <div className="px-5 py-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--muted-light)]">
              <AlignLeft size={12} /> Description
            </div>
            <textarea
              key={`desc-${item.description ?? 'none'}`}
              defaultValue={item.description ?? ''}
              maxLength={20000}
              onBlur={(event) => {
                if (event.target.value !== (item.description ?? '')) void patch({ description: event.target.value })
              }}
              placeholder="Add a description"
              rows={5}
              disabled={archived || busy}
              className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-[var(--muted-light)] hover:border-[var(--border)] focus:border-[var(--border)] disabled:opacity-70"
            />
          </div>

          <WorkItemSubtasks subtasks={subtasks} canAdd={!archived && item.parentItemId === undefined} busy={busy} onAdd={addSubtask} />
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingDelete}
        title={item ? `Delete ${workItemKey(item)}?` : 'Delete this task?'}
        description={deleteDescription(item, subtasks.length)}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void remove().then(() => setConfirmingDelete(false))}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
}
