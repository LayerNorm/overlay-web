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

test('reloaded chat transcript exposes one card for the latest successful file revision', () => {
  const user = message({ id: 'user-file', turnId: 'turn-file', role: 'user', parts: [{ type: 'text', text: 'Save this' }] })
  const assistant = message({
    id: 'assistant-file', role: 'assistant', status: 'completed', parts: [
      { type: 'text', text: 'Created [Launch notes](/app/notes?id=note-1&scope=personal). Here it is.' },
      { type: 'tool-invocation', toolInvocation: {
        toolCallId: 'note-1', toolName: 'create_note', state: 'output-available',
        toolOutput: { success: true, noteId: 'note-1', saved: { title: 'Launch notes' },
          fileReference: { fileId: 'note-1', name: 'Launch notes', mimeType: 'text/markdown', revision: '1' } },
      } },
      { type: 'tool-invocation', toolInvocation: {
        toolCallId: 'note-2', toolName: 'update_note', state: 'output-available',
        toolOutput: { success: true, noteId: 'note-1', saved: { title: 'Launch notes' },
          fileReference: { fileId: 'note-1', name: 'Launch notes', mimeType: 'text/markdown', revision: '2' } },
      } },
    ],
  })
  const view = createWebChatTranscriptAdapter()({
    primaryMessages: [user], exchangeModes: ['ask'], exchangeModels: [['model-a']],
    selectedModels: ['model-a'], latestExchangeIndex: 0, getResponseForExchange: () => assistant,
  })
  const blocks = view.exchanges[0]!.responses[0]!.blocks
  const files = blocks.filter((block) => block.kind === 'file')
  assert.equal(files.length, 1)
  assert.equal(files[0]?.kind === 'file' ? files[0].fileReference?.revision : null, '2')
  assert.ok(blocks.some((block) => block.kind === 'text' && block.text.includes('Created Launch notes. Here it is.')))
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
