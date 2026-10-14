'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { WorkItem } from '@overlay/app-core'
import { addDays, dayOfWeek, diffDays, formatWorkDate, formatWorkDateRange } from '@/shared/work/dates'
import {
  TIMELINE_DAY_WIDTH as DAY,
  TIMELINE_LABEL_WIDTH as LABEL,
  TIMELINE_ROW_HEIGHT as ROW,
  applyDrag,
  barLayout,
  buildTimelineRows,
  dayAtX,
  dependencyArrow,
  sameSpan,
  spanToDates,
  timelineRange,
  weekColumns,
  type DragMode,
  type Span,
} from '@/shared/work/timeline'
import { useWorkData } from './WorkDataProvider'
import { Avatar, STATUS_TEXT, StatusIcon } from './work-ui'

const DAY_LETTERS = 'SMTWTFS'
const HEADER = 52
const DRAG_THRESHOLD_PX = 3

type DragState = { id: string; mode: DragMode; startX: number; base: Span; moved: boolean }

function progressOf(item: WorkItem): number {
  if (item.status === 'done') return 1
  return item.doneWhen.length > 0 ? item.doneWhen.filter((entry) => entry.checked).length / item.doneWhen.length : 0
}

/**
 * The timeline: a bar per task across the days it covers, grouped under the task it sits inside. Drag a bar to move it,
 * drag an end to resize it (arrow keys do the same when a bar has focus), and click a task with no dates to schedule it.
 */
export function WorkTimeline({
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
  const { updateTask, canWork, personByPrincipal } = useWorkData()
  const allRows = useMemo(() => buildTimelineRows(items), [items])
  const range = useMemo(() => timelineRange(allRows, today), [allRows, today])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo(
    () => allRows.filter((row) => !(row.kind === 'task' && row.indented && row.item.parentId !== null && collapsed.has(row.item.parentId))),
    [allRows, collapsed],
  )
  const [preview, setPreview] = useState<{ id: string; span: Span } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const drag = useRef<DragState | null>(null)
  const dragged = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  // Rows are ordered by date, so a moved bar can change places; the browser drops focus from a node that moves.
  const refocus = useRef<string | null>(null)

  // Open on today, not on the start of the range.
  useLayoutEffect(() => {
    if (scrolled.current || !scroller.current) return
    scrolled.current = true
    scroller.current.scrollLeft = Math.max(0, diffDays(range.start, today) * DAY - 120)
  }, [range.start, today])

  useEffect(() => {
    const id = refocus.current
    if (!id) return
    const bar = scroller.current?.querySelector<HTMLElement>(`[data-testid="work-bar"][data-task-id="${CSS.escape(id)}"]`)
    if (bar && document.activeElement !== bar) bar.focus()
    refocus.current = null
  })

  const commit = useCallback((id: string, span: Span) => {
    void updateTask(id, spanToDates(span))
  }, [updateTask])

  useEffect(() => {
    function move(event: globalThis.PointerEvent) {
      const state = drag.current
      if (!state) return
      const dx = event.clientX - state.startX
      if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      state.moved = true
      setPreview({ id: state.id, span: applyDrag(state.base, state.mode, Math.round(dx / DAY)) })
    }
    function up(event: globalThis.PointerEvent) {
      const state = drag.current
      if (!state) return
      drag.current = null
      if (state.moved) {
        dragged.current = true
        const next = applyDrag(state.base, state.mode, Math.round((event.clientX - state.startX) / DAY))
        if (!sameSpan(next, state.base)) commit(state.id, next)
        window.setTimeout(() => { dragged.current = false }, 0)
      }
      setPreview(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [commit])

  function beginDrag(event: PointerEvent, item: WorkItem, span: Span, mode: DragMode) {
    if (event.button !== 0 || !canWork(item)) return
    event.stopPropagation()
    drag.current = { id: item.id, mode, startX: event.clientX, base: span, moved: false }
  }

  function keyMove(event: KeyboardEvent, item: WorkItem, span: Span) {
    if (event.key === 'Enter') { event.preventDefault(); onOpen(item.id); return }
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || !canWork(item)) return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = applyDrag(span, event.shiftKey ? 'end' : 'move', delta)
    if (sameSpan(next, span)) return
    setAnnouncement(`${item.title}: ${formatWorkDateRange(next.start, next.end, today)}`)
    refocus.current = item.id
    commit(item.id, next)
  }

  // Where each task's bar is right now (a bar being dragged included), so arrows follow it.
  const arrows = useMemo(() => {
    const at = new Map<string, { x1: number; x2: number; y: number }>()
    rows.forEach((row, index) => {
      if (row.kind !== 'task') return
      const span = preview?.id === row.item.id ? preview.span : row.span
      if (!span) return
      const layout = barLayout(span, range)
      at.set(row.item.id, { x1: layout.left + Math.max(layout.width, DAY), x2: layout.left, y: index * ROW + ROW / 2 })
    })
    const lines: Array<{ key: string; path: string; head: string }> = []
    for (const row of rows) {
      if (row.kind !== 'task') continue
      const waiting = at.get(row.item.id)
      if (!waiting) continue
      for (const blockerId of row.item.blockedBy) {
        const blocker = at.get(blockerId)
        if (!blocker) continue
        lines.push({ key: `${blockerId}>${row.item.id}`, ...dependencyArrow({ x: blocker.x1, y: blocker.y }, { x: waiting.x2, y: waiting.y }) })
      }
    }
    return lines
  }, [preview, range, rows])

  const width = range.days * DAY
  const todayX = diffDays(range.start, today) * DAY + DAY / 2
  const weeks = weekColumns(range)
  const objectiveBar = 'absolute top-[15px] h-2.5 rounded-[3px] bg-(--foreground)/75'

  return (
    <div ref={scroller} className="relative h-full overflow-auto" data-testid="work-timeline">
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      <div className="relative" style={{ width: LABEL + width }}>
        <div className="sticky top-0 z-20 flex border-b border-(--border) bg-(--background)" style={{ height: HEADER }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-(--border) bg-(--background)" style={{ width: LABEL }} />
          <div className="relative shrink-0" style={{ width }}>
            {weeks.map((week) => (
              <div key={week.start} className="absolute top-0 h-full border-l border-(--border)" style={{ left: week.left, width: week.width }}>
                <b className="block px-2.5 pt-[7px] text-xs font-medium text-(--foreground)">{formatWorkDate(week.start)}</b>
                <div className="flex pt-1">
                  {Array.from({ length: Math.round(week.width / DAY) }, (_, offset) => {
                    const day = addDays(week.start, offset)
                    return (
                      <span key={day} className={`flex-1 text-center text-[10px] ${day === today ? 'font-semibold text-(--foreground)' : 'text-(--muted-light)'}`}>
                        {DAY_LETTERS[dayOfWeek(day)]}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {rows.map((row) => {
          const item = row.item
          const editable = canWork(item)
          const live = preview?.id === item.id ? preview.span : null
          const span = live ?? row.span
          const assignee = item.assigneePrincipalId ? personByPrincipal.get(item.assigneePrincipalId) ?? null : null
          const layout = span ? barLayout(span, range) : null
          const selected = item.id === selectedId
          return (
            <div key={item.id} data-testid="work-timeline-row" data-task-id={item.id} className="group/row flex border-b border-(--border)/55" style={{ height: ROW }}>
              <div className={`sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-(--border) bg-(--background) pr-4 text-[13px] group-hover/row:bg-(--surface-muted) ${row.kind === 'task' && row.indented ? 'pl-9' : 'pl-4'} ${selected ? 'bg-(--surface-subtle)' : ''}`} style={{ width: LABEL }}>
                {row.kind === 'objective' ? (
                  <button
                    type="button"
                    aria-label={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.title}`}
                    aria-expanded={!collapsed.has(item.id)}
                    onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })}
                    className="grid h-4 w-4 place-items-center text-(--muted-light)"
                  >
                    <ChevronDown size={13} className={`transition-transform ${collapsed.has(item.id) ? '-rotate-90' : ''}`} aria-hidden />
                  </button>
                ) : <StatusIcon status={item.status} />}
                <button type="button" onClick={() => onOpen(item.id)} className={`min-w-0 flex-1 truncate text-left ${row.kind === 'objective' ? 'font-medium text-(--foreground)' : 'text-(--foreground)'}`}>
                  {item.title}
                </button>
                {row.kind === 'objective' ? <span className="text-xs text-(--muted-light)">{row.childCount}</span> : <Avatar person={assignee} size={20} />}
              </div>

              <div
                className="relative shrink-0"
                style={{ width, backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 1px)', backgroundSize: `${7 * DAY}px 100%` }}
                onClick={(event) => {
                  if (row.kind !== 'task' || span || !editable || event.target !== event.currentTarget) return
                  const day = dayAtX(event.nativeEvent.offsetX, range)
                  void updateTask(item.id, { startDate: day, dueDate: day })
                }}
              >
                {layout && row.kind === 'objective' ? (
                  <div className={objectiveBar} style={{ left: layout.left, width: layout.width }} data-testid="work-objective-bar" aria-hidden>
                    <span className="absolute -bottom-[5px] left-0 h-[7px] w-0.5 bg-(--foreground)" />
                    <span className="absolute -bottom-[5px] right-0 h-[7px] w-0.5 bg-(--foreground)" />
                  </div>
                ) : null}
                {layout && row.kind === 'task' && span ? (
                  <div
                    role="button"
                    tabIndex={0}
                    data-testid="work-bar"
                    data-task-id={item.id}
                    aria-label={`${item.title}, ${formatWorkDateRange(span.start, span.end, today)}`}
                    aria-keyshortcuts={editable ? 'ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight' : undefined}
                    title={`${item.title}\n${formatWorkDateRange(span.start, span.end, today)}`}
                    onPointerDown={(event) => beginDrag(event, item, row.span ?? span, 'move')}
                    onClick={() => { if (!dragged.current) onOpen(item.id) }}
                    onKeyDown={(event) => keyMove(event, item, span)}
                    className={`group/bar absolute top-[9px] flex h-[22px] touch-none select-none items-center overflow-hidden whitespace-nowrap rounded-md border bg-(--surface-elevated) text-[11.5px] outline-none transition-[border-color] hover:border-(--muted-light) focus-visible:border-(--muted-light) focus-visible:ring-2 focus-visible:ring-(--border) ${selected || live ? 'border-(--muted-light)' : 'border-(--border)'} ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${STATUS_TEXT[item.status]}`}
                    style={{ left: layout.left, width: Math.max(layout.width, DAY) }}
                  >
                    <span className="absolute inset-0 bg-current opacity-[0.16]" aria-hidden />
                    <span className="absolute inset-y-0 left-0 bg-current opacity-[0.28]" style={{ width: `${progressOf(item) * 100}%` }} aria-hidden />
                    {editable ? (
                      <>
                        <span data-testid="work-bar-start" onPointerDown={(event) => beginDrag(event, item, row.span ?? span, 'start')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" aria-hidden />
                        <span data-testid="work-bar-end" onPointerDown={(event) => beginDrag(event, item, row.span ?? span, 'end')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" aria-hidden />
                      </>
                    ) : null}
                  </div>
                ) : null}
                {!span && row.kind === 'task' ? (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-(--muted-light) opacity-0 transition-opacity group-hover/row:opacity-100">
                    {editable ? 'No dates. Click a day to schedule it.' : 'No dates'}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}

        {arrows.length > 0 ? (
          <svg
            className="pointer-events-none absolute z-[1] overflow-visible text-(--muted-light)"
            style={{ left: LABEL, top: HEADER }}
            width={width}
            height={rows.length * ROW}
            data-testid="work-dependencies"
            aria-hidden
          >
            {arrows.map((arrow) => (
              <g key={arrow.key} data-testid="work-dependency" data-edge={arrow.key}>
                <path d={arrow.path} fill="none" stroke="currentColor" strokeWidth="1.25" />
                <polygon points={arrow.head} fill="currentColor" />
              </g>
            ))}
          </svg>
        ) : null}

        <div className="pointer-events-none absolute bottom-0 z-10 w-0 border-l-[1.5px] border-red-500/60" style={{ left: LABEL + todayX, top: HEADER }} data-testid="work-today-line">
          <span className="absolute -left-4 -top-0.5 rounded bg-red-500 px-1.5 py-px text-[9.5px] text-white">Today</span>
        </div>
      </div>
    </div>
  )
}
