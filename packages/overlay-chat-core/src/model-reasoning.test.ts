import assert from 'node:assert/strict'
import test from 'node:test'
import { getEffectiveReasoningByModel, getEffectiveReasoningForModel } from './model-reasoning'

test('effective reasoning follows the exact model capabilities', () => {
  const first = 'byok/connection-one/provider/model'
  const second = 'byok/connection-two/provider/model'
  const models = [
    { id: first, reasoningLevels: [{ value: 'provider-default' as const }, { value: 'low' as const }] },
    { id: second, reasoningLevels: [{ value: 'provider-default' as const }, { value: 'high' as const }] },
  ]

  assert.deepEqual(getEffectiveReasoningByModel(models, {
    [first]: 'high',
    [second]: 'high',
    'unknown/model': 'low',
  }), { [second]: 'high' })
  assert.equal(getEffectiveReasoningForModel(models[0], 'provider-default'), undefined)
  assert.equal(getEffectiveReasoningForModel({ reasoningLevels: [] }, 'high'), undefined)
})
