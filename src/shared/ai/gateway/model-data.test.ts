import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getEnabledChatModels,
  getModelsByIntelligence,
  getModel,
  MODEL_RECOMMENDATIONS,
  getGatewayCatalogRevision,
  IMAGE_MODELS,
  VIDEO_MODELS,
  modelUsesAiGatewayTransport,
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
  }, {
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

  const models = getEnabledChatModels([
    'openrouter/free',
    'overlay-free',
    DYNAMIC_MODEL_ID,
  ], false)

  assert.deepEqual(models.map((model) => model.id), [
    DYNAMIC_MODEL_ID,
    'overlay-free',
    'openrouter/free',
  ])
})

test('registers only priced live image and video models', () => {
  registerGatewayCatalogModels([
    {
      id: 'vendor/priced-image',
      gatewayId: 'vendor/priced-image',
      name: 'Priced Image',
      type: 'image',
      provider: 'vendor',
      tags: ['image-generation'],
      pricing: { image: '0.04' },
    },
    {
      id: 'vendor/unpriced-image',
      gatewayId: 'vendor/unpriced-image',
      name: 'Unpriced Image',
      type: 'image',
      provider: 'vendor',
      tags: ['image-generation'],
      pricing: {},
    },
    {
      id: 'vendor/priced-video-i2v',
      gatewayId: 'vendor/priced-video-i2v',
      name: 'Priced Video I2V',
      type: 'video',
      provider: 'vendor',
      tags: ['video-input'],
      pricing: { video_duration_pricing: [{ cost_per_second: '0.08' }] },
    },
  ])

  assert.deepEqual(IMAGE_MODELS.map((model) => model.id), ['vendor/priced-image'])
  assert.deepEqual(VIDEO_MODELS.map((model) => model.id), ['vendor/priced-video-i2v'])
  assert.deepEqual(VIDEO_MODELS[0]?.subModes, ['image-to-video'])
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

test('enabled ids registered from the gateway remain visible outside the static catalog', () => {
  const before = getGatewayCatalogRevision()
  const models = getEnabledChatModels(
    ['moonshotai/kimi-k2.6', UNKNOWN_ENABLED_ID, 'openrouter/free'],
    false,
  )
  assert.ok(models.some((model) => model.id === UNKNOWN_ENABLED_ID))
  assert.ok(models.some((model) => model.id === 'moonshotai/kimi-k2.6'))
  assert.equal(models.length, 3)
  // Re-registering the catalog should bump revision so React can refresh metadata.
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

test('enabled subscription models bypass the legacy global model whitelist', () => {
  const subscriptionModelId = 'byok/subscription_1/openai/gpt-4.1'
  registerByokModels([{
    _id: 'subscription_1',
    authKind: 'subscription',
    subscriptionProvider: 'codex',
    providerId: 'subscription:codex',
    endpoint: '',
    displayName: 'Personal ChatGPT',
    enabledModelIds: ['openai/gpt-4.1'],
    discoveredModelsJson: JSON.stringify({ data: [{ id: 'openai/gpt-4.1' }] }),
    status: 'active',
    isDefault: false,
    isDeletable: true,
  }])

  const models = getEnabledChatModels(['openrouter/free'], true)
  assert.ok(models.some((model) => model.id === subscriptionModelId))
  assert.equal(models.find((model) => model.id === subscriptionModelId)?.sourceLabel, 'Subscription')

  registerByokModels([])
})

test('modelUsesAiGatewayTransport only flags models served by the metered gateway key', () => {
  assert.equal(modelUsesAiGatewayTransport('anthropic/claude-opus-4.7'), true)
  assert.equal(modelUsesAiGatewayTransport('overlay-free'), false)
  assert.equal(modelUsesAiGatewayTransport('openrouter/free'), false)
  assert.equal(modelUsesAiGatewayTransport('byok/connection_1/vendor/model-a'), false)
})

test('provider catalog includes older non-recommended models without enabling them', () => {
  const oldModel = 'moonshotai/kimi-k2-thinking'
  registerGatewayCatalogModels([{
    id: oldModel, gatewayId: oldModel, name: 'Older Kimi', type: 'language',
    provider: 'moonshotai', tags: [], pricing: { input: '0.0000001', output: '0.0000002' },
    inputPricePerMillion: 0.1, outputPricePerMillion: 0.2,
  }])
  assert.ok(getModelsByIntelligence(false).some((model) => model.id === oldModel))
  assert.equal(getModel(oldModel)?.id, oldModel)
  assert.ok(!MODEL_RECOMMENDATIONS.text.some((id: string) => id === oldModel))
  assert.equal(getModelsByIntelligence(true)[0].id, 'overlay-free')
})
