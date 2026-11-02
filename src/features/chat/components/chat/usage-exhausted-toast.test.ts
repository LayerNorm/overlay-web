import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkspaceBillingError } from './usage-exhausted-error'

test('workspace billing errors include budget and payment failures', () => {
  assert.equal(isWorkspaceBillingError('workspace budget exhausted'), true)
  assert.equal(isWorkspaceBillingError('Payment required to continue'), true)
  assert.equal(isWorkspaceBillingError('Subscribe to this workspace before execution'), true)
  assert.equal(isWorkspaceBillingError('Connection failed'), false)
})
