/**
 * Shared automation scheduling utilities — used by both the Convex cron path
 * (legacy) and the Workflow SDK sleep()-based scheduling workflow (Step 5).
 *
 * This module is isomorphic (no server-only imports) so it can be imported
 * from Convex handlers, workflow files, and server routes alike.
 */

/**
 * Automation schedule type — mirrors the one in @overlay/app-core/contracts.
 * Inlined here so this module can be imported from Convex (which cannot
 * resolve @overlay/* package aliases).
 */
export type AutomationSchedule =
  | { kind: 'interval'; intervalMinutes?: number }
  | { kind: 'daily'; hourUTC?: number; minuteUTC?: number }
  | { kind: 'weekly'; dayOfWeekUTC?: number; hourUTC?: number; minuteUTC?: number }
  | { kind: 'monthly'; dayOfMonthUTC?: number; hourUTC?: number; minuteUTC?: number }

export const DEFAULT_SCHEDULE: AutomationSchedule = { kind: 'daily', hourUTC: 14, minuteUTC: 0 }
export const MIN_INTERVAL_MINUTES = 15

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function normalizeSchedule(schedule: AutomationSchedule): AutomationSchedule {
  switch (schedule.kind) {
    case 'interval':
      return {
        kind: 'interval',
        intervalMinutes: clampInteger(schedule.intervalMinutes ?? 60, MIN_INTERVAL_MINUTES, 60 * 24 * 365, 60),
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

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * Compute the next scheduled run time (as a UTC epoch ms) for the given
 * schedule, starting from `fromMs`. If `fromMs` is before the next slot,
 * the slot is returned; otherwise the subsequent slot is computed.
 *
 * For `interval` schedules, this is simply `fromMs + intervalMinutes * 60_000`.
 * For `daily`/`weekly`/`monthly`, the next matching UTC slot is found.
 */
export function computeNextRunAt(scheduleInput: AutomationSchedule, fromMs: number): number {
  const schedule = normalizeSchedule(scheduleInput)
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
      0,
      0,
    )
    return candidate > fromMs ? candidate : candidate + 24 * 60 * 60_000
  }

  if (schedule.kind === 'weekly') {
    const today = from.getUTCDay()
    const target = schedule.dayOfWeekUTC ?? 1
    let dayOffset = (target - today + 7) % 7
    let candidate = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + dayOffset,
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
      0,
      0,
    )
    if (candidate <= fromMs) {
      dayOffset += 7
      candidate = Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + dayOffset,
        schedule.hourUTC ?? 9,
        schedule.minuteUTC ?? 0,
        0,
        0,
      )
    }
    return candidate
  }

  // monthly
  const targetDay = schedule.dayOfMonthUTC ?? 1
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const year = from.getUTCFullYear()
    const month = from.getUTCMonth() + monthOffset
    const day = Math.min(targetDay, daysInUtcMonth(year, month))
    const candidate = Date.UTC(
      year,
      month,
      day,
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
      0,
      0,
    )
    if (candidate > fromMs) return candidate
  }

  return fromMs + 30 * 24 * 60 * 60_000
}

/**
 * Compute the duration (in ms) to sleep before the next scheduled run.
 * Clamped to a minimum of 1 second to avoid zero-duration sleeps.
 * Clamped to a maximum of 365 days to avoid overflow issues.
 */
export function msUntilNextRun(schedule: AutomationSchedule, fromMs: number): number {
  const next = computeNextRunAt(schedule, fromMs)
  const delta = next - fromMs
  const MIN_SLEEP_MS = 1_000
  const MAX_SLEEP_MS = 365 * 24 * 60 * 60_000
  return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, delta))
}
