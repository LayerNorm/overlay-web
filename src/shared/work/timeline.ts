/**
 * Timeline layout: which rows to draw, how far apart days are, where a bar sits, and what dragging it means. Pure, so
 * the screen only has to paint what these return.
 */
import type { WorkItem } from '@overlay/app-core'
import { addDays, diffDays, startOfWeek, taskSpan } from './dates'
import { sortByRank } from './query'

export const TIMELINE_DAY_WIDTH = 24
export const TIMELINE_ROW_HEIGHT = 40
export const TIMELINE_LABEL_WIDTH = 300
/** The task-name column on a phone-sized screen. */
export const TIMELINE_LABEL_WIDTH_COMPACT = 132

export type Span = { start: string; end: string }

export type TimelineRow =
  | { kind: 'objective'; item: WorkItem; span: Span | null; childCount: number }
  | { kind: 'task'; item: WorkItem; span: Span | null; indented: boolean }

/** The days an objective covers: from its earliest task's start to its latest task's end (its own dates if no task has any). */
export function unionSpan(spans: ReadonlyArray<Span | null>): Span | null {
  let start: string | null = null
  let end: string | null = null
  for (const span of spans) {
    if (!span) continue
    if (start === null || span.start < start) start = span.start
    if (end === null || span.end > end) end = span.end
  }
  return start && end ? { start, end } : null
}

/**
 * The rows, top to bottom. A task that others sit inside is an objective row followed by its tasks (by start date, then
 * rank). Everything else is a plain row. Groups run in order of their earliest date; undated ones go last.
 */
export function buildTimelineRows(items: readonly WorkItem[]): TimelineRow[] {
  const ids = new Set(items.map((item) => item.id))
  const kidsOf = new Map<string, WorkItem[]>()
  for (const item of items) {
    if (item.parentId && ids.has(item.parentId)) kidsOf.set(item.parentId, [...(kidsOf.get(item.parentId) ?? []), item])
  }
  const spanOf = (item: WorkItem) => taskSpan(item.startDate, item.dueDate)
  const byStart = (a: WorkItem, b: WorkItem) => {
    const sa = spanOf(a)?.start ?? '9999-12-31'
    const sb = spanOf(b)?.start ?? '9999-12-31'
    return sa < sb ? -1 : sa > sb ? 1 : 0
  }

  const groups: Array<{ first: string; rows: TimelineRow[] }> = []
  for (const item of sortByRank(items)) {
    if (item.parentId && ids.has(item.parentId)) continue
    const kids = [...(kidsOf.get(item.id) ?? [])].sort(byStart)
    if (kids.length > 0) {
      const span = unionSpan(kids.map(spanOf)) ?? spanOf(item)
      groups.push({
        first: span?.start ?? '9999-12-31',
        rows: [
          { kind: 'objective', item, span, childCount: kids.length },
          ...kids.map((kid): TimelineRow => ({ kind: 'task', item: kid, span: spanOf(kid), indented: true })),
        ],
      })
    } else {
      const span = spanOf(item)
      groups.push({ first: span?.start ?? '9999-12-31', rows: [{ kind: 'task', item, span, indented: false }] })
    }
  }
  return groups.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0)).flatMap((group) => group.rows)
}

export type TimelineRange = { start: string; days: number }

/** Always at least eight weeks, from the Monday a week before the earliest date to two weeks after the latest, today included. */
export function timelineRange(rows: readonly TimelineRow[], today: string): TimelineRange {
  let first = today
  let last = today
  for (const row of rows) {
    if (!row.span) continue
    if (row.span.start < first) first = row.span.start
    if (row.span.end > last) last = row.span.end
  }
  const start = startOfWeek(addDays(first, -7))
  const end = addDays(last, 14)
  const days = Math.max(56, Math.ceil((diffDays(start, end) + 1) / 7) * 7)
  return { start, days }
}

/** Pixel position of a span: it starts at its first day's left edge and covers every day up to and including its last. */
export function barLayout(span: Span, range: TimelineRange, dayWidth = TIMELINE_DAY_WIDTH): { left: number; width: number } {
  const left = diffDays(range.start, span.start) * dayWidth
  const width = (diffDays(span.start, span.end) + 1) * dayWidth
  return { left, width }
}

export function dayAtX(x: number, range: TimelineRange, dayWidth = TIMELINE_DAY_WIDTH): string {
  return addDays(range.start, Math.floor(x / dayWidth))
}

export type DragMode = 'move' | 'start' | 'end'

/**
 * What dragging a bar by `deltaDays` does: the whole bar moves, or one end moves (never past the other). A task with a
 * single date is a one-day bar, so every drag keeps it valid.
 */
export function applyDrag(span: Span, mode: DragMode, deltaDays: number): Span {
  if (mode === 'move') return { start: addDays(span.start, deltaDays), end: addDays(span.end, deltaDays) }
  if (mode === 'start') {
    const start = addDays(span.start, deltaDays)
    return { start: start > span.end ? span.end : start, end: span.end }
  }
  const end = addDays(span.end, deltaDays)
  return { start: span.start, end: end < span.start ? span.start : end }
}

/** The task's dates after a drag: both set, or (for a one-date task that did not change length) still both set. */
export function spanToDates(span: Span): { startDate: string; dueDate: string } {
  return { startDate: span.start, dueDate: span.end }
}

export function sameSpan(a: Span | null, b: Span | null): boolean {
  return a?.start === b?.start && a?.end === b?.end
}

export type WeekColumn = { start: string; left: number; width: number }

/** One header cell per week across the range. */
export function weekColumns(range: TimelineRange, dayWidth = TIMELINE_DAY_WIDTH): WeekColumn[] {
  const weeks: WeekColumn[] = []
  for (let offset = 0; offset < range.days; offset += 7) {
    weeks.push({ start: addDays(range.start, offset), left: offset * dayWidth, width: Math.min(7, range.days - offset) * dayWidth })
  }
  return weeks
}

export type Point = { x: number; y: number }

/**
 * The arrow from the end of the task that has to finish first to the start of the task that waits on it: out of the
 * blocker's right edge, down or up to the waiting task's row, and into its left edge. When the waiting task starts
 * before the blocker ends there is no room for a straight elbow, so the line runs along the gap between rows instead.
 */
export function dependencyArrow(from: Point, to: Point, rowHeight = TIMELINE_ROW_HEIGHT): { path: string; head: string } {
  const out = from.x + 8
  const into = to.x - 6
  const head = `${to.x},${to.y} ${to.x - 6},${to.y - 3.5} ${to.x - 6},${to.y + 3.5}`
  if (into >= out) return { path: `M${from.x} ${from.y} H${out} V${to.y} H${into}`, head }
  const lane = (from.y < to.y ? to.y : from.y) - rowHeight / 2
  const back = to.x - 14
  return { path: `M${from.x} ${from.y} H${out} V${lane} H${back} V${to.y} H${into}`, head }
}
