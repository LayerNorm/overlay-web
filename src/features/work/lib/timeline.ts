import type { WorkItem } from '@overlay/app-core/work'
const DAY_MS = 86_400_000
export const TIMELINE_DAY_WIDTH = 28
export const TIMELINE_ROW_HEIGHT = 40
export function dayNumber(day: string) {
  const timestamp = Date.parse(`${day}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) throw new Error('Invalid calendar date')
  return timestamp / DAY_MS
}
export function addDays(day: string, days: number) { return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10) }
export function daysBetween(start: string, end: string) { return dayNumber(end) - dayNumber(start) }
export function weekStart(day: string) { const weekday = new Date(dayNumber(day) * DAY_MS).getUTCDay(); return addDays(day, -((weekday + 6) % 7)) }
export function workSpan(item: WorkItem, items: readonly WorkItem[]) {
  const children = items.filter((row) => row.parentId === item._id)
  const dates = (children.length ? children : [item]).flatMap((row) => [row.startDate, row.dueDate].filter((day): day is string => Boolean(day))).sort()
  return dates.length ? { startDate: dates[0], dueDate: dates.at(-1)! , objective: children.length > 0 } : null
}
export function barLayout(span: { startDate: string; dueDate: string }, start: string, days: number) {
  const from = daysBetween(start, span.startDate); const until = daysBetween(start, span.dueDate) + 1
  if (until <= 0 || from >= days) return null
  return { left: Math.max(0, from) * TIMELINE_DAY_WIDTH, width: (Math.min(days, until) - Math.max(0, from)) * TIMELINE_DAY_WIDTH }
}
export function shiftedSpan(span: { startDate: string; dueDate: string }, mode: 'move' | 'start' | 'end', delta: number) {
  if (mode === 'move') return { startDate: addDays(span.startDate, delta), dueDate: addDays(span.dueDate, delta) }
  if (mode === 'start') return { startDate: addDays(span.startDate, Math.min(delta, daysBetween(span.startDate, span.dueDate))), dueDate: span.dueDate }
  return { startDate: span.startDate, dueDate: addDays(span.dueDate, Math.max(delta, -daysBetween(span.startDate, span.dueDate))) }
}
export function timelineRows(items: readonly WorkItem[]) {
  const sorted = [...items].sort((a, b) => a.rank.localeCompare(b.rank) || a._id.localeCompare(b._id))
  const present = new Set(sorted.map((row) => row._id))
  return sorted.filter((row) => !row.parentId || !present.has(row.parentId)).flatMap((row) => [row, ...sorted.filter((child) => child.parentId === row._id)])
}
