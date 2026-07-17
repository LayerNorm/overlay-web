import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getModelForId,
  listModelInfo,
  resolveModelId,
  toAnthropicApiModelId,
  toOpenAIApiModelId,
  toOpenRouterApiModelId,
} from './index'

test('resolves legacy model aliases', () => {
  assert.equal(resolveModelId('claude-opus-4-6'), 'anthropic/claude-opus-4.7')
  assert.equal(getModelForId('zai/glm-5.1')?.id, 'z-ai/glm-5.1')
})

test('lists model info without package-internal ranking fields', () => {
  const [model] = listModelInfo()
  assert.equal(typeof model.id, 'string')
  assert.equal('intelligence' in model, false)
})

test('maps Overlay OpenRouter registry ids to OpenRouter API ids', () => {
  assert.equal(toOpenRouterApiModelId('openrouter/free'), 'openrouter/free')
  assert.equal(
    toOpenRouterApiModelId('openrouter/nvidia/nemotron-3-super-120b-a12b:free'),
    'nvidia/nemotron-3-super-120b-a12b:free',
  )
})

test('maps provider-prefixed direct ids to native API ids', () => {
  assert.equal(toOpenAIApiModelId('openai/gpt-5.4-mini'), 'gpt-5.4-mini')
  assert.equal(toAnthropicApiModelId('anthropic/claude-opus-4.7'), 'claude-opus-4.7')
})
