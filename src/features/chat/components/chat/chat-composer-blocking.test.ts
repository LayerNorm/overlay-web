import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONNECTION_UNAVAILABLE_NOTICE,
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
    isBudgetExhaustedPaid: false,
    premiumModelBlocked: true,
  }), true)
  assert.equal(getBlockedSendNotice({
    connectionUnavailable: false,
    isBudgetExhaustedPaid: false,
    premiumModelBlocked: true,
  }), 'Subscribe to this workspace before starting work.')
})
