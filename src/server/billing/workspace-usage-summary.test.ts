import test from 'node:test'
import assert from 'node:assert/strict'

import { workspaceUsageSummary } from './workspace-usage-summary'

const plan = { planKind: 'paid' as const, autoTopUpSpentThisPeriodCents: 0 }

test('the list adds up to what the balance says was used, with an Earlier usage line for the rest', () => {
  const usage = workspaceUsageSummary(
    { totals: [{ resource: 'models', cents: 1_236, count: 151, tokens: 0, seconds: 0 }], truncated: false },
    plan,
    1,
    1_262,
  )
  assert.equal(usage.totalCents, 1_262)
  assert.deepEqual(usage.lines.map((line) => [line.key, line.cents]), [['models', 1_236], ['earlier', 26]])
})

test('no Earlier usage line when the itemized lines already match', () => {
  const usage = workspaceUsageSummary(
    { totals: [{ resource: 'web_search', cents: 40, count: 3, tokens: 0, seconds: 0 }], truncated: false },
    plan,
    1,
    40.4,
  )
  assert.deepEqual(usage.lines.map((line) => line.key), ['web_search'])
})
