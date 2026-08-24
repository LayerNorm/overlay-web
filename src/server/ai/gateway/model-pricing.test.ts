import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateGatewayEmbeddingCostOrNull,
  calculateGatewayImageCostOrNull,
  calculateGatewayLanguageTokenCostOrNull,
  calculateGatewayVideoCostOrNull,
  IMAGE_GENERATION_RESERVATION_USAGE,
  isExplicitFreeModel,
  isPremiumModel,
} from '@/shared/ai/gateway/model-pricing'

test('language pricing uses Gateway per-token rates', () => {
  const cost = calculateGatewayLanguageTokenCostOrNull({
    input: '0.0000003',
    input_cache_read: '0.00000006',
    output: '0.0000012',
  }, 1_000_000, 100_000, 250_000)

  assert.equal(cost, 0.576)
})

test('tiered and cached token pricing are applied', () => {
  const pricing = {
    input: '0.000001',
    input_cache_read: '0.0000001',
    output: '0.000002',
  }
  const uncached = calculateGatewayLanguageTokenCostOrNull(pricing, 300_000, 0, 1_000)
  const cached = calculateGatewayLanguageTokenCostOrNull(pricing, 300_000, 300_000, 1_000)
  assert.ok(uncached !== null && uncached > 0)
  assert.ok(cached !== null && cached > 0)
  assert.ok(cached < uncached)
})

test('missing API pricing fails closed', () => {
  assert.equal(calculateGatewayLanguageTokenCostOrNull({}, 1000, 0, 1000), null)
  assert.equal(calculateGatewayEmbeddingCostOrNull({}, 1000), null)
  assert.equal(calculateGatewayImageCostOrNull('unknown/image-model', {}), null)
  assert.equal(calculateGatewayVideoCostOrNull({}, 8), null)
})

test('media and embedding calculators use Gateway fields', () => {
  assert.equal(calculateGatewayImageCostOrNull('example/image', { image: '0.04' }), 0.04)
  assert.equal(calculateGatewayVideoCostOrNull({
    video_duration_pricing: [{ cost_per_second: '0.15' }],
  }, 8), 1.2)
  assert.equal(calculateGatewayEmbeddingCostOrNull({ input: '0.00000002' }, 1_000), 0.00002)
})

test('image pricing supports Gateway token rates and requires measured or reserved usage', () => {
  const pricing = {
    input: '0.000005',
    output: '0.000032',
  }
  assert.equal(calculateGatewayImageCostOrNull('openai/gpt-image-1.5', pricing), null)
  assert.equal(
    calculateGatewayImageCostOrNull('openai/gpt-image-1.5', pricing, {
      inputTokens: 16,
      outputTokens: 389,
    }),
    0.012528,
  )
  assert.ok(
    (calculateGatewayImageCostOrNull(
      'openai/gpt-image-1.5',
      pricing,
      IMAGE_GENERATION_RESERVATION_USAGE,
    ) ?? 0) > 0,
  )
})

test('only explicit free models bypass premium usage', () => {
  assert.equal(isExplicitFreeModel('openrouter/free'), true)
  assert.equal(isPremiumModel('openrouter/free'), false)
  assert.equal(isExplicitFreeModel('example/new-gateway-model'), false)
  assert.equal(isPremiumModel('example/new-gateway-model'), true)
})
