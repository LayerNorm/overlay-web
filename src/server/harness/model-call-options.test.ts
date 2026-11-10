import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { prepareHarnessModelCallOptions } from './model-call-options'

const mocks = vi.hoisted(() => ({ catalog: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: mocks.catalog }))

beforeEach(() => { vi.resetAllMocks() })

const screenshotHistory: LanguageModelV4CallOptions = {
  maxOutputTokens: 1_000,
  prompt: [{ role: 'tool', content: [{
    type: 'tool-result', toolCallId: 'c1', toolName: 'computer_screenshot', output: { type: 'content', value: [
      { type: 'text', text: 'Screenshot captured at 1280 by 720 pixels.' },
      { type: 'file', data: { type: 'data', data: new Uint8Array(2_048) }, mediaType: 'image/png' },
    ] },
  }] }],
}

test('a model with no catalog limit can continue after a screenshot', async () => {
  mocks.catalog.mockResolvedValue(undefined)
  const prepared = await prepareHarnessModelCallOptions({ modelId: 'byok/connection/claude-opus-5-5', options: screenshotHistory })
  expect(prepared).toMatchObject({ contextWindow: null, maxOutputTokens: 1_000 })
  expect(prepared).not.toHaveProperty('estimatedCostMicros')
})

test('a priced model sends media without estimating its cost first', async () => {
  mocks.catalog.mockResolvedValue({ type: 'language', pricing: { input: 0.000001, output: 0.000002 } })
  const prepared = await prepareHarnessModelCallOptions({ modelId: 'provider/model', options: screenshotHistory })
  expect(prepared.contextWindow).toBeNull()
})

test('provider hard limits, retired models and provider-run tools are still refused', async () => {
  mocks.catalog.mockResolvedValue({ type: 'language', contextWindow: 10_000, maxTokens: 500 })
  await expect(prepareHarnessModelCallOptions({ modelId: 'provider/model', options: screenshotHistory }))
    .rejects.toThrow(/model capacity/)
  await expect(prepareHarnessModelCallOptions({ modelId: 'openrouter/free', options: screenshotHistory }))
    .rejects.toThrow(/retired/)
  await expect(prepareHarnessModelCallOptions({ modelId: 'provider/model', options: {
    ...screenshotHistory, tools: [{ type: 'provider', id: 'x.y', name: 'y', args: {} }],
  } })).rejects.toThrow(/Provider-executed/)
})
