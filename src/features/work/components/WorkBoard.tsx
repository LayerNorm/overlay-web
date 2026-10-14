'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { WorkItem, WorkStatus } from '@overlay/app-core'
import { WORK_STATUS_LABELS } from '@/shared/work/status'
import { columnsByStatus } from '@/shared/work/query'
import { keyboardMove, neighborsForSlot, slotFromPointer } from '../lib/work-state'
import { useWorkData } from './WorkDataProvider'
import { StatusPicker } from './WorkPickers'
import { Avatar, DueLabel, StatusIcon, Tag } from './work-ui'

type DropTarget = { status: WorkStatus; slot: number }

function Card({
  item,
  today,
  selected,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onKeyMove,
}: {
  item: WorkItem
  today: string
  selected: boolean
  dragging: boolean
  onOpen: (id: string) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onKeyMove: (event: KeyboardEvent<HTMLElement>) => void
}) {
  const { canWork, updateTask, personByPrincipal, viewer } = useWorkData()
  const editable = canWork(item)
  const assignee = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null
  const reviewing = item.status === 'review' && viewer && (item.reviewerUserId ?? item.createdBy) === viewer.userId
  return (
    <article
      tabIndex={0}
      draggable={editable}
      data-testid="work-card"
      data-card-id={item.id}
      aria-label={item.title}
      aria-keyshortcuts={editable ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight' : undefined}
      onClick={() => onOpen(item.id)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter') { event.preventDefault(); onOpen(item.id) }
        else if (editable && event.altKey && event.key.startsWith('Arrow')) onKeyMove(event)
      }}
      className={`flex cursor-pointer flex-col gap-2.5 rounded-[10px] border bg-(--surface-elevated) p-3 text-left outline-none transition-[border-color,opacity] hover:border-(--muted-light) focus-visible:border-(--muted-light) focus-visible:ring-2 focus-visible:ring-(--border) ${selected ? 'border-(--muted-light)' : 'border-(--border)'} ${dragging ? 'opacity-35' : ''} ${editable ? 'active:cursor-grabbing' : ''}`}
    >
      <div className={`text-sm leading-snug ${item.status === 'done' ? 'text-(--muted) line-through decoration-(--muted-light)' : 'text-(--foreground)'}`}>{item.title}</div>
      {item.blocked || reviewing ? (
        <div className="flex gap-1.5">
          {item.blocked ? <Tag tone="danger">Blocked</Tag> : null}
          {reviewing ? <Tag tone="attention">Ready for review</Tag> : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-(--muted)">
        <StatusPicker status={item.status} disabled={!editable} onChange={(status) => void updateTask(item.id, { status })} className="grid h-5 w-5 place-items-center opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100" />
        <span className="flex-1" />
        <DueLabel dueDate={item.dueDate} done={item.status === 'done'} today={today} />
        <Avatar person={assignee} size={20} />
      </div>
    </article>
  )
}

/**
 * The board: a column per status. Drag a card to another column or to a new place in its own column; the keyboard
 * does the same with Alt and the arrow keys, and the status button on each card opens a menu.
 */
export function WorkBoard({
  items,
  today,
  selectedId,
  onOpen,
}: {
  items: WorkItem[]
  today: string
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const { moveTask } = useWorkData()
  const columns = useMemo(() => columnsByStatus(items), [items])
  const [dragId, setDragId] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const focusAfterMove = useRef<string | null>(null)
  const board = useRef<HTMLDivElement>(null)

  // A card that moved keeps the keyboard focus it had.
  useEffect(() => {
    const id = focusAfterMove.current
    if (!id) return
    focusAfterMove.current = null
    board.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus()
  }, [columns])

  function slotAt(event: DragEvent<HTMLElement>, column: HTMLElement): number {
    const middles = [...column.querySelectorAll<HTMLElement>('[data-card-id]')]
      .filter((card) => card.dataset.cardId !== dragId)
      .map((card) => { const box = card.getBoundingClientRect(); return box.top + box.height / 2 })
    return slotFromPointer(middles, event.clientY)
  }

  function drop(status: WorkStatus, slot: number) {
    const id = dragId
    setDragId(null)
    setTarget(null)
    if (!id) return
    const ordered = (columns.find((column) => column.status === status)?.items ?? []).filter((item) => item.id !== id)
    void moveTask(id, { status, ...neighborsForSlot(ordered, slot) })
  }

  function moveWithKeys(event: KeyboardEvent<HTMLElement>, id: string) {
    const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[event.key as 'ArrowUp']
    if (!direction) return
    event.preventDefault()
    const move = keyboardMove(columns, id, direction)
    if (!move) return
    const column = columns.find((entry) => entry.status === move.status)
    const count = (column?.items.length ?? 0) + (column?.items.some((item) => item.id === id) ? 0 : 1)
    setAnnouncement(`Moved to ${WORK_STATUS_LABELS[move.status]}, position ${move.position + 1} of ${count}`)
    focusAfterMove.current = id
    void moveTask(id, { status: move.status, afterId: move.afterId, beforeId: move.beforeId })
  }

  return (
    <div ref={board} className="flex h-full min-w-min gap-3.5 px-6 pb-6 pt-4" data-testid="work-board">
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {columns.map((column) => {
        const over = target?.status === column.status
        // The card being dragged stays in the DOM (removing it would cancel the drag); slots count the others only.
        const others = column.items.filter((item) => item.id !== dragId)
        let slotIndex = 0
        return (
          <section
            key={column.status}
            data-testid={`work-column-${column.status}`}
            aria-label={`${WORK_STATUS_LABELS[column.status]}, ${column.items.length} tasks`}
            className="flex min-h-0 max-w-85 flex-1 basis-59 flex-col"
          >
            <header className="flex items-center gap-2 px-1.5 pb-2.5 text-[13px] font-medium text-(--foreground)">
              <StatusIcon status={column.status} />
              <span>{WORK_STATUS_LABELS[column.status]}</span>
              <span className="font-normal text-(--muted-light)">{column.items.length}</span>
            </header>
            <div
              className={`flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-0.5 pb-5 transition-colors ${over ? 'bg-(--surface-subtle)' : ''}`}
              onDragOver={(event) => {
                if (!dragId) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const slot = slotAt(event, event.currentTarget)
                if (!target || target.status !== column.status || target.slot !== slot) setTarget({ status: column.status, slot })
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget((current) => (current?.status === column.status ? null : current))
              }}
              onDrop={(event) => {
                if (!dragId) return
                event.preventDefault()
                drop(column.status, slotAt(event, event.currentTarget))
              }}
            >
              {column.items.map((item) => {
                const isDragged = item.id === dragId
                const marker = !isDragged && over && target.slot === slotIndex
                if (!isDragged) slotIndex += 1
                return (
                  <div key={item.id} className="flex flex-col gap-2">
                    {marker ? <div className="h-0.5 rounded bg-(--foreground)/50" aria-hidden /> : null}
                    <Card
                      item={item}
                      today={today}
                      selected={item.id === selectedId}
                      dragging={isDragged}
                      onOpen={onOpen}
                      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); setDragId(item.id) }}
                      onDragEnd={() => { setDragId(null); setTarget(null) }}
                      onKeyMove={(event) => moveWithKeys(event, item.id)}
                    />
                  </div>
                )
              })}
              {over && target.slot >= others.length && others.length > 0 ? <div className="h-0.5 rounded bg-(--foreground)/50" aria-hidden /> : null}
              {column.items.length === 0 && !dragId ? (
                <div className="rounded-[10px] border border-dashed border-(--border) p-4 text-center text-[12.5px] text-(--muted-light)">Nothing here</div>
              ) : null}
              {column.items.length === 0 && dragId ? (
                <div className="rounded-[10px] border border-dashed border-(--border) p-4 text-center text-[12.5px] text-(--muted-light)">Drop a task here</div>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}
