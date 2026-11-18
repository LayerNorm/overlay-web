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
  | ({ kind: 'daily'; hourUTC?: number; minuteUTC?: number } & LocalTime)
  | ({ kind: 'weekdays'; hourUTC?: number; minuteUTC?: number } & LocalTime)
  | ({ kind: 'weekly'; dayOfWeekUTC?: number; hourUTC?: number; minuteUTC?: number; dayOfWeek?: number } & LocalTime)
  | ({ kind: 'monthly'; dayOfMonthUTC?: number; hourUTC?: number; minuteUTC?: number; dayOfMonth?: number } & LocalTime)

/**
 * Wall-clock time in the automation's own time zone. When `hour` is set the
 * schedule follows that zone, daylight saving included; the UTC fields are
 * kept only for readers of older rows.
 */
type LocalTime = { hour?: number; minute?: number }

export const DEFAULT_SCHEDULE: AutomationSchedule = { kind: 'daily', hourUTC: 14, minuteUTC: 0 }
export const MIN_INTERVAL_MINUTES = 15

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function normalizeLocal(schedule: LocalTime): LocalTime {
  if (schedule.hour === undefined) return {}
  return { hour: clampInteger(schedule.hour, 0, 23, 9), minute: clampInteger(schedule.minute ?? 0, 0, 59, 0) }
}

export function normalizeSchedule(schedule: AutomationSchedule): AutomationSchedule {
  switch (schedule.kind) {
    case 'interval':
      return {
        kind: 'interval',
        intervalMinutes: clampInteger(schedule.intervalMinutes ?? 60, MIN_INTERVAL_MINUTES, 60 * 24 * 365, 60),
      }
    case 'daily':
    case 'weekdays':
      return {
        kind: schedule.kind,
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
        ...normalizeLocal(schedule),
      }
    case 'weekly':
      return {
        kind: 'weekly',
        dayOfWeekUTC: clampInteger(schedule.dayOfWeekUTC ?? 1, 0, 6, 1),
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
        ...(schedule.hour !== undefined ? { dayOfWeek: clampInteger(schedule.dayOfWeek ?? 1, 0, 6, 1) } : {}),
        ...normalizeLocal(schedule),
      }
    case 'monthly':
      return {
        kind: 'monthly',
        dayOfMonthUTC: clampInteger(schedule.dayOfMonthUTC ?? 1, 1, 31, 1),
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
        ...(schedule.hour !== undefined ? { dayOfMonth: clampInteger(schedule.dayOfMonth ?? 1, 1, 31, 1) } : {}),
        ...normalizeLocal(schedule),
      }
  }
}

function isLocalSchedule(schedule: AutomationSchedule): schedule is Exclude<AutomationSchedule, { kind: 'interval' }> & { hour: number } {
  return schedule.kind !== 'interval' && schedule.hour !== undefined
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneParts(ms: number, timeZone: string) {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    })
    zoneFormatters.set(timeZone, formatter)
  }
  const parts: Record<string, number> = {}
  for (const part of formatter.formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute }
}

/** The UTC instant at which the wall clock in `timeZone` shows this date and time. */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let guess = wall
  for (let i = 0; i < 2; i += 1) {
    const shown = zoneParts(guess, timeZone)
    guess += wall - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute)
  }
  return guess
}

export function isValidTimeZone(timeZone: string | undefined): timeZone is string {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch (_error) {
    return false
  }
}

function nextLocalRunAt(schedule: Exclude<AutomationSchedule, { kind: 'interval' }> & { hour: number }, fromMs: number, timeZone: string): number {
  const today = zoneParts(fromMs, timeZone)
  for (let offset = 0; offset < 400; offset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    const weekday = date.getUTCDay()
    if (schedule.kind === 'weekdays' && (weekday === 0 || weekday === 6)) continue
    if (schedule.kind === 'weekly' && weekday !== (schedule.dayOfWeek ?? 1)) continue
    if (schedule.kind === 'monthly' && day !== Math.min(schedule.dayOfMonth ?? 1, daysInUtcMonth(year, month - 1))) continue
    const candidate = zonedTimeToUtc(year, month, day, schedule.hour, schedule.minute ?? 0, timeZone)
    if (candidate > fromMs) return candidate
  }
  return fromMs + 24 * 60 * 60_000
}

/**
 * Fills the UTC fields of a local-time schedule from its time zone as of `nowMs`,
 * so older readers that only know UTC fields still show a sensible time.
 */
export function withUtcFields(scheduleInput: AutomationSchedule, timeZone: string | undefined, nowMs: number): AutomationSchedule {
  const schedule = normalizeSchedule(scheduleInput)
  if (!isLocalSchedule(schedule) || !isValidTimeZone(timeZone)) return schedule
  const utc = new Date(nextLocalRunAt(schedule, nowMs, timeZone))
  const time = { hourUTC: utc.getUTCHours(), minuteUTC: utc.getUTCMinutes() }
  if (schedule.kind === 'weekly') return { ...schedule, ...time, dayOfWeekUTC: utc.getUTCDay() }
  if (schedule.kind === 'monthly') return { ...schedule, ...time, dayOfMonthUTC: utc.getUTCDate() }
  return { ...schedule, ...time }
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
 * A schedule with local `hour`/`minute` follows `timeZone` (daylight saving
 * included); an older one with only UTC fields finds the next UTC slot.
 */
export function computeNextRunAt(scheduleInput: AutomationSchedule, fromMs: number, timeZone?: string): number {
  const schedule = normalizeSchedule(scheduleInput)

  if (schedule.kind === 'interval') {
    return fromMs + (schedule.intervalMinutes ?? 60) * 60_000
  }

  if (isLocalSchedule(schedule)) {
    return nextLocalRunAt(schedule, fromMs, isValidTimeZone(timeZone) ? timeZone : 'UTC')
  }
  return nextUtcRunAt(schedule, fromMs)
}

/** The next slot of an older schedule that only has UTC fields. */
function nextUtcRunAt(schedule: Exclude<AutomationSchedule, { kind: 'interval' }>, fromMs: number): number {
  const from = new Date(fromMs)

  if (schedule.kind === 'weekdays') {
    let candidate = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), schedule.hourUTC ?? 9, schedule.minuteUTC ?? 0)
    while (candidate <= fromMs || [0, 6].includes(new Date(candidate).getUTCDay())) candidate += 24 * 60 * 60_000
    return candidate
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
export function msUntilNextRun(schedule: AutomationSchedule, fromMs: number, timeZone?: string): number {
  const next = computeNextRunAt(schedule, fromMs, timeZone)
  const delta = next - fromMs
  const MIN_SLEEP_MS = 1_000
  const MAX_SLEEP_MS = 365 * 24 * 60 * 60_000
  return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, delta))
}
