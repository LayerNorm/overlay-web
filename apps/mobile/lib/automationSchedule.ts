import type { AutomationSchedule } from '@overlay/app-core'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Clock time: the automation's own (local) time when set, else the older UTC fields. */
function clock(schedule: Exclude<AutomationSchedule, { kind: 'interval' }>): string {
  const local = schedule.hour !== undefined
  const hour = local ? schedule.hour : schedule.hourUTC ?? 9
  const minute = local ? schedule.minute ?? 0 : schedule.minuteUTC ?? 0
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${local ? '' : ' UTC'}`
}

export function formatSchedule(schedule?: AutomationSchedule): string {
  if (!schedule) return 'Unscheduled'
  if (schedule.kind === 'interval') return `Every ${schedule.intervalMinutes ?? 60} min`
  if (schedule.kind === 'daily') return `Daily at ${clock(schedule)}`
  if (schedule.kind === 'weekdays') return `Weekdays at ${clock(schedule)}`
  if (schedule.kind === 'weekly') {
    const day = schedule.hour !== undefined ? schedule.dayOfWeek : schedule.dayOfWeekUTC
    return `${DAYS[day ?? 1] ?? 'Weekly'} at ${clock(schedule)}`
  }
  const day = schedule.hour !== undefined ? schedule.dayOfMonth : schedule.dayOfMonthUTC
  return `Monthly on day ${day ?? 1} at ${clock(schedule)}`
}
