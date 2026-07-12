import type { AutomationSchedule } from '@overlay/app-core'

export const DEFAULT_AUTOMATION_SCHEDULE: AutomationSchedule = {
  kind: 'daily',
  hourUTC: 14,
  minuteUTC: 0,
}

const MIN_INTERVAL_MINUTES = 15

function clampInteger(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

export function normalizeAutomationSchedule(schedule: AutomationSchedule): AutomationSchedule {
  switch (schedule.kind) {
    case 'interval':
      return {
        kind: 'interval',
        intervalMinutes: clampInteger(
          schedule.intervalMinutes ?? 60,
          MIN_INTERVAL_MINUTES,
          60 * 24 * 365,
          60,
        ),
      }
    case 'daily':
      return {
        kind: 'daily',
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
      }
    case 'weekly':
      return {
        kind: 'weekly',
        dayOfWeekUTC: clampInteger(schedule.dayOfWeekUTC ?? 1, 0, 6, 1),
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
      }
    case 'monthly':
      return {
        kind: 'monthly',
        dayOfMonthUTC: clampInteger(schedule.dayOfMonthUTC ?? 1, 1, 31, 1),
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
      }
  }
}

export function computeNextAutomationRunAt(scheduleInput: AutomationSchedule, fromMs: number): number {
  const schedule = normalizeAutomationSchedule(scheduleInput)
  const from = new Date(fromMs)

  if (schedule.kind === 'interval') {
    return fromMs + (schedule.intervalMinutes ?? 60) * 60_000
  }

  if (schedule.kind === 'daily') {
    const candidate = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
    )
    return candidate > fromMs ? candidate : candidate + 24 * 60 * 60_000
  }

  if (schedule.kind === 'weekly') {
    const dayOffset = ((schedule.dayOfWeekUTC ?? 1) - from.getUTCDay() + 7) % 7
    let candidate = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + dayOffset,
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
    )
    if (candidate <= fromMs) candidate += 7 * 24 * 60 * 60_000
    return candidate
  }

  const targetDay = schedule.dayOfMonthUTC ?? 1
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const year = from.getUTCFullYear()
    const month = from.getUTCMonth() + monthOffset
    const day = Math.min(targetDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
    const candidate = Date.UTC(
      year,
      month,
      day,
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
    )
    if (candidate > fromMs) return candidate
  }
  return fromMs + 30 * 24 * 60 * 60_000
}
