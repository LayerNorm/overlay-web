import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_PARITY_TEXT_SCENARIOS } from '@overlay/chat-core/parity-fixtures'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createWebChatTranscriptAdapter } from './toChatTranscriptView'

function message(value: Record<string, unknown>): UIMessage {
  return value as unknown as UIMessage
}

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
