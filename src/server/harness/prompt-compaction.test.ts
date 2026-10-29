import { expect, test, vi } from 'vitest'
import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { compactHarnessPrompt } from '@/server/chat/context-compaction'

vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/server/ai/gateway/gateway-catalog', () => ({ getGatewayCatalogModel: vi.fn() }))

function history(): LanguageModelV4Prompt {
  return [
    { role: 'system', content: 'Old instructions, replaced by the controller.' },
    { role: 'user', content: [{ type: 'text', text: 'Check the records, but do not publish anything.' }] },
    ...Array.from({ length: 6 }, (_, index) => ({ role: 'assistant' as const, content: [{ type: 'text' as const, text: `Earlier observation ${index}: ${'x'.repeat(2_000)}` }] })),
    { role: 'assistant', content: [
      { type: 'tool-call', toolCallId: 'a', toolName: 'read', input: { id: 'a' } },
      { type: 'tool-call', toolCallId: 'b', toolName: 'read', input: { id: 'b' } },
    ] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'read', output: { type: 'text', value: 'First record' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'b', toolName: 'read', output: { type: 'text', value: 'Second record' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'The records are ready to compare.' }] },
  ]
}

const budget = { contextWindow: 4_000, outputReserveTokens: 512, fixedOverheadTokens: 256 }

test('compacts complete transactions without splitting parallel call/result pairs or losing the user request', async () => {
  const messages = history()
  const summarize = vi.fn(async ({ prompt }: { prompt: string; targetSummaryTokens: number }) => {
    expect(prompt).toContain('Previous constraints')
    return 'Previous constraints and the earlier observations remain relevant.'
  })
  const result = await compactHarnessPrompt({ ...budget, messages, previousSummary: 'Previous constraints', generateSummaryText: summarize })
  expect(result.didCompact).toBe(true)
  expect(result.fitsBudget).toBe(true)
  expect(result.messages).toEqual([messages[1], ...messages.slice(-4)])
  expect(result.finalEstimatedTokens).toBeLessThan(result.originalEstimatedTokens)
  expect(result.summary).toContain('Previous constraints')
  expect(summarize).toHaveBeenCalled()
  expect(JSON.stringify(messages)).toContain('Old instructions')
})

test('summarizer failure preserves all history instead of silently trimming evidence', async () => {
  const messages = history()
  const result = await compactHarnessPrompt({ ...budget, messages, previousSummary: 'Known constraints', generateSummaryText: async () => { throw new Error('Unavailable') } })
  expect(result.summaryFailed).toBe(true)
  expect(result.didCompact).toBe(false)
  expect(result.messages).toEqual(messages.filter(message => message.role !== 'system'))
  expect(result.summary).toBe('Known constraints')
})

test('counts real instruction/tool overhead and explicitly refuses an oversized unsplittable prompt', async () => {
  const summarize = vi.fn(async () => 'unused')
  const result = await compactHarnessPrompt({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Please read this.' }] }],
    contextWindow: 2_000, outputReserveTokens: 256, fixedOverheadTokens: 1_900, generateSummaryText: summarize,
  })
  expect(result.fitsBudget).toBe(false)
  expect(summarize).not.toHaveBeenCalled()
  expect(result.messages).toHaveLength(1)
})
