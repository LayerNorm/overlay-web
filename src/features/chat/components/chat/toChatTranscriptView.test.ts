import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_PARITY_TEXT_SCENARIOS } from '@overlay/chat-core/parity-fixtures'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createWebChatTranscriptAdapter } from './toChatTranscriptView'
import { createDesktopChatTranscriptAdapter } from '../../../../../overlay-desktop/src/renderer/src/components/chat/desktopChatTranscriptAdapter'
import type { Message as DesktopMessage } from '../../../../../overlay-desktop/src/renderer/src/components/chat/types'

function message(value: Record<string, unknown>): UIMessage {
  return value as unknown as UIMessage
}

test('web adapter maps multi-model text, sources, files, generated UI, and selection', () => {
  const user = message({
    id: 'user-1',
    turnId: 'turn-1',
    role: 'user',
    createdAt: 100,
    parts: [
      { type: 'text', text: 'Compare the launch plans.' },
      { type: 'file', url: 'data:image/png;base64,AA==', mediaType: 'image/png', fileName: 'brief.png' },
    ],
    metadata: {
      indexedDocuments: ['launch.pdf'],
      indexedAttachments: [{ name: 'launch.pdf', fileIds: ['file-1'] }],
      mentions: [{ type: 'file', id: 'file-1', name: 'launch.pdf', fileIds: ['file-1'] }],
    },
  })
  const alpha = message({
    id: 'assistant-alpha',
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: 'Alpha answer' }],
  })
  const beta = message({
    id: 'assistant-beta',
    role: 'assistant',
    status: 'completed',
    metadata: { routedModelId: 'beta-routed' },
    parts: [
      { type: 'reasoning', text: 'Compare evidence', state: 'done' },
      { type: 'source', id: 'source-1', sourceKind: 'url', sourceId: 'url-1', url: 'https://example.test' },
      { type: 'file', url: 'data:application/pdf;base64,AA==', mediaType: 'application/pdf' },
      {
        type: 'data',
        id: 'draft-1',
        dataType: 'overlay.generated_ui',
        data: { version: 1, kind: 'draft.text', body: 'Ship beta.' },
      },
      { type: 'text', text: 'Beta answer' },
    ],
  })
  const responses = new Map([['alpha', alpha], ['beta', beta]])
  const adapt = createWebChatTranscriptAdapter()
  const input = {
    primaryMessages: [user],
    exchangeModes: ['ask'] as const,
    exchangeModels: [['alpha', 'beta']],
    selectedTabPerExchange: [1],
    selectedModels: ['alpha'],
    latestExchangeIndex: 0,
    getResponseForExchangeForModel: (modelId: string) => responses.get(modelId) ?? null,
  }

  const first = adapt(input)
  const second = adapt(input)
  const exchange = first.exchanges[0]!
  assert.equal(exchange.selectedModelId, 'beta')
  assert.equal(exchange.selectedResponseIndex, 1)
  assert.equal(exchange.status, 'completed')
  assert.deepEqual(exchange.user.documentNames, ['launch.pdf'])
  assert.deepEqual(exchange.user.images, [{
    url: 'data:image/png;base64,AA==',
    name: 'brief.png',
    mediaType: 'image/png',
  }])
  assert.deepEqual(exchange.responses[1]!.blocks.map((block) => block.kind), [
    'reasoning',
    'source',
    'file',
    'generated-ui',
    'text',
  ])
  assert.equal(exchange.responses[1]!.sources[0]?.url, 'https://example.test')
  assert.equal(exchange.responses[1]!.routedModelId, 'beta-routed')
  assert.equal(second.exchanges[0], exchange, 'completed exchange identity should remain stable')
})

test('web adapter exposes submitted missing-assistant and recreates only the active exchange', () => {
  const oldUser = message({ id: 'user-old', turnId: 'turn-old', role: 'user', parts: [{ type: 'text', text: 'Old' }] })
  const activeUser = message({ id: 'user-active', turnId: 'turn-active', role: 'user', parts: [{ type: 'text', text: 'New' }] })
  const oldResponse = message({ id: 'assistant-old', role: 'assistant', status: 'completed', parts: [{ type: 'text', text: 'Done' }] })
  const adapt = createWebChatTranscriptAdapter()
  const input = {
    primaryMessages: [oldUser, activeUser],
    exchangeModes: ['ask', 'ask'] as const,
    exchangeModels: [['alpha'], ['alpha']],
    selectedTabPerExchange: [0, 0],
    selectedModels: ['alpha'],
    latestExchangeIndex: 1,
    isOptimisticLoading: true,
    getResponseForExchangeForModel: (_modelId: string, index: number) => index === 0 ? oldResponse : null,
  }

  const first = adapt(input)
  const second = adapt(input)
  assert.equal(first.exchanges[1]!.status, 'submitted')
  assert.deepEqual(first.exchanges[1]!.responses, [])
  assert.equal(second.exchanges[0], first.exchanges[0])
  assert.notEqual(second.exchanges[1], first.exchanges[1])
})

test('web adapter restores image and video generation results', () => {
  const user = message({ id: 'user-media', turnId: 'turn-media', role: 'user', parts: [{ type: 'text', text: 'Animate it' }] })
  const adapt = createWebChatTranscriptAdapter()
  const generationResults = new Map([[0, [{
    type: 'video' as const,
    status: 'completed' as const,
    url: 'data:video/mp4;base64,AA==',
  }]]])
  const view = adapt({
    primaryMessages: [user],
    exchangeModes: ['ask'],
    exchangeModels: [['video-model']],
    selectedTabPerExchange: [0],
    selectedModels: ['video-model'],
    exchangeGenTypes: ['video'],
    generationResults,
    latestExchangeIndex: 0,
    getResponseForExchangeForModel: () => null,
  })

  assert.equal(view.exchanges[0]!.status, 'completed')
  assert.deepEqual(view.exchanges[0]!.media, {
    kind: 'video',
    results: generationResults.get(0),
  })
})

test('equivalent web and desktop deterministic fixtures produce the same transcript contract', () => {
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
    role: 'assistant',
    status: 'completed',
    parts: [{ type: 'text', text: assistantText }],
  })
  const webView = createWebChatTranscriptAdapter()({
    primaryMessages: [webUser],
    exchangeModes: ['ask'],
    exchangeModels: [['parity-model']],
    selectedTabPerExchange: [0],
    selectedModels: ['parity-model'],
    latestExchangeIndex: 0,
    getResponseForExchangeForModel: () => webAssistant,
  })

  const desktopMessages: DesktopMessage[] = [
    {
      id: 'user-parity',
      turnId: 'turn-parity',
      role: 'user',
      content: fixture.userText,
      timestamp: createdAt,
    },
    {
      id: 'assistant-parity',
      turnId: 'turn-parity',
      role: 'assistant',
      content: assistantText,
      timestamp: createdAt + 1,
      selectedModelId: 'parity-model',
    },
  ]
  const desktopView = createDesktopChatTranscriptAdapter()({ messages: desktopMessages })

  assert.deepEqual(desktopView, webView)
})
