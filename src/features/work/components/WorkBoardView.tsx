'use client'

import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Flag, Plus } from 'lucide-react'
import type { WorkItemDoc, WorkItemPriority, WorkItemStatus } from '@overlay/api-client'
import {
  WORK_ITEM_STATUSES,
  formatWorkItemDate,
  workItemInitials,
  workItemKey,
  workItemPriorityClass,
} from '@/shared/work/work-item-ui'
import { nextWorkItemOrderKey, workItemOrderKeyBetween } from '@/shared/work/work-items'

function byOrderKey(a: WorkItemDoc, b: WorkItemDoc): number {
  return a.orderKey.localeCompare(b.orderKey)
}

function memberLabel(members: Record<string, string>, userId: string | undefined): string {
  if (!userId) return ''
  return members[userId] ?? 'Member'
}

function BoardCard({
  item,
  members,
  onOpen,
}: {
  item: WorkItemDoc
  members: Record<string, string>
  onOpen: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item._id,
    data: { status: item.status },
  })
  const assignee = memberLabel(members, item.assigneeUserId)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(item._id)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`cursor-grab rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-2 transition-colors hover:border-[var(--muted-light)] ${
        isDragging ? 'z-10 opacity-70 shadow-lg' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-[var(--muted-light)]">{workItemKey(item)}</span>
        {item.priority !== 'none' ? (
          <Flag size={11} className={workItemPriorityClass(item.priority)} />
        ) : null}
      </div>
      <div className="text-[13px] leading-snug text-[var(--foreground)]">{item.title}</div>
      {(assignee || item.dueDate) ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {assignee ? (
            <span className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[8px] font-medium text-[var(--foreground)]" title={assignee}>
              {workItemInitials(assignee)}
            </span>
          ) : <span />}
          {item.dueDate ? (
            <span className="text-[10px] text-[var(--muted-light)]">{formatWorkItemDate(item.dueDate)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function BoardColumn({
  status,
  items,
  members,
  creating,
  onOpen,
  onCreate,
}: {
  status: WorkItemStatus
  items: WorkItemDoc[]
  members: Record<string, string>
  creating: boolean
  onOpen: (id: string) => void
  onCreate: (status: WorkItemStatus, title: string) => void
}) {
  const [draft, setDraft] = useState('')
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } })
  const label = WORK_ITEM_STATUSES.find((s) => s.id === status)?.label ?? status

  const submit = () => {
    const title = draft.trim()
    if (!title || creating) return
    setDraft('')
    onCreate(status, title)
  }

  return (
    <div className="flex w-64 shrink-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        <span className="text-[11px] text-[var(--muted-light)]">{items.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-1.5 px-2 pb-2 transition-colors ${isOver ? 'bg-[var(--surface-subtle)]' : ''}`}
      >
        <SortableContext items={items.map((item) => item._id)} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <BoardCard key={item._id} item={item} members={members} onOpen={onOpen} />
          ))}
        </SortableContext>
        <div className="mt-auto flex items-center gap-1.5 rounded-md px-1.5 py-1">
          <Plus size={12} className="shrink-0 text-[var(--muted-light)]" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
            onBlur={submit}
            placeholder="New"
            className="h-6 w-full bg-transparent text-xs outline-none placeholder:text-[var(--muted-light)]"
          />
        </div>
      </div>
    </div>
  )
}

/** Kanban board for work items: drag between columns changes status, dragging within a column reorders via orderKey. */
export function WorkBoardView({
  items,
  members,
  creating,
  onUpdate,
  onCreate,
  onOpen,
}: {
  items: WorkItemDoc[]
  members: Record<string, string>
  creating: boolean
  onUpdate: (itemId: string, patch: { status?: WorkItemStatus; priority?: WorkItemPriority; orderKey?: string }) => Promise<void> | void
  onCreate: (status: WorkItemStatus, title: string) => void
  onOpen: (id: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const columns = useMemo(() => {
    const byStatus = new Map<WorkItemStatus, WorkItemDoc[]>()
    for (const status of WORK_ITEM_STATUSES) byStatus.set(status.id, [])
    for (const item of items) {
      const list = byStatus.get(item.status) ?? byStatus.get('todo')!
      list.push(item)
    }
    for (const list of byStatus.values()) list.sort(byOrderKey)
    return byStatus
  }, [items])

  const onDragStart = (event: DragStartEvent) => setDraggingId(String(event.active.id))

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null)
    const itemId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId) return
    const item = items.find((entry) => entry._id === itemId)
    if (!item) return

    const overIsColumn = WORK_ITEM_STATUSES.some((s) => s.id === overId)
    const targetStatus: WorkItemStatus = overIsColumn
      ? (overId as WorkItemStatus)
      : (items.find((entry) => entry._id === overId)?.status ?? item.status)

    const targetItems = (columns.get(targetStatus) ?? []).filter((entry) => entry._id !== itemId)
    let insertIndex = targetItems.length
    if (!overIsColumn) {
      const overIndex = targetItems.findIndex((entry) => entry._id === overId)
      if (overIndex >= 0) insertIndex = overIndex
    } else if (draggingId && item.status === targetStatus) {
      // Dropped on the column itself: leave the order untouched for a same-column drop.
      return
    }

    const before = targetItems[insertIndex - 1]?.orderKey
    const after = targetItems[insertIndex]?.orderKey
    let orderKey: string
    try {
      orderKey = before === undefined && after === undefined
        ? nextWorkItemOrderKey([])
        : workItemOrderKeyBetween(before, after)
    } catch {
      orderKey = nextWorkItemOrderKey(targetItems.map((entry) => entry.orderKey))
    }

    const statusChanged = targetStatus !== item.status
    const orderChanged = orderKey !== item.orderKey
    if (!statusChanged && !orderChanged) return
    void onUpdate(itemId, {
      ...(statusChanged ? { status: targetStatus } : {}),
      orderKey,
    })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="flex flex-1 items-start gap-3 overflow-x-auto pb-2">
        {WORK_ITEM_STATUSES.map(({ id }) => (
          <BoardColumn
            key={id}
            status={id}
            items={columns.get(id) ?? []}
            members={members}
            creating={creating}
            onOpen={onOpen}
            onCreate={onCreate}
          />
        ))}
      </div>
    </DndContext>
  )
}
