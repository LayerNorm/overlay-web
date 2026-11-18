import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_PARITY_TEXT_SCENARIOS } from '@overlay/chat-core/parity-fixtures'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createWebChatTranscriptAdapter } from './toChatTranscriptView'

function message(value: Record<string, unknown>): UIMessage {
  return value as unknown as UIMessage
}

test('native transcript keeps every assistant variant with stable response identities', () => {
  const user = message({ id: 'turn', turnId: 'turn', role: 'user', parts: [{ type: 'text', text: 'Question' }] })
  const responses = [0, 1].map(variantIndex => message({ id: `response-${variantIndex}`, role: 'assistant',
    model: 'model', variantIndex, status: 'completed', parts: [{ type: 'text', text: `Answer ${variantIndex}` }] }))
  const adapter = createWebChatTranscriptAdapter()
  const input = { primaryMessages: [user], exchangeModes: ['act' as const], exchangeModels: [['model']],
    selectedModels: ['model'], latestExchangeIndex: 0, getResponseForExchange: () => null }
  const partial = adapter({ ...input, getResponsesForExchange: () => [responses[1]] })
  const complete = adapter({ ...input, getResponsesForExchange: () => responses })
  assert.equal(complete.exchanges[0].responses.length, 2)
  assert.equal(partial.exchanges[0].responses[0].id, complete.exchanges[0].responses[1].id)
  assert.notEqual(complete.exchanges[0].responses[0].id, complete.exchanges[0].responses[1].id)
})

test('web transcript renders one selected model response', () => {
  const user = message({
    id: 'user-1',
    turnId: 'turn-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
  })
  const assistant = message({
    id: 'assistant-1',
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: 'Answer' }],
  })
  const view = createWebChatTranscriptAdapter()({
    primaryMessages: [user],
    exchangeModes: ['ask'],
    exchangeModels: [['model-a']],
    selectedModels: ['model-a'],
    latestExchangeIndex: 0,
    getResponseForExchange: () => assistant,
  })

  assert.equal(view.exchanges[0]!.selectedModelId, 'model-a')
  assert.equal(view.exchanges[0]!.selectedResponseIndex, 0)
  assert.equal(view.exchanges[0]!.responses.length, 1)
  assert.equal(view.exchanges[0]!.responses[0]!.blocks[0]?.kind, 'text')
})

test('the web-shell transcript preserves the canonical rich-markdown fixture', () => {
  const fixture = CHAT_PARITY_TEXT_SCENARIOS.find((scenario) => scenario.id === 'rich-markdown')!
  const assistantText = fixture.assistantBlocks.find((block) => block.kind === 'text')?.text ?? ''
  const createdAt = 1_721_177_600_000
  const webUser = message({
    id: 'user-parity',
    turnId: 'turn-parity',
    role: 'user',
    createdAt,
    parts: [{ type: 'text', text: fixture.userText }],
  })
  const webAssistant = message({
    id: 'assistant-parity',
    turnId: 'turn-parity',
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: assistantText }],
  })
  const webView = createWebChatTranscriptAdapter()({
    primaryMessages: [webUser],
    exchangeModes: ['ask'],
    exchangeModels: [['parity-model']],
    selectedModels: ['parity-model'],
    latestExchangeIndex: 0,
    getResponseForExchange: () => webAssistant,
  })

  const exchange = webView.exchanges[0]!
  const responseText = exchange.responses[0]!.blocks.filter((block) => block.kind === 'text').map((block) => block.text).join('')
  assert.equal(exchange.user.text, fixture.userText)
  assert.equal(responseText, assistantText)
  assert.equal(exchange.status, 'completed')
  assert.equal(exchange.selectedModelId, 'parity-model')
})

test('latest active fallback stays live from submission through visible output and terminal state', () => {
  const user = message({ id: 'turn-1', turnId: 'turn-1', role: 'user', parts: [{ type: 'text', text: 'Question' }] })
  let response: UIMessage | null = null
  const adapter = createWebChatTranscriptAdapter()
  const input = (activity: { isActiveLoading: boolean; isOptimisticLoading: boolean }) => ({
    primaryMessages: [user],
    exchangeModes: ['ask' as const],
    exchangeModels: [['model-a']],
    selectedModels: ['model-a'],
    latestExchangeIndex: 0,
    ...activity,
    getResponseForExchange: () => response,
  })

  const submitted = adapter(input({ isActiveLoading: false, isOptimisticLoading: true })).exchanges[0]!
  assert.equal(submitted.status, 'submitted')
  assert.equal(submitted.responses.length, 0)

  response = message({
    id: 'response-1', turnId: 'turn-1', role: 'assistant', status: 'generating',
    parts: [{ type: 'text', text: '**Partial** response' }],
  })
  const partial = adapter(input({ isActiveLoading: true, isOptimisticLoading: false })).exchanges[0]!
  assert.equal(partial.status, 'streaming')
  assert.equal(partial.responses[0]?.status, 'streaming')

  response = message({
    id: 'response-1', turnId: 'turn-1', role: 'assistant', status: 'generating',
    parts: [{ type: 'tool-invocation', toolInvocation: { toolCallId: 'tool-1', toolName: 'search', state: 'call', args: {} } }],
  })
  const toolOnly = adapter(input({ isActiveLoading: true, isOptimisticLoading: false })).exchanges[0]!
  assert.equal(toolOnly.status, 'streaming')

  response = message({
    id: 'response-1', turnId: 'turn-1', role: 'assistant', status: 'generating',
    parts: [
      { type: 'tool-invocation', toolInvocation: { toolCallId: 'tool-1', toolName: 'search', state: 'result', args: {}, result: 'Found it' } },
      { type: 'text', text: 'More **formatted** text' },
    ],
  })
  const moreText = adapter(input({ isActiveLoading: true, isOptimisticLoading: false })).exchanges[0]!
  assert.equal(moreText.status, 'streaming')
  assert.equal(moreText.responses[0]?.status, 'streaming')
  assert.equal(moreText.id, partial.id)
  assert.equal(moreText.responses[0]?.id, partial.responses[0]?.id)

  response = message({
    id: 'response-1', turnId: 'turn-1', role: 'assistant', status: 'completed',
    parts: [{ type: 'text', text: 'Final response' }],
  })
  const completed = adapter(input({ isActiveLoading: true, isOptimisticLoading: false })).exchanges[0]!
  assert.equal(completed.status, 'completed')
  assert.equal(completed.responses[0]?.status, 'completed')
})

test('terminal response, cancellation, and interruption statuses beat a late active flag', () => {
  const user = message({ id: 'turn-1', turnId: 'turn-1', role: 'user', parts: [{ type: 'text', text: 'Question' }] })
  const generating = message({
    id: 'response-1', turnId: 'turn-1', role: 'assistant', status: 'generating',
    parts: [{ type: 'text', text: 'Partial response' }],
  })
  const adapter = createWebChatTranscriptAdapter()
  const input = (overrides: Record<string, unknown> = {}) => adapter({
    primaryMessages: [user],
    exchangeModes: ['ask'],
    exchangeModels: [['model-a']],
    selectedModels: ['model-a'],
    latestExchangeIndex: 0,
    isActiveLoading: true,
    isOptimisticLoading: false,
    getResponseForExchange: () => generating,
    ...overrides,
  } as Parameters<typeof adapter>[0]).exchanges[0]!

  assert.equal(input({ getResponseForExchange: () => message({ ...generating, status: 'completed' }) }).status, 'completed')
  assert.equal(input({ getResponseForExchange: () => message({ ...generating, status: 'error' }) }).status, 'error')
  assert.equal(input({ getResponseRuntime: () => ({ status: 'cancelled' }) }).status, 'cancelled')
  assert.equal(input({ interruptedExchangeIdx: 0 }).status, 'interrupted')
})

test('latest fallback does not reactivate historical rows or prior response variants', () => {
  const historicalUser = message({ id: 'turn-old', turnId: 'turn-old', role: 'user', parts: [{ type: 'text', text: 'Earlier' }] })
  const latestUser = message({ id: 'turn-new', turnId: 'turn-new', role: 'user', parts: [{ type: 'text', text: 'Latest' }] })
  const historical = message({
    id: 'response-old', persistedId: 'response-old', turnId: 'turn-old', role: 'assistant', model: 'old-model', status: 'generating',
    parts: [{ type: 'text', text: 'Historical partial text' }],
  })
  const priorVariant = message({
    id: 'response-prior', persistedId: 'response-prior', turnId: 'turn-new', role: 'assistant', model: 'prior-model', status: 'completed',
    parts: [{ type: 'text', text: 'Earlier variant' }],
  })
  const currentVariant = message({
    id: 'response-current', persistedId: 'response-current', turnId: 'turn-new', role: 'assistant', model: 'current-model', status: 'generating',
    parts: [{ type: 'text', text: 'Current partial text' }],
  })
  const adapter = createWebChatTranscriptAdapter()
  const createView = (selected: UIMessage) => adapter({
    primaryMessages: [historicalUser, latestUser],
    exchangeModes: ['ask', 'ask'],
    exchangeModels: [['old-model'], ['prior-model', 'current-model']],
    selectedModels: ['current-model'],
    latestExchangeIndex: 1,
    isActiveLoading: true,
    getResponseForExchange: () => null,
    getResponsesForExchange: (exchangeIndex) => exchangeIndex === 0 ? [historical] : [priorVariant, selected],
  })

  const before = createView(currentVariant)
  assert.equal(before.exchanges[0]?.status, 'completed')
  assert.equal(before.exchanges[0]?.responses[0]?.status, 'completed')
  assert.deepEqual(before.exchanges[1]?.responses.map(response => response.status), ['completed', 'streaming'])

  const updatedVariant = message({ ...currentVariant, parts: [{ type: 'text', text: 'Current partial text with more' }] })
  const after = createView(updatedVariant)
  assert.equal(after.exchanges[0]?.status, 'completed')
  assert.deepEqual(after.exchanges[1]?.responses.map(response => response.status), ['completed', 'streaming'])
  assert.equal(after.exchanges[0]?.id, before.exchanges[0]?.id)
  assert.equal(after.exchanges[1]?.id, before.exchanges[1]?.id)
  assert.deepEqual(after.exchanges[1]?.responses.map(response => response.id), before.exchanges[1]?.responses.map(response => response.id))
})
