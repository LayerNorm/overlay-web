import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getModelForId,
  getModelsByIntelligence,
  listModelInfo,
  pickBestModelForAct,
  resolveModelId,
  toAnthropicApiModelId,
  toOpenAIApiModelId,
} from './index'
import { pricingFromCatalog } from './adapters/common'

test('resolves legacy model aliases', () => {
  assert.equal(resolveModelId('claude-opus-4-6'), 'anthropic/claude-opus-4.7')
  assert.equal(getModelForId('zai/glm-5.1')?.id, 'z-ai/glm-5.1')
})

test('lists model info without package-internal ranking fields', () => {
  const [model] = listModelInfo()
  assert.equal(typeof model.id, 'string')
  assert.equal('intelligence' in model, false)
})

test('maps provider-prefixed direct ids to native API ids', () => {
  assert.equal(toOpenAIApiModelId('openai/gpt-5.4-mini'), 'gpt-5.4-mini')
  assert.equal(toAnthropicApiModelId('anthropic/claude-opus-4.7'), 'claude-opus-4.7')
})

test('models use the configured quality ordering', () => {
  const models = [
    { id: 'openai/gpt-5.6-luna' },
    { id: 'google/gemma-4-26b-a4b-it' },
    { id: 'minimax/minimax-m3' },
  ]
  assert.deepEqual(
    getModelsByIntelligence(models).map((model) => model.id),
    [
      'google/gemma-4-26b-a4b-it',
      'openai/gpt-5.6-luna',
      'minimax/minimax-m3',
    ],
  )
})

test('MiniMax M3.1 Flash has zero cost without becoming a free-tier router', () => {
  const modelId = 'minimax/minimax-m3.1-flash'
  const model = getModelForId(modelId)

  assert.equal(model?.name, 'MiniMax M3.1 Flash')
  assert.equal(model?.cost, 0)
  assert.equal(model?.speedTier, 3)
  assert.equal(model?.supportsVision, true)
  assert.equal(model?.supportsReasoning, true)
  assert.equal(model?.supportsZeroDataRetention, false)
  assert.equal(pricingFromCatalog(modelId).isFree, true)
  assert.equal(pickBestModelForAct([modelId]), modelId)
})
