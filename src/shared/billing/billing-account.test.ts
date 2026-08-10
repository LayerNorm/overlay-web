import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BILLING_CREDITS_PER_CENT,
  CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS,
  CURRENT_BILLING_ACCOUNT_PRICING_VERSION,
  assertBillingAccountOwnership,
  billingCreditsToCents,
  centsToBillingCredits,
} from './billing-account'

test('billing accounts preserve the current 25 percent markup policy', () => {
  assert.equal(CURRENT_BILLING_ACCOUNT_PRICING_VERSION, 'markup_25_v1')
  assert.equal(CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS, 2_500)
})

test('credit presentation converts without changing internal cent accounting', () => {
  assert.equal(BILLING_CREDITS_PER_CENT, 10)
  assert.equal(centsToBillingCredits(800), 8_000)
  assert.equal(billingCreditsToCents(8_000), 800)
})

test('personal and workspace billing accounts have exactly one owner dimension', () => {
  assert.doesNotThrow(() => assertBillingAccountOwnership({ scope: 'personal', userId: 'user_1' }))
  assert.doesNotThrow(() => assertBillingAccountOwnership({ scope: 'workspace', workspaceId: 'workspace_1' }))
  assert.throws(() => assertBillingAccountOwnership({
    scope: 'workspace',
    userId: 'user_1',
    workspaceId: 'workspace_1',
  }), /billing_account_owner_mismatch/)
  assert.throws(() => assertBillingAccountOwnership({ scope: 'personal' }), /billing_account_owner_mismatch/)
})
