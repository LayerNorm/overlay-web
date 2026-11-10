import { beforeEach, expect, test, vi } from 'vitest'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { quoteHarnessModel } from './model-quote'

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

test('a subscription or BYOK model with no catalog limit can continue after a screenshot', async () => {
  mocks.catalog.mockResolvedValue(undefined)
  const quote = await quoteHarnessModel({ modelId: 'byok/connection/claude-opus-5-5', options: screenshotHistory })
  expect(quote.contextWindow).toBeNull()
  expect(quote.estimatedCostMicros).toBe(0)
  expect(quote.inputTokenBudget).toBeGreaterThan(2_048)
})

test('a priced model still needs a known context limit before sending media', async () => {
  mocks.catalog.mockResolvedValue({ type: 'language', pricing: { input: 0.000001, output: 0.000002 } })
  await expect(quoteHarnessModel({ modelId: 'provider/model', options: screenshotHistory }))
    .rejects.toThrow(/known context limit/)
})
