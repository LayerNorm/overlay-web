import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatModelFallbackCandidates } from './model-fallbacks'
import { getModel } from '@/shared/ai/gateway/model-data'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'

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
