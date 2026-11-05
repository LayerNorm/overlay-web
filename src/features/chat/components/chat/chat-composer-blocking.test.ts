import assert from 'node:assert/strict'
import test from 'node:test'
import { isTextModelLocked, resolveEntitlementDerived } from '@/components/providers/useWorkspaceTextModelAccess'
import {
  CONNECTION_UNAVAILABLE_NOTICE,
  getBillingAccessNotice,
  getBlockedSendNotice,
  hasUnavailableByokModel,
  shouldShowPaidModelReplacement,
} from './chat-composer-blocking'

test('an unavailable BYOK model keeps the composer and shows connection guidance', () => {
  const connectionUnavailable = hasUnavailableByokModel({
    chatPrefsHydrated: true,
    modelCatalogReady: true,
    selectableTextModels: [],
    selectedActModel: 'byok/connection-id/gpt-5.6-luna',
    selectedModels: ['byok/connection-id/gpt-5.6-luna'],
  })

  assert.equal(connectionUnavailable, true)
  assert.equal(shouldShowPaidModelReplacement({
    billingAccessNotice: null,
    isBudgetExhaustedPaid: false,
    premiumModelBlocked: false,
  }), false)
  assert.equal(getBlockedSendNotice({
    connectionUnavailable,
    isBudgetExhaustedPaid: false,
    premiumModelBlocked: false,
  }), CONNECTION_UNAVAILABLE_NOTICE)
})

test('an unfunded workspace requires subscription without offering free-model fallback', () => {
  assert.equal(shouldShowPaidModelReplacement({
    billingAccessNotice: null,
    isBudgetExhaustedPaid: false,
    premiumModelBlocked: true,
  }), true)
  assert.equal(getBlockedSendNotice({
    connectionUnavailable: false,
    isBudgetExhaustedPaid: false,
    premiumModelBlocked: true,
  }), 'Subscribe to this workspace before starting work.')
})

test('unresolved workspace access keeps the composer without allowing sends or claiming a billing denial', () => {
  const access = resolveEntitlementDerived(null, true, false)
  const premiumModelBlocked = isTextModelLocked('openai/gpt-5.4-mini', access.isModelAccessRestricted)
  assert.equal(premiumModelBlocked, true)
  for (const loading of [true, false]) {
    const billingAccessNotice = getBillingAccessNotice({ billingEnabled: true, hasEntitlements: false, loading })
    assert.equal(billingAccessNotice, loading
      ? 'Checking workspace access...'
      : 'Workspace access could not be verified. Reload to try again.')
    assert.equal(shouldShowPaidModelReplacement({
      billingAccessNotice,
      premiumModelBlocked,
      isBudgetExhaustedPaid: access.isBudgetExhaustedPaid,
    }), false)
  }
})

test('known entitlements and billing-disabled installations do not show an access-loading notice', () => {
  for (const loading of [true, false]) {
    assert.equal(getBillingAccessNotice({ billingEnabled: true, hasEntitlements: true, loading }), null)
    assert.equal(getBillingAccessNotice({ billingEnabled: false, hasEntitlements: false, loading }), null)
  }
})
