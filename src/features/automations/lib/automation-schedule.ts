import type { AutomationSchedule } from '@overlay/app-core'
import { WEEKDAY_LABELS, localFieldsFromSchedule, parseAutomationTime } from '@overlay/app-core/automations'

/** What the schedule picker edits: wall-clock fields in the automation's time zone. */
export type ScheduleFrequency = 'interval' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type ScheduleDraft = {
  frequency: ScheduleFrequency
  intervalMinutes: number
  time: string
  weekday: number
  monthDay: number
}

export const SCHEDULE_FREQUENCIES: Array<{ frequency: ScheduleFrequency; label: string }> = [
  { frequency: 'interval', label: 'Every hour' },
  { frequency: 'daily', label: 'Every day' },
  { frequency: 'weekdays', label: 'Every weekday' },
  { frequency: 'weekly', label: 'Every week' },
  { frequency: 'monthly', label: 'Every month' },
]

export const DEFAULT_SCHEDULE_DRAFT: ScheduleDraft = {
  frequency: 'weekdays',
  intervalMinutes: 60,
  time: '09:00',
  weekday: 1,
  monthDay: 1,
}

/** The highest day every month has, so a monthly run never skips February. */
export const MAX_MONTH_DAY = 28

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Rows with local fields read them directly; older rows only carry UTC fields and are converted. */
export function scheduleDraftFromSchedule(schedule: AutomationSchedule | undefined, timeZone: string): ScheduleDraft {
  if (!schedule) return DEFAULT_SCHEDULE_DRAFT
  if (schedule.kind === 'interval') {
    return { ...DEFAULT_SCHEDULE_DRAFT, frequency: 'interval', intervalMinutes: schedule.intervalMinutes ?? 60 }
  }
  const legacy = localFieldsFromSchedule(schedule, timeZone)
  const time = typeof schedule.hour === 'number' ? pad(schedule.hour) + ':' + pad(schedule.minute ?? 0) : legacy.time
  return {
    ...DEFAULT_SCHEDULE_DRAFT,
    frequency: schedule.kind,
    time,
    weekday: schedule.kind === 'weekly' ? schedule.dayOfWeek ?? legacy.dayOfWeek : DEFAULT_SCHEDULE_DRAFT.weekday,
    monthDay: schedule.kind === 'monthly' ? schedule.dayOfMonth ?? legacy.dayOfMonth : DEFAULT_SCHEDULE_DRAFT.monthDay,
  }
}

/** Local fields only; the server fills the UTC fields from the automation's time zone. */
export function scheduleFromDraft(draft: ScheduleDraft): AutomationSchedule {
  if (draft.frequency === 'interval') return { kind: 'interval', intervalMinutes: draft.intervalMinutes }
  const { hour, minute } = parseAutomationTime(draft.time)
  if (draft.frequency === 'weekly') return { kind: 'weekly', dayOfWeek: draft.weekday, hour, minute }
  if (draft.frequency === 'monthly') return { kind: 'monthly', dayOfMonth: draft.monthDay, hour, minute }
  return { kind: draft.frequency, hour, minute }
}

export function formatClockTime(time: string): string {
  const { hour, minute } = parseAutomationTime(time)
  return (hour % 12 || 12) + ':' + pad(minute) + ' ' + (hour < 12 ? 'AM' : 'PM')
}

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return n + (teen ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th')
}

function intervalLabel(minutes: number): string {
  if (minutes === 60) return 'Every hour'
  if (minutes % 60 === 0) return 'Every ' + minutes / 60 + ' hours'
  return 'Every ' + minutes + ' minutes'
}

export function scheduleLabel(draft: ScheduleDraft): string {
  const at = formatClockTime(draft.time)
  switch (draft.frequency) {
    case 'interval': return intervalLabel(draft.intervalMinutes)
    case 'daily': return 'Every day · ' + at
    case 'weekdays': return 'Every weekday · ' + at
    case 'weekly': return 'Every ' + (WEEKDAY_LABELS[draft.weekday] ?? 'Monday') + ' · ' + at
    case 'monthly': return 'Monthly on the ' + ordinal(draft.monthDay) + ' · ' + at
  }
}

export function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll('_', ' ')
}

/** "Today 9:00 AM", "Tomorrow 9:00 AM", "Mon 9:00 AM" within a week, otherwise "Dec 1, 9:00 AM". */
export function formatRunTime(at: number, nowMs = Date.now()): string {
  const date = new Date(at)
  const time = formatClockTime(date.getHours() + ':' + date.getMinutes())
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOf(date) - startOf(new Date(nowMs))) / 86_400_000)
  if (days === 0) return 'Today ' + time
  if (days === 1) return 'Tomorrow ' + time
  if (days === -1) return 'Yesterday ' + time
  if (Math.abs(days) < 7) return WEEKDAY_LABELS[date.getDay()]!.slice(0, 3) + ' ' + time
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time
}
