import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessFreeReceipt, freeEndpointCapabilities, hasZeroPricing } from './overlay-free-policy'

const expected = { transport: 'gateway', modelId: 'example/free', provider: 'example' } as const
const gateway = { cost: '0', gatewayCost: '0', marketCost: '0', surchargeCost: '0',
  routing: { finalProvider: 'example', canonicalSlug: 'example/free' } }

test('free pricing is explicit across every charge, with no numeric underflow', () => {
  assert.ok(hasZeroPricing({ prompt: '0', completion: '0.0', request: 0 }))
  for (const extra of [null, '', '1e-999', -1, '0.0001', {}, false]) {
    assert.equal(hasZeroPricing({ prompt: 0, completion: 0, cache: extra }), false)
  }
  assert.equal(hasZeroPricing({ prompt: 0 }), false)
})

test('gateway receipts require zero total and matching model/provider', () => {
  assert.equal(assessFreeReceipt({ providerMetadata: { gateway } }, expected).safe, true)
  for (const extra of [{ gatewayCost: '.000075' }, { cost: null }, { routing: {} },
    { routing: { ...gateway.routing, finalProvider: 'other' } }, { cost: '1e-999' }]) {
    assert.equal(assessFreeReceipt({ providerMetadata: { gateway: { ...gateway, ...extra } } }, expected).safe, false)
  }
  assert.equal(assessFreeReceipt({ providerMetadata: { gateway: { surchargeCost: 0 } } }, expected).safe, false)
})

test('OpenRouter SDK receipt cost is read from usage metadata', () => {
  const expected = { transport: 'openrouter', modelId: 'openrouter/free', provider: 'openrouter' } as const
  assert.equal(assessFreeReceipt({ providerMetadata: { openrouter: { usage: { cost: 0 } } } }, expected).safe, true)
  assert.equal(assessFreeReceipt({ providerMetadata: { openrouter: { usage: { cost: .01 } } } }, expected).safe, false)
  assert.equal(assessFreeReceipt({}, expected).safe, false)
})

test('capabilities are admitted only with explicit evidence', () => {
  assert.equal(freeEndpointCapabilities({}), null)
  assert.deepEqual(freeEndpointCapabilities({ context_length: 1000, max_completion_tokens: 200,
    tags: ['vision'], supported_parameters: ['tools', 'tool_choice', 'response_format', 'structured_outputs'] }),
  { contextWindow: 1000, maxOutputTokens: 200, supportsTools: true, supportsVision: true, supportsJson: true })
})
