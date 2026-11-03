import assert from 'node:assert/strict'
import test from 'node:test'

import { overlayProviderDiscoveryModels } from './overlay-provider-models'

test('Overlay provider discovery keeps paid catalog models and filters retired hosted models', () => {
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
  }, {
    id: 'openrouter/free',
    gatewayId: 'openrouter/free',
    name: 'OpenRouter Free',
    type: 'language',
    provider: 'openrouter',
    tags: [],
    pricing: { input: '0', output: '0' },
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  }, {
    id: 'openrouter/vendor/example:free',
    gatewayId: 'vendor/example:free',
    name: 'Legacy free model',
    type: 'language',
    provider: 'openrouter',
    tags: [],
    pricing: { input: '0', output: '0' },
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
  }])

  assert.deepEqual(models, [{ id: 'openai/gpt-5.4', name: 'GPT 5.4' }])
})
