import test from 'node:test'
import assert from 'node:assert/strict'

import { maxCharge, priceLines, simulateBill, type BillSettings } from './pricing-sim'

const stop: BillSettings = { deposit: 20, mode: 'stop', topUp: 8, monthlyLimit: 40 }
const go: BillSettings = { ...stop, mode: 'go' }

test('use within the deposit is paid from credit and charges nothing', () => {
  const out = simulateBill(stop, 9)
  assert.deepEqual(out, { creditUsed: 9, charged: 0, topUps: 0, covered: 9, state: 'within' })
})

test('a hard stop pauses at the deposit and never charges', () => {
  const out = simulateBill(stop, 55)
  assert.equal(out.state, 'stopped')
  assert.equal(out.charged, 0)
  assert.equal(out.covered, 20)
})

test('keep going adds top-ups as credit runs out', () => {
  const out = simulateBill(go, 40)
  assert.equal(out.topUps, 3)
  assert.equal(out.charged, 24)
  assert.equal(out.state, 'topped-up')
  assert.equal(out.covered, 40)
})

test('the monthly limit caps top-ups and pauses the rest', () => {
  const out = simulateBill(go, 100)
  assert.equal(out.topUps, 5)
  assert.equal(out.charged, 40)
  assert.equal(out.covered, 60)
  assert.equal(out.state, 'limit')
})

test('maxCharge is the deposit, plus whole top-ups up to the limit', () => {
  assert.equal(maxCharge(stop), 20)
  assert.equal(maxCharge(go), 60)
  assert.equal(maxCharge({ ...go, topUp: 15 }), 50)
})

test('itemized lines always add up to what was covered', () => {
  for (const covered of [0, 3.62, 9, 20, 59.5]) {
    const total = priceLines(covered).reduce((sum, line) => sum + line.cents, 0)
    assert.equal(total, Math.round(covered * 100))
  }
})
