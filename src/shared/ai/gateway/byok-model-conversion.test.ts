import assert from 'node:assert/strict'
import test from 'node:test'

import {
  byokConnectionsToChatModels,
  parseByokModelId,
  parseDiscoveredModels,
} from './byok-model-conversion'

test('BYOK model ids preserve provider model ids containing slashes', () => {
  assert.deepEqual(parseByokModelId('byok/connection_1/vendor/model-a'), {
    connectionId: 'connection_1',
    rawModelId: 'vendor/model-a',
  })
  assert.equal(parseByokModelId('byok/connection_1'), null)
  assert.equal(parseByokModelId('byok/bad connection/vendor/model-a'), null)
  assert.equal(parseByokModelId(`byok/connection_1/${'x'.repeat(101)}`), null)
})

test('discovered model parsing rejects unsafe ids, duplicates, and oversized entries', () => {
  assert.deepEqual(parseDiscoveredModels(JSON.stringify({ data: [
    { id: 'vendor/model-a', name: 'Model A' },
    { id: 'vendor/model-a', name: 'Duplicate' },
    { id: 'bad id' },
    { id: 'x'.repeat(101) },
  ] })), [{ id: 'vendor/model-a', name: 'Model A' }])
})

test('only active, non-default provider connections enter the chat model registry', () => {
  const base = {
    providerId: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    displayName: 'OpenRouter',
    enabledModelIds: ['vendor/model-a'],
    discoveredModelsJson: JSON.stringify({ data: [{ id: 'vendor/model-a' }] }),
    isDefault: false,
    isDeletable: true,
  } as const
  const models = byokConnectionsToChatModels([
    { ...base, _id: 'active', status: 'active' },
    { ...base, _id: 'untested', status: 'untested' },
    { ...base, _id: 'error', status: 'error' },
  ])
  assert.deepEqual(models.map((model) => model.id), ['byok/active/vendor/model-a'])
})
