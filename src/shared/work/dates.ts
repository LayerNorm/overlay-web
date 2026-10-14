/**
 * Calendar dates for tasks are `YYYY-MM-DD` strings with no time or zone, so a due date means the same day for everyone.
 * Day arithmetic goes through UTC midnight, which has no daylight-saving gaps.
 */
import { isWorkDate } from './status'

const MS_PER_DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function utcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function fromUtcMs(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The calendar day a `Date` falls on in the viewer's own timezone ("today" means their today). */
export function toWorkDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / MS_PER_DAY)
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(utcMs(date) + days * MS_PER_DAY)
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(utcMs(date)).getUTCDay()
}

/** The Monday on or before `date`. */
export function startOfWeek(date: string): string {
  const offset = (dayOfWeek(date) + 6) % 7
  return addDays(date, -offset)
}

export function clampDate(date: string, min: string, max: string): string {
  return date < min ? min : date > max ? max : date
}

/** "Oct 14", with the year when it is not the current one ("Oct 14, 2027"). */
export function formatWorkDate(date: string, today?: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const label = `${MONTHS[m - 1]} ${d}`
  if (today && Number(today.slice(0, 4)) === y) return label
  return today ? `${label}, ${y}` : label
}

export function formatWorkDateRange(start: string | null, due: string | null, today?: string): string {
  if (start && due) return start === due ? formatWorkDate(start, today) : `${formatWorkDate(start, today)} to ${formatWorkDate(due, today)}`
  if (due) return `Due ${formatWorkDate(due, today)}`
  if (start) return `Starts ${formatWorkDate(start, today)}`
  return ''
}

export type DueTone = 'overdue' | 'soon' | 'later' | 'none'

/** How urgent a due date feels: overdue, within three days, or not yet. Done tasks and tasks without a date are neutral. */
export function dueTone(dueDate: string | null, done: boolean, today: string): DueTone {
  if (!dueDate || done || !isWorkDate(dueDate)) return 'none'
  const days = diffDays(today, dueDate)
  if (days < 0) return 'overdue'
  return days <= 3 ? 'soon' : 'later'
}

/** The first and last day a task occupies on a timeline: its start (or due) and its due (or start). Null with no dates. */
export function taskSpan(startDate: string | null, dueDate: string | null): { start: string; end: string } | null {
  const start = startDate ?? dueDate
  const end = dueDate ?? startDate
  return start && end ? { start, end } : null
}
