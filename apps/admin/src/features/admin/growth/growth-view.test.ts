import assert from 'node:assert/strict'
import test from 'node:test'

import type { AdminGrowthDay } from '@/shared/admin-types'
import { change, formatValue, growthGroups, growthWeeks, retentionRate } from './growth-view'

function day(index: number, values: Partial<AdminGrowthDay> = {}): AdminGrowthDay {
  const date = new Date(Date.UTC(2026, 2, 1 + index)).toISOString().slice(0, 10)
  return {
    day: date, usersCreated: 0, tasksCreated: 0, agentsCreated: 0, automationsCreated: 0, filesCreated: 0, filesEdited: 0,
    threadsCreated: 0, messagesSent: 0, automationRuns: 0, automationRunsSucceeded: 0, automationRunsFailed: 0, topUps: 0,
    topUpCents: 0, usageCents: 0, sandboxSeconds: 0, activeUsers: 0, weeklyActiveUsers: 0, monthlyActiveUsers: 0,
    newPaidSubscriptions: 0, newPaidApproximate: 0, computedAt: 0, ...values,
  }
}

test('weeks are complete seven-day windows ending on the last counted day', () => {
  const days = Array.from({ length: 16 }, (_, index) => day(index, { messagesSent: 1, weeklyActiveUsers: index }))
  const weeks = growthWeeks(days)
  assert.deepEqual(weeks.map((week) => week.days.length), [2, 7, 7])
  assert.equal(weeks.at(-1)!.endDay, days.at(-1)!.day)

  const metrics = growthGroups(weeks).flatMap((group) => group.metrics)
  assert.deepEqual(metrics.find((metric) => metric.key === 'messagesSent')!.values, [2, 7, 7])
  // Weekly actives is already a rolling count, so it is read on the window's last day, not summed.
  assert.deepEqual(metrics.find((metric) => metric.key === 'weeklyActiveUsers')!.values, [1, 8, 15])
})

test('paid subscriptions use the newest snapshot in the week and stay empty without one', () => {
  const days = [
    ...Array.from({ length: 7 }, (_, index) => day(index)),
    ...Array.from({ length: 7 }, (_, index) => day(7 + index, index < 5 ? { paidSubscriptions: 3 + index } : {})),
  ]
  const paid = growthGroups(growthWeeks(days)).flatMap((group) => group.metrics).find((metric) => metric.key === 'paidSubscriptions')!
  assert.deepEqual(paid.values, [null, 7])
})

test('change, money and retention formatting', () => {
  assert.equal(change([10, 15]), 50)
  assert.equal(change([0, 4]), null)
  assert.equal(change([null, 4]), null)
  assert.equal(formatValue(12_345, 'cents'), '$123.45')
  assert.equal(formatValue(40_120, 'cents'), '$401.20')
  assert.equal(formatValue(182_450, 'cents'), '$1,825')
  assert.equal(formatValue(null, 'count'), '—')
  const cohort = { weekStart: '2026-03-02', users: 4, w1Active: 3, w4Active: 1, w1Final: true, w4Final: false }
  assert.equal(retentionRate(cohort, 'w1'), '75%')
  assert.equal(retentionRate(cohort, 'w4'), '—')
})
