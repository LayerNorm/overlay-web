import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createWebChatTranscriptAdapter } from './toChatTranscriptView'

test('web transcript renders one selected model response', () => {
  const user = {
    id: 'user-1',
    turnId: 'turn-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
  } as unknown as UIMessage
  const assistant = {
    id: 'assistant-1',
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: 'Answer' }],
  } as unknown as UIMessage
  const view = createWebChatTranscriptAdapter()({
    primaryMessages: [user],
    exchangeModes: ['ask'],
    exchangeModels: [['model-a', 'model-b']],
    selectedModels: ['model-a', 'model-b'],
    latestExchangeIndex: 0,
    getResponseForExchange: () => assistant,
  })

  assert.equal(view.exchanges[0]!.selectedModelId, 'model-a')
  assert.equal(view.exchanges[0]!.selectedResponseIndex, 0)
  assert.equal(view.exchanges[0]!.responses.length, 1)
  assert.equal(view.exchanges[0]!.responses[0]!.blocks[0]?.kind, 'text')
})
