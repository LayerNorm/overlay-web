import assert from 'node:assert/strict'
import test from 'node:test'

import { overlayProviderDiscoveryModels } from './overlay-provider-models'

test('Overlay provider discovery includes gateway catalog models and free models', () => {
  const models = overlayProviderDiscoveryModels([{
    id: 'openai/gpt-5.4',
    gatewayId: 'openai/gpt-5.4',
    name: 'GPT 5.4',
    type: 'language',
    provider: 'openai',
    tags: [],
    pricing: {
      input: '0.000001',
      output: '0.000008',
    },
    inputPricePerMillion: 1,
    outputPricePerMillion: 8,
  }])

  assert.ok(models.some((model) => model.id === 'openai/gpt-5.4' && model.name === 'GPT 5.4'))
  assert.ok(models.some((model) => model.id === 'openrouter/free' && model.name === 'Free Router'))
})

test('Overlay provider discovery dedupes free models already present in gateway catalog', () => {
  const models = overlayProviderDiscoveryModels([{
    id: 'openrouter/free',
    gatewayId: 'openrouter/free',
    name: 'Gateway Free Router',
    type: 'language',
    provider: 'openrouter',
    tags: [],
    pricing: {
      input: '0',
      output: '0',
    },
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  }])

  assert.equal(models.filter((model) => model.id === 'openrouter/free').length, 1)
  assert.equal(models.find((model) => model.id === 'openrouter/free')?.name, 'Gateway Free Router')
})
