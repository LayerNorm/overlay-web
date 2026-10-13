'use client'
import { useEffect, useRef, useState, useId } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import type { WorkItem, WorkPatch } from '@overlay/app-core/work'
import {
  addDays,
  barLayout,
  daysBetween,
  shiftedSpan,
  timelineRows,
  weekStart,
  workSpan,
  buildWorkSpans,
  visibleTimelineRange,
  TIMELINE_DAY_WIDTH as DAY,
  TIMELINE_ROW_HEIGHT as ROW,
} from '../lib/timeline'
import { dependencyPath } from '../lib/dependency-path'
const PERIOD_DAYS = 126
const LABEL_WIDTH = 184
const HEADER_HEIGHT = 48
const labelDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
type Drag = {
  item: WorkItem
  startDate: string
  dueDate: string
  mode: 'move' | 'start' | 'end'
  x: number
  scroll: number
  delta: number
}
export function WorkTimeline({
  items,
  allItems,
  pending,
  canEdit,
  onUpdate,
  onOpen,
}: {
  items: WorkItem[]
  allItems: WorkItem[]
  pending: ReadonlySet<string>
  canEdit: (item: WorkItem) => boolean
  onUpdate: (item: WorkItem, patch: WorkPatch) => Promise<WorkItem>
  onOpen: (item: WorkItem) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [start, setStart] = useState(() => addDays(weekStart(today), -14))
  const [drag, setDrag] = useState<Drag | null>(null)
  const [error, setError] = useState('')
  const [viewport, setViewport] = useState({ top: 0, height: 540 })
  const ignoreClick = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const markerId = useId().replace(/:/g, '')
  const rows = timelineRows(items)
  const projected = drag
    ? allItems.map((item) =>
        item._id === drag.item._id
          ? { ...item, ...shiftedSpan(drag, drag.mode, drag.delta) }
          : item,
      )
    : allItems
  const spans = buildWorkSpans(projected)
  const visible = visibleTimelineRange(rows.length, viewport.top, viewport.height)
  const positions = new Map(
    rows.flatMap((item, index) => {
      const span = spans.get(item._id)
      const bar = span ? barLayout(span, start, PERIOD_DAYS) : null
      return bar
        ? [
            [
              item._id,
              {
                left: LABEL_WIDTH + bar.left,
                right: LABEL_WIDTH + bar.left + bar.width,
                y: index * ROW + ROW / 2,
              },
            ] as const,
          ]
        : []
    }),
  )
  const rowIndexes = new Map(rows.map((row, index) => [row._id, index]))
  const arrows = rows.flatMap((item) =>
    (item.blockedBy ?? []).flatMap((id, lane) => {
      const from = positions.get(id)
      const to = positions.get(item._id)
      const fromIndex = rowIndexes.get(id) ?? -1
      const toIndex = rowIndexes.get(item._id) ?? -1
      const inWindow = (index: number) => index >= visible.start && index < visible.end
      return from && to && (inWindow(fromIndex) || inWindow(toIndex))
        ? [
            {
              key: `${id}:${item._id}`,
              path: dependencyPath({ x: from.right, y: from.y }, { x: to.left, y: to.y }, lane),
            },
          ]
        : []
    }),
  )
  const hasRows = rows.length > 0
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight })
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [hasRows])
  useEffect(() => {
    if (scroller.current)
      scroller.current.scrollLeft = Math.max(0, daysBetween(start, today) * DAY - 40)
  }, [start, today, hasRows])
  useEffect(() => {
    if (!drag) return
    const move = (event: PointerEvent) =>
      setDrag((current) =>
        current
          ? {
              ...current,
              delta: Math.round(
                (event.clientX - current.x + (scroller.current?.scrollLeft ?? 0) - current.scroll) /
                  DAY,
              ),
            }
          : null,
      )
    const up = (event: PointerEvent) => {
      const delta = Math.round(
        (event.clientX - drag.x + (scroller.current?.scrollLeft ?? 0) - drag.scroll) / DAY,
      )
      ignoreClick.current = delta !== 0
      setDrag(null)
      if (!delta) {
        if (drag.mode === 'move') onOpen(drag.item)
        return
      }
      setError('')
      void onUpdate(drag.item, shiftedSpan(drag, drag.mode, delta)).catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Could not update dates'),
      )
    }
    const cancel = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [drag, onUpdate, onOpen])
  function begin(event: React.PointerEvent<HTMLButtonElement>, item: WorkItem, mode: Drag['mode']) {
    const span = workSpan(item, allItems)
    if (!span || span.objective || pending.has(item._id) || !canEdit(item) || event.button !== 0)
      return
    ignoreClick.current = false
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      item,
      ...span,
      mode,
      x: event.clientX,
      scroll: scroller.current?.scrollLeft ?? 0,
      delta: 0,
    })
  }
  return (
    <div className="min-w-0 px-6 pb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-(--muted)">
        <CalendarDays size={14} />
        <span>
          {labelDay(start)} – {labelDay(addDays(start, PERIOD_DAYS - 1))}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            aria-label="Previous four weeks"
            onClick={() => setStart(addDays(start, -28))}
            className="rounded p-2 hover:bg-(--surface-subtle)"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setStart(addDays(weekStart(today), -14))}
            className="rounded px-2 py-1.5 hover:bg-(--surface-subtle)"
          >
            Today
          </button>
          <button
            aria-label="Next four weeks"
            onClick={() => setStart(addDays(start, 28))}
            className="rounded p-2 hover:bg-(--surface-subtle)"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {!rows.length ? (
        <p className="py-12 text-center text-sm text-(--muted)">Add a task to plan its dates.</p>
      ) : (
        <div
          ref={scroller}
          onScroll={(event) =>
            setViewport({
              top: event.currentTarget.scrollTop,
              height: event.currentTarget.clientHeight,
            })
          }
          className="max-h-[65vh] w-full overflow-auto rounded-md border border-(--border)"
          aria-label="Work timeline"
          tabIndex={0}
        >
          <div
            className="relative"
            style={{
              width: LABEL_WIDTH + PERIOD_DAYS * DAY,
              minHeight: HEADER_HEIGHT + rows.length * ROW,
            }}
          >
            <div
              className="sticky top-0 z-20 flex border-b border-(--border) bg-(--background)"
              style={{ height: HEADER_HEIGHT }}
            >
              <div
                className="sticky left-0 z-30 flex shrink-0 items-center border-r border-(--border) bg-(--background) px-3 text-xs text-(--muted)"
                style={{ width: LABEL_WIDTH }}
              >
                Task / objective
              </div>
              <div className="flex">
                {Array.from({ length: PERIOD_DAYS / 7 }, (_, week) => (
                  <div
                    key={week}
                    className="flex shrink-0 items-center border-r border-(--border) px-2 text-xs text-(--muted)"
                    style={{ width: 7 * DAY }}
                  >
                    Week of {labelDay(addDays(start, week * 7))}
                  </div>
                ))}
              </div>
            </div>
            {daysBetween(start, today) >= 0 && daysBetween(start, today) < PERIOD_DAYS ? (
              <div
                aria-label={`Today ${today}`}
                className="pointer-events-none absolute bottom-0 top-12 z-10 border-l border-(--muted)"
                style={{ left: LABEL_WIDTH + daysBetween(start, today) * DAY + DAY / 2 }}
              />
            ) : null}
            <svg
              aria-label="Task dependencies"
              className="pointer-events-none absolute z-5 overflow-visible text-(--muted-light)"
              style={{ left: 0, top: HEADER_HEIGHT }}
              width={LABEL_WIDTH + PERIOD_DAYS * DAY}
              height={rows.length * ROW}
            >
              <defs>
                <marker
                  id={markerId}
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0 0 L6 3 L0 6" fill="none" stroke="currentColor" />
                </marker>
              </defs>
              {arrows.map((arrow) => (
                <path
                  key={arrow.key}
                  d={arrow.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  markerEnd={`url(#${markerId})`}
                />
              ))}
            </svg>
            {rows.slice(visible.start, visible.end).map((item, offset) => {
              const span =
                drag?.item._id === item._id
                  ? { ...shiftedSpan(drag, drag.mode, drag.delta), objective: false }
                  : spans.get(item._id)
              const layout = span ? barLayout(span, start, PERIOD_DAYS) : null
              const editable = canEdit(item) && !pending.has(item._id) && !span?.objective
              return (
                <div
                  key={item._id}
                  className="relative flex border-b border-(--border)"
                  style={{
                    height: ROW,
                    position: 'absolute',
                    top: HEADER_HEIGHT + (visible.start + offset) * ROW,
                    left: 0,
                    width: LABEL_WIDTH + PERIOD_DAYS * DAY,
                  }}
                >
                  <button
                    onClick={() => onOpen(item)}
                    className="sticky left-0 z-10 flex shrink-0 items-center truncate border-r border-(--border) bg-(--background) px-3 text-left text-xs hover:bg-(--surface-subtle)"
                    style={{ width: LABEL_WIDTH, paddingLeft: item.parentId ? 24 : 12 }}
                    title={item.title}
                  >
                    {item.title}
                  </button>
                  <div
                    className="relative flex-1"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, var(--border) 1px, transparent 1px)',
                      backgroundSize: `${7 * DAY}px 100%`,
                    }}
                  >
                    {span && layout ? (
                      <div
                        className={`absolute top-2 flex h-6 items-center rounded ${span.objective ? 'border border-(--muted-light) bg-(--surface-subtle)' : 'bg-(--surface-subtle) ring-1 ring-(--border)'}`}
                        style={{ left: layout.left, width: layout.width }}
                      >
                        {editable ? (
                          <button
                            aria-label={`Resize start of ${item.title}`}
                            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none rounded-l"
                            onPointerDown={(e) => begin(e, item, 'start')}
                          />
                        ) : null}
                        <button
                          aria-label={`${item.title}: ${span.startDate} to ${span.dueDate}`}
                          onPointerDown={(e) => begin(e, item, 'move')}
                          onClick={(e) => {
                            if (ignoreClick.current && e.detail !== 0) {
                              ignoreClick.current = false
                              return
                            }
                            if (!editable || e.detail === 0) onOpen(item)
                          }}
                          className={`h-full w-full truncate px-2 text-left text-[10px] ${editable ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
                          title={`${span.startDate} – ${span.dueDate}${span.objective ? ' · spans child tasks' : ''}`}
                        >
                          {item.title}
                        </button>
                        {editable ? (
                          <button
                            aria-label={`Resize end of ${item.title}`}
                            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none rounded-r"
                            onPointerDown={(e) => begin(e, item, 'end')}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <button
                        className="absolute left-3 top-3 text-[10px] text-(--muted)"
                        onClick={() => {
                          if (span) setStart(addDays(weekStart(span.startDate), -7))
                          else onOpen(item)
                        }}
                      >
                        {span ? 'Outside this period · show dates' : 'Set dates in brief'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] text-(--muted)">
        Drag a bar or its edges to change dates. Open a task to enter dates with the keyboard.
        Objective bars span their tasks.
      </p>
    </div>
  )
}
