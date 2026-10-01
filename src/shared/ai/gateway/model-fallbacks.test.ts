import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChatModelFallbackCandidates,
  getLowCreditFallbackAttemptModelIds,
} from './model-fallbacks'
import { getModel, registerGatewayCatalogModels } from '@/shared/ai/gateway/model-data'
import { FREE_TIER_AUTO_MODEL_ID, isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'

test('free model fallbacks stay inside the free-tier catalog', () => {
  const fallbacks = getChatModelFallbackCandidates({
    modelId: FREE_TIER_AUTO_MODEL_ID,
    paid: false,
  })
  // The free router is the only free model — it is excluded as a fallback for itself.
  assert.deepEqual(fallbacks, [])
})

// Paid-model prices come from the live AI Gateway catalog, registered at
// runtime; the static curated rows carry no prices. Register a priced slice so
// the paid fallback path runs the same way it does in production.
function registerPricedAnthropicCatalog() {
  const language = (id: string, name: string, input: number, output: number) => ({
    gatewayId: id,
    id,
    inputPricePerMillion: input,
    name,
    outputPricePerMillion: output,
    pricing: {},
    provider: 'anthropic',
    tags: ['vision', 'reasoning'],
    type: 'language' as const,
  })
  registerGatewayCatalogModels([
    language('anthropic/claude-opus-4.7', 'Claude Opus 4.7', 15, 75),
    language('claude-sonnet-4-6', 'Claude Sonnet 4.6', 3, 15),
    language('claude-haiku-4-5', 'Claude Haiku 4.5', 1, 5),
  ])
}

test('paid model fallbacks are strictly cheaper than the selected model', () => {
  registerPricedAnthropicCatalog()
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
  registerPricedAnthropicCatalog()
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
    paidFallbackModelIds: [
      'anthropic/claude-opus-4.7',
      FREE_TIER_AUTO_MODEL_ID,
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ],
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
