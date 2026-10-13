'use client'
import { useState } from 'react'
import { ArrowUp, ArrowDown, GripVertical, Flag } from 'lucide-react'
import type { WorkItem, WorkStatus } from '@overlay/app-core/work'
import { WORK_STATUSES, WORK_STATUS_LABELS } from '@/shared/work/status'
import { groupWork } from '../lib/selection'
import { workPlacement } from '../lib/placement'
import { StatusPicker } from './StatusPicker'
export function WorkBoard({ items, allItems, pending, canEdit, onMove, onOpen }: { items: WorkItem[]; allItems: WorkItem[]; pending: ReadonlySet<string>; canEdit: (item: WorkItem) => boolean; onMove: (item: WorkItem, placement: ReturnType<typeof workPlacement>) => Promise<WorkItem>; onOpen: (item: WorkItem) => void }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [error, setError] = useState('')
  const groups = groupWork(items)
  const columnItems = (status: WorkStatus) => groups.find((group) => group.status === status)?.items ?? []
  async function move(item: WorkItem, status: WorkStatus, beforeId?: string) {
    if (!canEdit(item) || pending.has(item._id)) return
    setError('')
    try { await onMove(item, workPlacement(allItems, item, status, beforeId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not move task') }
  }
  function drop(event: React.DragEvent, status: WorkStatus, beforeId?: string) {
    event.preventDefault(); event.stopPropagation()
    const item = allItems.find((row) => row._id === event.dataTransfer.getData('text/overlay-work'))
    setDragging(null)
    if (item && item._id !== beforeId) void move(item, status, beforeId)
  }
  return <div className="px-6 pb-6">
    {error ? <p role="alert" className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    <div className="flex min-h-80 snap-x snap-mandatory gap-4 overflow-x-auto pb-3" aria-label="Work board">
      {WORK_STATUSES.map((status) => <section key={status} aria-label={WORK_STATUS_LABELS[status]} onDragOver={(e) => { if (dragging) e.preventDefault() }} onDrop={(e) => drop(e, status)} className={`w-64 shrink-0 snap-start rounded-lg bg-(--surface-subtle) p-2 ${dragging ? 'outline-1 outline-(--border)' : ''}`}>
        <h2 className="flex items-center justify-between px-2 py-3 text-xs font-medium text-(--muted)">{WORK_STATUS_LABELS[status]}<span>{columnItems(status).length}</span></h2>
        <div className="space-y-2">{columnItems(status).map((item) => {
          const column = allItems.filter((row) => row.status === status && row.scope === item.scope && (row.scope === 'workspace' || row.userId === item.userId)).sort((a, b) => a.rank.localeCompare(b.rank) || a._id.localeCompare(b._id))
          const index = column.findIndex((row) => row._id === item._id)
          const disabled = pending.has(item._id) || !canEdit(item)
          return <article key={item._id} aria-label={`Task ${item.title}`} draggable={!disabled} onDragStart={(e) => { e.dataTransfer.setData('text/overlay-work', item._id); e.dataTransfer.effectAllowed = 'move'; setDragging(item._id) }} onDragEnd={() => setDragging(null)} onDragOver={(e) => { if (dragging) e.preventDefault() }} onDrop={(e) => drop(e, status, item._id)} className={`rounded-md border border-(--border) bg-(--background) p-3 ${dragging === item._id ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-2"><GripVertical size={13} aria-hidden className="mt-0.5 shrink-0 text-(--muted-light)" /><button onClick={() => onOpen(item)} className="min-w-0 flex-1 break-words text-left text-sm">{item.title}</button>{item.priority === 1 ? <Flag size={12} className="text-(--muted)" aria-label="High priority" /> : null}</div>
            {item.blocked ? <p className="mt-2 text-xs text-(--muted)">Blocked</p> : null}
            <div className="mt-3 flex items-center gap-1"><StatusPicker label={`Move ${item.title} to status`} value={status} disabled={disabled} onChange={(next) => { void move(item, next) }} /><button disabled={disabled || index === 0} aria-label={`Move ${item.title} up`} onClick={() => { void move(item, status, column[index - 1]?._id) }} className="rounded p-1 text-(--muted) disabled:opacity-25"><ArrowUp size={13} /></button><button disabled={disabled || index === column.length - 1} aria-label={`Move ${item.title} down`} onClick={() => { void move(item, status, column[index + 2]?._id) }} className="rounded p-1 text-(--muted) disabled:opacity-25"><ArrowDown size={13} /></button></div>
          </article>
        })}</div>
        {!columnItems(status).length ? <p className="px-2 py-6 text-xs text-(--muted-light)">No tasks</p> : null}
      </section>)}
    </div>
  </div>
}
