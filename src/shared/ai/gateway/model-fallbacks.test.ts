import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChatModelFallbackCandidates,
  getLowCreditFallbackAttemptModelIds,
} from './model-fallbacks'
import { getModel } from '@/shared/ai/gateway/model-data'
import { FREE_TIER_AUTO_MODEL_ID, isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'

test('free model fallbacks stay inside the free-tier catalog', () => {
  const fallbacks = getChatModelFallbackCandidates({
    modelId: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
    paid: false,
  })
  assert.equal(fallbacks[0], 'stepfun-ai/step-3.5-flash')
  assert.ok(fallbacks.length > 0)
  assert.ok(fallbacks.every(isFreeTierChatModelId))
  assert.ok(!fallbacks.includes('openrouter/nvidia/nemotron-3-super-120b-a12b:free'))
})

test('paid model fallbacks are strictly cheaper than the selected model', () => {
  const selected = getModel('anthropic/claude-opus-4.7')
  assert.ok(selected?.pricePer1mTokens)
  const fallbacks = getChatModelFallbackCandidates({
    modelId: 'anthropic/claude-opus-4.7',
    paid: true,
  })
  assert.ok(fallbacks.length > 0)
  for (const modelId of fallbacks) {
    const fallback = getModel(modelId)
    assert.ok(fallback?.pricePer1mTokens)
    assert.ok(fallback.pricePer1mTokens < selected.pricePer1mTokens)
    assert.equal(isFreeTierChatModelId(modelId), false)
  }
})

test('paid fallbacks respect zero data retention settings', () => {
  const fallbacks = getChatModelFallbackCandidates({
    modelId: 'anthropic/claude-opus-4.7',
    paid: true,
    onlyAllowZdrModels: true,
  })
  assert.ok(fallbacks.length > 0)
  assert.ok(fallbacks.every((modelId) => getModel(modelId)?.supportsZeroDataRetention === true))
})

test('low-credit attempts lead with free models and keep paid as last resort', () => {
  const attempts = getLowCreditFallbackAttemptModelIds({
    modelId: 'anthropic/claude-opus-4.7',
    paid: true,
    paidFallbackModelIds: ['claude-sonnet-4-6'],
    maxCandidates: 5,
  })
  assert.equal(attempts[0], FREE_TIER_AUTO_MODEL_ID)
  const paidIndex = attempts.indexOf('anthropic/claude-opus-4.7')
  assert.ok(paidIndex > 0)
  assert.ok(attempts.slice(0, paidIndex).every(isFreeTierChatModelId))
  assert.equal(attempts.at(-1), 'claude-sonnet-4-6')
})

test('low-credit attempts dedupe and cap at maxCandidates', () => {
  const attempts = getLowCreditFallbackAttemptModelIds({
    modelId: 'anthropic/claude-opus-4.7',
    paid: true,
    paidFallbackModelIds: ['anthropic/claude-opus-4.7', FREE_TIER_AUTO_MODEL_ID],
    maxCandidates: 3,
  })
  assert.equal(attempts.length, 3)
  assert.equal(new Set(attempts).size, attempts.length)
})

test('low-credit attempts respect zero data retention settings', () => {
  const attempts = getLowCreditFallbackAttemptModelIds({
    modelId: 'anthropic/claude-opus-4.7',
    paid: true,
    onlyAllowZdrModels: true,
  })
  assert.ok(!attempts.includes(FREE_TIER_AUTO_MODEL_ID))
  assert.deepEqual(attempts, ['anthropic/claude-opus-4.7'])
})

test('low-credit attempts keep only vision-capable free models when required', () => {
  const attempts = getLowCreditFallbackAttemptModelIds({
    modelId: 'anthropic/claude-opus-4.7',
    paid: true,
    requiresVision: true,
  })
  const freeIds = attempts.filter(isFreeTierChatModelId)
  assert.ok(freeIds.length > 0)
  assert.ok(freeIds.every((id) => getModel(id)?.supportsVision === true))
})
