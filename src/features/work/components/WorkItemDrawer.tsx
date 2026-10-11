'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlignLeft, Archive, ArchiveRestore, Loader2, Plus, Trash2, X } from 'lucide-react'
import type { WorkItemDoc, WorkItemPriority, WorkItemStatus } from '@overlay/api-client'
import { ListboxSelect } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  workItemKey,
  workItemStatusDotClass,
} from '@/shared/work/work-item-ui'

const fieldLabelClass = 'w-24 shrink-0 text-xs text-[var(--muted-light)]'
const fieldRowClass = 'flex items-center gap-3 px-5 py-2'

function toDateInputValue(ts: number | undefined): string {
  if (!ts) return ''
  return new Date(ts).toISOString().slice(0, 10)
}

function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isNaN(parsed) ? undefined : parsed
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
  onChanged: (patch: Partial<WorkItemDoc>) => void
  onDeleted: () => void
}) {
  const [item, setItem] = useState<WorkItemDoc | null>(null)
  const [children, setChildren] = useState<WorkItemDoc[]>([])
  const [missing, setMissing] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setItem(null)
    setChildren([])
    setMissing(false)
    overlayAppClient.workItems
      .get(itemId, headers)
      .then((data) => {
        if (cancelled) return
        setItem(data.item)
        setChildren(data.children ?? [])
      })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [itemId, headers])

  const memberOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...Object.entries(members).map(([id, name]) => ({ value: id, label: name })),
    ],
    [members],
  )

  const patch = useCallback(async (body: Parameters<typeof overlayAppClient.workItems.update>[0]) => {
    setBusy(true)
    try {
      await overlayAppClient.workItems.update(body, headers)
      const { action, ...rest } = body
      setItem((prev) => (prev ? { ...prev, ...(rest as Partial<WorkItemDoc>) } : prev))
      onChanged(rest as Partial<WorkItemDoc>)
      if (action === 'archive' || action === 'restore') {
        overlayAppClient.workItems.get(itemId, headers).then((data) => setItem(data.item)).catch(() => {})
      }
    } finally {
      setBusy(false)
    }
  }, [headers, itemId, onChanged])

  const addSubtask = useCallback(async () => {
    const title = newSubtask.trim()
    if (!title || busy || !item) return
    setBusy(true)
    try {
      await overlayAppClient.workItems.create({ title, parentItemId: itemId }, headers)
      setNewSubtask('')
      const data = await overlayAppClient.workItems.get(itemId, headers)
      setChildren(data.children ?? [])
    } finally {
      setBusy(false)
    }
  }, [busy, headers, item, itemId, newSubtask])

  const remove = useCallback(async () => {
    setBusy(true)
    try {
      await overlayAppClient.workItems.deleteResponse({ itemId }, headers)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }, [headers, itemId, onDeleted])

  const archived = Boolean(item?.archivedAt)

  return (
    <div className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface-elevated)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <span className="font-mono text-[11px] text-[var(--muted)]">{item ? workItemKey(item) : ''}</span>
        <div className="flex items-center gap-1">
          {item && !archived ? (
            <button type="button" aria-label="Archive" title="Archive" disabled={busy}
              onClick={() => void patch({ itemId, action: 'archive' })}
              className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
              <Archive size={14} />
            </button>
          ) : null}
          {item && archived ? (
            <button type="button" aria-label="Restore" title="Restore" disabled={busy}
              onClick={() => void patch({ itemId, action: 'restore' })}
              className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
              <ArchiveRestore size={14} />
            </button>
          ) : null}
          <button type="button" aria-label="Delete" title="Delete" disabled={busy}
            onClick={() => void remove()}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--danger)]">
            <Trash2 size={14} />
          </button>
          <button type="button" aria-label="Close" title="Close" onClick={onClose}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]">
            <X size={14} />
          </button>
        </div>
      </div>

      {item === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
          {missing ? 'That task is gone.' : <Loader2 size={16} className="animate-spin" />}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4">
            <input
              value={item.title}
              onChange={(event) => setItem({ ...item, title: event.target.value })}
              onBlur={(event) => {
                const title = event.target.value.trim()
                if (title && title !== item.title) void patch({ itemId, title })
              }}
              disabled={archived || busy}
              className="w-full bg-transparent text-[15px] font-medium leading-snug outline-none disabled:opacity-70"
            />
          </div>

          <div className="border-y border-[var(--border)] py-1">
            <div className={fieldRowClass}>
              <span className={fieldLabelClass}>Status</span>
              <ListboxSelect
                aria-label="Status"
                value={item.status}
                options={WORK_ITEM_STATUSES.map((s) => ({ value: s.id, label: s.label }))}
                onChange={(status: WorkItemStatus) => void patch({ itemId, status })}
                disabled={busy}
                className="flex-1"
                buttonClassName="h-7 w-full justify-start border-0 px-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
                menuClassName="min-w-36"
              />
            </div>
            <div className={fieldRowClass}>
              <span className={fieldLabelClass}>Priority</span>
              <ListboxSelect
                aria-label="Priority"
                value={item.priority}
                options={WORK_ITEM_PRIORITIES.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(priority: WorkItemPriority) => void patch({ itemId, priority })}
                disabled={busy}
                className="flex-1"
                buttonClassName="h-7 w-full justify-start border-0 px-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
                menuClassName="min-w-36"
              />
            </div>
            <div className={fieldRowClass}>
              <span className={fieldLabelClass}>Assignee</span>
              <ListboxSelect
                aria-label="Assignee"
                value={item.assigneeUserId ?? ''}
                options={memberOptions}
                onChange={(assigneeUserId: string) =>
                  void patch(assigneeUserId ? { itemId, assigneeUserId } : { itemId, clearAssignee: true })}
                disabled={busy || memberOptions.length <= 1}
                className="flex-1"
                buttonClassName="h-7 w-full justify-start border-0 px-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
                menuClassName="min-w-36"
              />
            </div>
            <div className={fieldRowClass}>
              <span className={fieldLabelClass}>Start</span>
              <input
                type="date"
                value={toDateInputValue(item.startDate)}
                onChange={async (event) => {
                  const startDate = fromDateInputValue(event.target.value)
                  if (startDate !== undefined) return patch({ itemId, startDate })
                  // The API only clears both dates at once, so re-set the other afterwards.
                  await patch({ itemId, clearDates: true })
                  if (item.dueDate !== undefined) await patch({ itemId, dueDate: item.dueDate })
                }}
                disabled={busy}
                className="h-7 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none [color-scheme:dark]"
              />
            </div>
            <div className={fieldRowClass}>
              <span className={fieldLabelClass}>Due</span>
              <input
                type="date"
                value={toDateInputValue(item.dueDate)}
                onChange={async (event) => {
                  const dueDate = fromDateInputValue(event.target.value)
                  if (dueDate !== undefined) return patch({ itemId, dueDate })
                  await patch({ itemId, clearDates: true })
                  if (item.startDate !== undefined) await patch({ itemId, startDate: item.startDate })
                }}
                disabled={busy}
                className="h-7 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none [color-scheme:dark]"
              />
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--muted-light)]">
              <AlignLeft size={12} /> Description
            </div>
            <textarea
              value={item.description ?? ''}
              onChange={(event) => setItem({ ...item, description: event.target.value })}
              onBlur={(event) => {
                const description = event.target.value
                if (description !== (item.description ?? '')) void patch({ itemId, description })
              }}
              placeholder="Add a description"
              rows={5}
              disabled={archived || busy}
              className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-[var(--muted-light)] hover:border-[var(--border)] focus:border-[var(--border)] disabled:opacity-70"
            />
          </div>

          <div className="border-t border-[var(--border)] px-5 py-4">
            <div className="mb-2 text-xs text-[var(--muted-light)]">Subtasks</div>
            <div className="flex flex-col gap-0.5">
              {children.filter((child) => !child.deletedAt).map((child) => (
                <div key={child._id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-[var(--muted)]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${workItemStatusDotClass(child.status)}`} />
                  <span className="font-mono text-[10px] text-[var(--muted-light)]">{workItemKey(child)}</span>
                  <span className="truncate">{child.title}</span>
                </div>
              ))}
              {children.filter((child) => !child.deletedAt).length === 0 ? (
                <div className="px-1.5 py-1 text-xs text-[var(--muted-light)]">No subtasks</div>
              ) : null}
            </div>
            {!archived ? (
              <div className="mt-2 flex items-center gap-2">
                <Plus size={12} className="text-[var(--muted-light)]" />
                <input
                  value={newSubtask}
                  onChange={(event) => setNewSubtask(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void addSubtask() }}
                  placeholder="Add a subtask"
                  disabled={busy}
                  className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-light)] disabled:opacity-60"
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
