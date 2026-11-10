import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceBudgetLow, workspaceBudgetShortfallCents, workspaceExecutionAccess } from './execution-access.ts'

const funded = {
  billingEnabled: true, accountStatus: 'active', remainingCents: 800, now: 100,
  subscription: { planKind: 'paid', status: 'active', paidPeriodStart: 50, paidPeriodEnd: 150 },
}

test('requires a verified paid period, not a plan label or balance', () => {
  assert.equal(workspaceExecutionAccess({ ...funded, subscription: null }).state, 'subscription_required')
  assert.equal(workspaceExecutionAccess({ ...funded, subscription: { planKind: 'paid', status: 'active' } }).state, 'payment_pending')
  assert.equal(workspaceExecutionAccess(funded).state, 'ready')
  for (const status of ['trialing', 'incomplete', 'unknown']) {
    assert.equal(workspaceExecutionAccess({ ...funded, subscription: { ...funded.subscription, status } }).canExecute, false)
  }
})

test('expired, future and suspended periods cannot execute', () => {
  for (const now of [49, 150]) assert.equal(workspaceExecutionAccess({ ...funded, now }).canExecute, false)
  for (const status of ['past_due', 'canceled', 'unpaid', 'paused']) {
    assert.equal(workspaceExecutionAccess({ ...funded, subscription: { ...funded.subscription, status } }).state, 'billing_suspended')
  }
  assert.equal(workspaceExecutionAccess({ ...funded, accountStatus: 'suspended' }).state, 'billing_suspended')
})

test('new work needs budget but an existing hold does not revoke eligibility', () => {
  assert.equal(workspaceExecutionAccess({ ...funded, remainingCents: 0 }).state, 'budget_exhausted')
  assert.equal(workspaceExecutionAccess({ ...funded, remainingCents: 0, checkBudget: false }).state, 'ready')
  assert.equal(workspaceExecutionAccess({ ...funded, remainingCents: NaN }).canExecute, false)
})

test('billing-disabled administrators retain explicit execution policy', () => {
  assert.equal(workspaceExecutionAccess({ billingEnabled: false, remainingCents: 0 }).state, 'ready')
})

test('work stops once less than 2% of the workspace budget is left, using the real balance', () => {
  assert.equal(workspaceBudgetLow({ remainingCents: 2_000, totalCents: 100_000 }), false)
  assert.equal(workspaceBudgetLow({ remainingCents: 1_999, totalCents: 100_000 }), true)
  assert.equal(workspaceBudgetLow({ remainingCents: 0, totalCents: 0 }), true)
  assert.equal(workspaceBudgetLow({ remainingCents: 5 }), false)
  assert.equal(workspaceExecutionAccess({ ...funded, remainingCents: 19, totalCents: 1_000 }).state, 'budget_exhausted')
  assert.equal(workspaceExecutionAccess({ ...funded, remainingCents: 20, totalCents: 1_000 }).state, 'ready')
  assert.equal(workspaceExecutionAccess({ ...funded, remainingCents: 19, totalCents: 1_000, checkBudget: false }).state, 'ready')
  assert.equal(workspaceBudgetShortfallCents({ remainingCents: 500, totalCents: 100_000 }), 1_500)
  assert.equal(workspaceBudgetShortfallCents({ remainingCents: 0, totalCents: 0 }), 1)
})
