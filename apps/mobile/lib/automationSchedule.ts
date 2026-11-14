import type { AutomationSchedule } from '@overlay/app-core'

export function formatSchedule(schedule?: AutomationSchedule): string {
  if (!schedule) return 'Unscheduled'
  if (schedule.kind === 'interval') return `Every ${schedule.intervalMinutes ?? 60} min`
  if (schedule.kind === 'daily')
    return `Daily at ${String(schedule.hourUTC ?? 9).padStart(2, '0')}:${String(schedule.minuteUTC ?? 0).padStart(2, '0')} UTC`
  if (schedule.kind === 'weekly') return `Weekly, day ${schedule.dayOfWeekUTC ?? 1}`
  return `Monthly, day ${schedule.dayOfMonthUTC ?? 1}`
}
