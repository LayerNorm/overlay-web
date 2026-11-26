import assert from 'node:assert/strict'
import test from 'node:test'
import { rolledSpendLimitWindow, spendLimitReachedNow, spendLimitUsedNow } from './spend-limit-period'

const window = { periodStart: 100, periodEnd: 200 }

test('a cap counts what was used only inside its period', () => {
  assert.equal(spendLimitUsedNow({ ...window, used: 40, reserved: 5 }, 150), 45)
  assert.equal(spendLimitUsedNow({ ...window, used: 40, reserved: 5 }, 250), 0)
  assert.equal(spendLimitReachedNow({ ...window, used: 50, reserved: 0, limit: 50 }, 150), true)
  assert.equal(spendLimitReachedNow({ ...window, used: 50, reserved: 0, limit: 50 }, 210), false, 'a new period starts fresh')
})

test('a finished period rolls forward by its own length', () => {
  assert.equal(rolledSpendLimitWindow(window, 199), null)
  assert.deepEqual(rolledSpendLimitWindow(window, 200), { periodStart: 200, periodEnd: 300 })
  assert.deepEqual(rolledSpendLimitWindow(window, 455), { periodStart: 400, periodEnd: 500 })
})
