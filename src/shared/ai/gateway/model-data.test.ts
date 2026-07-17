import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getEnabledChatModels,
  getGatewayCatalogRevision,
  registerGatewayCatalogModels,
} from './model-data'

const DYNAMIC_MODEL_ID = 'example/new-premium-model'
const UNKNOWN_ENABLED_ID = 'vendor/not-yet-in-static-catalog'

test('new gateway models appear before the free section for paid users', () => {
  registerGatewayCatalogModels([{
    id: DYNAMIC_MODEL_ID,
    gatewayId: DYNAMIC_MODEL_ID,
    name: 'New Premium Model',
    type: 'language',
    provider: 'example',
    tags: [],
    pricing: {
      input: '0.0000003',
      output: '0.0000012',
    },
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 1.2,
  }])

  const models = getEnabledChatModels([
    'openrouter/free',
    DYNAMIC_MODEL_ID,
  ], false)

  assert.deepEqual(models.map((model) => model.id), [
    DYNAMIC_MODEL_ID,
    'openrouter/free',
  ])
})

test('free models remain first for free-tier users', () => {
  const models = getEnabledChatModels([
    DYNAMIC_MODEL_ID,
    'openrouter/free',
  ], true)

  assert.deepEqual(models.map((model) => model.id), [
    'openrouter/free',
    DYNAMIC_MODEL_ID,
  ])
})

test('enabled ids missing from the static catalog still appear (provisional)', () => {
  const before = getGatewayCatalogRevision()
  const models = getEnabledChatModels(
    ['moonshotai/kimi-k2.6', UNKNOWN_ENABLED_ID, 'openrouter/free'],
    false,
  )
  assert.ok(models.some((model) => model.id === UNKNOWN_ENABLED_ID))
  assert.ok(models.some((model) => model.id === 'moonshotai/kimi-k2.6'))
  assert.equal(models.length, 3)
  // Registering the catalog should bump revision so React can refresh metadata.
  registerGatewayCatalogModels([{
    id: UNKNOWN_ENABLED_ID,
    gatewayId: UNKNOWN_ENABLED_ID,
    name: 'Not Yet In Static Catalog',
    type: 'language',
    provider: 'vendor',
    tags: ['vision', 'reasoning'],
    pricing: { input: '0', output: '0' },
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  }])
  assert.ok(getGatewayCatalogRevision() > before)
  const after = getEnabledChatModels(
    ['moonshotai/kimi-k2.6', UNKNOWN_ENABLED_ID, 'openrouter/free'],
    false,
  )
  const resolved = after.find((model) => model.id === UNKNOWN_ENABLED_ID)
  assert.equal(resolved?.name, 'Not Yet In Static Catalog')
  assert.equal(resolved?.supportsVision, true)
})
