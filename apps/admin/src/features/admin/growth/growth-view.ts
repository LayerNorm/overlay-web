import type { AdminGrowthCohort, AdminGrowthDay } from '@/shared/admin-types'

/**
 * Turns the daily growth rows into the panel's weekly view. Weeks are rolling
 * seven-day windows ending on the last counted day, so the newest week is
 * always complete.
 */

export const GROWTH_WEEKS = 12

export type GrowthWeek = {
  /** Last day of the window. */
  endDay: string
  days: AdminGrowthDay[]
}

export type GrowthMetric = {
  key: string
  label: string
  /** One value per week, oldest first; null when a week has no data for it. */
  values: (number | null)[]
  format: 'count' | 'cents'
  detail?: string
}

/** Day fields that are always a number. */
type DayField = Exclude<keyof AdminGrowthDay, 'day' | 'paidSubscriptions'>

export function growthWeeks(days: AdminGrowthDay[], weeks = GROWTH_WEEKS): GrowthWeek[] {
  const result: GrowthWeek[] = []
  for (let index = 0; index < weeks; index += 1) {
    const end = days.length - index * 7
    if (end <= 0) break
    const window = days.slice(Math.max(0, end - 7), end)
    result.unshift({ endDay: window.at(-1)!.day, days: window })
  }
  return result
}

function sum(week: GrowthWeek, field: DayField): number {
  return week.days.reduce((total, day) => total + day[field], 0)
}

/** The value on the window's last day, for numbers that are already a rolling count. */
function last(week: GrowthWeek, field: DayField): number | null {
  const value = week.days.at(-1)?.[field]
  return typeof value === 'number' ? value : null
}

const summed = (key: DayField, label: string, weeks: GrowthWeek[], format: GrowthMetric['format'] = 'count'): GrowthMetric => ({
  key, label, format, values: weeks.map((week) => sum(week, key)),
})

export function growthGroups(weeks: GrowthWeek[]): { title: string; metrics: GrowthMetric[] }[] {
  const latest = weeks.at(-1)
  const failed = latest ? sum(latest, 'automationRunsFailed') : 0
  const approximate = latest ? sum(latest, 'newPaidApproximate') : 0
  return [
    {
      title: 'Created',
      metrics: [
        summed('tasksCreated', 'Tasks', weeks),
        summed('agentsCreated', 'Agents', weeks),
        summed('automationsCreated', 'Automations', weeks),
        summed('filesCreated', 'Files', weeks),
      ],
    },
    {
      title: 'Work',
      metrics: [
        summed('threadsCreated', 'Threads', weeks),
        summed('messagesSent', 'Messages', weeks),
        { ...summed('automationRuns', 'Automation runs', weeks), detail: failed ? `${failed} failed` : undefined },
        summed('filesEdited', 'Files edited', weeks),
      ],
    },
    {
      title: 'Usage',
      metrics: [
        summed('usersCreated', 'New users', weeks),
        { key: 'weeklyActiveUsers', label: 'Weekly active', format: 'count', values: weeks.map((week) => last(week, 'weeklyActiveUsers')) },
        {
          ...summed('newPaidSubscriptions', 'New paid', weeks),
          detail: approximate ? `${approximate} dated approximately` : undefined,
        },
        { key: 'paidSubscriptions', label: 'Paid subscriptions', format: 'count', values: weeks.map((week) => latestSnapshot(week)) },
        summed('topUpCents', 'Top-ups', weeks, 'cents'),
        summed('usageCents', 'Spend', weeks, 'cents'),
      ],
    },
  ]
}

/** Paid subscriptions are only snapshotted on live nights, so use the newest snapshot in the week. */
function latestSnapshot(week: GrowthWeek): number | null {
  for (let index = week.days.length - 1; index >= 0; index -= 1) {
    const value = week.days[index].paidSubscriptions
    if (value !== undefined) return value
  }
  return null
}

export function headline(weeks: GrowthWeek[]) {
  const pick = (key: string) => growthGroups(weeks).flatMap((group) => group.metrics).find((metric) => metric.key === key)!
  return [pick('weeklyActiveUsers'), pick('usersCreated'), pick('messagesSent'), pick('paidSubscriptions')]
}

/** Week-over-week change as a whole percent, or null when there is nothing to compare. */
export function change(values: (number | null)[]): number | null {
  const current = values.at(-1)
  const previous = values.at(-2)
  if (current == null || previous == null || previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export function formatValue(value: number | null, format: GrowthMetric['format']): string {
  if (value === null) return '—'
  if (format === 'cents') {
    // Whole dollars from $1,000 up; cents below, always both digits.
    const digits = value >= 100_000 ? 0 : 2
    return `$${(value / 100).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`
  }
  return value.toLocaleString('en-US')
}

export function retentionRate(cohort: AdminGrowthCohort, window: 'w1' | 'w4'): string {
  const final = window === 'w1' ? cohort.w1Final : cohort.w4Final
  if (!final || cohort.users === 0) return '—'
  const active = window === 'w1' ? cohort.w1Active : cohort.w4Active
  return `${Math.round((active / cohort.users) * 100)}%`
}

/** "Mar 2" for a UTC day. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
