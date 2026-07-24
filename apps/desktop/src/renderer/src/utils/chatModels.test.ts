import { describe, it, expect } from 'vitest'
import { BUILT_IN_MODELS } from '@overlay/llm-gateway'
import { withDisabledState } from './chatModels'
import type { ChatModel } from '../components/chat/types'

function makeModel(cost: 0 | 1 | 2 | 3, overrides: Partial<ChatModel> = {}): ChatModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: 'openai',
    intelligence: 70,
    cost,
    speedTier: 2,
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false,
    ...overrides
  }
}

describe('withDisabledState', () => {
  it('disables non-free models for free-tier users', () => {
    const models = [makeModel(0), makeModel(1), makeModel(2), makeModel(3)]
    const result = withDisabledState(models, true)

    expect(result[0].disabled).toBe(false)
    expect(result[0].disabledReason).toBeUndefined()

    for (const model of result.slice(1)) {
      expect(model.disabled).toBe(true)
      expect(model.disabledReason).toBe('Upgrade to use this model')
    }
  })

  it('does not disable any models for paid-tier users', () => {
    const models = [makeModel(0), makeModel(1), makeModel(2), makeModel(3)]
    const result = withDisabledState(models, false)

    for (const model of result) {
      expect(model.disabled).toBe(false)
      expect(model.disabledReason).toBeUndefined()
    }
  })

  it('preserves existing model fields', () => {
    const model = makeModel(0, { name: 'Custom Name', supportsVision: true })
    const [result] = withDisabledState([model], false)

    expect(result.name).toBe('Custom Name')
    expect(result.supportsVision).toBe(true)
  })

  it('integrates with the shared BUILT_IN_MODELS catalog', () => {
    const result = withDisabledState(BUILT_IN_MODELS as unknown as ChatModel[], true)

    const auto = result.find((m) => m.id === 'openrouter/free')
    const premium = result.find((m) => m.id === 'claude-sonnet-4-6')

    expect(auto?.disabled).toBe(false)
    expect(premium?.disabled).toBe(true)
    expect(premium?.disabledReason).toBe('Upgrade to use this model')
  })
})
