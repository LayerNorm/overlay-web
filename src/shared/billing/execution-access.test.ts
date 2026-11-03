import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceExecutionAccess } from './execution-access.ts'

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
