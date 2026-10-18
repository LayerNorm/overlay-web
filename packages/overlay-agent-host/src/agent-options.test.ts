import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAgentOptions } from './agent-options.js'

test('modern configuration accepts new model names, grouped options and thought-level ids without a static catalog', () => {
  const result = parseAgentOptions({ configOptions: [
    { type: 'select', id: 'provider-model', category: 'model', name: 'Model', currentValue: 'future-model',
      options: [{ group: 'provider', name: 'Provider', options: [{ value: 'future-model', name: 'Future model', description: 'Offered by this agent' }] }] },
    { type: 'select', id: 'mode', category: 'mode', name: 'Permissions', currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }] },
    { type: 'select', id: 'reasoning', category: 'thought_level', name: 'Effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
  ] }, 1000)
  assert.deepEqual(result.model, { configId: 'provider-model', currentValue: 'future-model', values: [{ id: 'future-model', label: 'Future model', description: 'Offered by this agent' }] })
  assert.equal(result.effort?.configId, 'reasoning')
  assert.equal(result.mode?.values[0]?.id, 'auto')
  assert.equal(result.discoveredAt, 1000)
})

test('legacy models and modes remain usable while modern selectors take precedence', () => {
  const legacy = { models: { currentModelId: 'old', availableModels: [{ modelId: 'old', name: 'Old model' }] },
    modes: { currentModeId: 'acceptEdits', availableModes: [{ id: 'acceptEdits', name: 'Accept edits', description: null }] } }
  assert.deepEqual(parseAgentOptions(legacy, 1000).model, { currentValue: 'old', values: [{ id: 'old', label: 'Old model' }] })
  const modern = parseAgentOptions({ ...legacy, configOptions: [{ type: 'select', id: 'model', name: 'Model', currentValue: 'new', options: [{ value: 'new', name: 'New' }] }] }, 1000)
  assert.equal(modern.model?.values[0]?.id, 'new')
  assert.equal(modern.mode?.currentValue, 'acceptEdits')
})

test('unknown and boolean option kinds do not invent model or effort choices', () => {
  assert.deepEqual(parseAgentOptions({ configOptions: [{ type: 'boolean', id: 'model', name: 'Experimental', currentValue: true }] }, 1000), { discoveredAt: 1000 })
  assert.throws(() => parseAgentOptions({ models: { availableModels: 'not a list' } }), /availableModels/)
})
