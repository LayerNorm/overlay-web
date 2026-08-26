import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getEnabledChatModels,
  getGatewayCatalogRevision,
  registerByokModels,
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

test('active BYOK models register without replacing hosted models and respect explicit order', () => {
  registerByokModels([{
    _id: 'connection_1',
    providerId: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    displayName: 'Personal OpenRouter',
    enabledModelIds: ['vendor/model-a'],
    discoveredModelsJson: JSON.stringify({ data: [{ id: 'vendor/model-a', name: 'Model A' }] }),
    status: 'active',
    isDefault: false,
    isDeletable: true,
  }])

  const byokId = 'byok/connection_1/vendor/model-a'
  const models = getEnabledChatModels(
    ['openrouter/free', byokId, DYNAMIC_MODEL_ID],
    true,
    [byokId, 'openrouter/free'],
  )
  assert.deepEqual(models.map((model) => model.id), [byokId, 'openrouter/free', DYNAMIC_MODEL_ID])
  assert.equal(models[0]?.provider, 'Personal OpenRouter')

  registerByokModels([])
  assert.equal(getEnabledChatModels(['openrouter/free'], true)[0]?.id, 'openrouter/free')
  assert.equal(getEnabledChatModels([byokId], true).length, 0)
})
