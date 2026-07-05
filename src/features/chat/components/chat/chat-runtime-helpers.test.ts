import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationRuntime } from '../chat-interface/types'
import {
  getResponseForExchangeForModel,
  prepareAskModelThreadsForTextTurn,
  readableModelId,
  removeTurnFromConversationRuntime,
  sameAssistantSnapshot,
} from './chat-runtime-helpers'

function user(id: string, text = id): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  } as UIMessage
}

function assistant(id: string, text = id, extra: Partial<Record<string, unknown>> = {}): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
    ...extra,
  } as UIMessage
}

function runtimeFor(params: {
  selectedModels?: string[]
  selectedActModel?: string
  exchangeModels?: string[][]
  selectedTabPerExchange?: number[]
  exchangeGenTypes?: ('text' | 'image' | 'video')[]
  generationResults?: Map<number, never[]>
  askMessages?: UIMessage[][]
  actMessages?: UIMessage[]
} = {}): ConversationRuntime {
  const selectedModels = params.selectedModels ?? ['model-a']
  const askMessages = params.askMessages ?? [[user('turn-1'), assistant('a-1')]]
  return {
    askChats: [
      { messages: askMessages[0] ?? [], setMessages() {}, stop() {} } as never,
      { messages: askMessages[1] ?? [], setMessages() {}, stop() {} } as never,
      { messages: askMessages[2] ?? [], setMessages() {}, stop() {} } as never,
      { messages: askMessages[3] ?? [], setMessages() {}, stop() {} } as never,
    ],
    actChat: { messages: params.actMessages ?? askMessages[0] ?? [], setMessages() {}, stop() {} } as never,
    hydrated: true,
    ui: createConversationUiState({
      selectedActModel: params.selectedActModel ?? selectedModels[0] ?? 'model-a',
      selectedModels,
      askModelSelectionMode: selectedModels.length > 1 ? 'multiple' : 'single',
      exchangeModes: (params.exchangeModels ?? [selectedModels]).map(() => 'act'),
      exchangeModels: params.exchangeModels ?? [selectedModels],
      selectedTabPerExchange: params.selectedTabPerExchange ?? [0],
      generationResults: params.generationResults ?? new Map(),
      exchangeGenTypes: params.exchangeGenTypes ?? ['text'],
      isFirstMessage: false,
    }),
  }
}

test('formats readable model ids without losing common abbreviations', () => {
  assert.equal(readableModelId('openai/gpt-4.1-mini'), 'GPT 4.1 Mini')
  assert.equal(readableModelId('zai/glm-4.5v'), 'GLM 4.5v')
})

test('compares assistant snapshots by status, model, routed model, and parts', () => {
  const first = assistant('a', 'hello', {
    status: 'generating',
    model: 'model-a',
    metadata: { routedModelId: 'provider/model-a' },
  })
  const same = assistant('a-copy', 'hello', {
    status: 'generating',
    model: 'model-a',
    metadata: { routedModelId: 'provider/model-a' },
  })
  const changed = assistant('a-copy', 'hello world', {
    status: 'generating',
    model: 'model-a',
    metadata: { routedModelId: 'provider/model-a' },
  })

  assert.equal(sameAssistantSnapshot(first, same), true)
  assert.equal(sameAssistantSnapshot(first, changed), false)
})

test('selects the assistant response for a model exchange from live slots', () => {
  const runtime = runtimeFor({
    selectedModels: ['model-a', 'model-b'],
    askMessages: [
      [user('u1'), assistant('a1'), user('u2'), assistant('a2')],
      [user('u1'), assistant('b1'), user('u2'), assistant('b2')],
    ],
  })

  assert.equal(
    getResponseForExchangeForModel({
      modelId: 'model-b',
      exchangeIndex: 1,
      selectedModels: ['model-a', 'model-b'],
      activeRuntime: runtime,
      activeAskChats: runtime.askChats,
      isActiveLoading: false,
    })?.id,
    'b2',
  )
})

test('prepares text turn threads from the previous selected base model', () => {
  const baseThread = [user('u1'), assistant('a1')]
  const runtime = runtimeFor({
    selectedModels: ['model-a'],
    exchangeModels: [['model-a']],
    askMessages: [baseThread],
  })

  const result = prepareAskModelThreadsForTextTurn(runtime, ['model-b', 'model-c'])

  assert.equal(result.historyBaseModelId, 'model-a')
  assert.deepEqual(runtime.ui.selectedModels, ['model-b', 'model-c'])
  assert.equal(runtime.ui.selectedActModel, 'model-b')
  assert.deepEqual(runtime.askChats[0].messages, baseThread)
  assert.deepEqual(runtime.askChats[1].messages, baseThread)
  assert.notEqual(runtime.askChats[0].messages, baseThread)
  assert.equal(runtime.ui.orphanModelThreads.get('model-a')?.[1]?.id, 'a1')
})

test('removes a turn and reindexes per-exchange UI state', () => {
  const runtime = runtimeFor({
    selectedModels: ['model-a'],
    exchangeModels: [['model-a'], ['model-a']],
    selectedTabPerExchange: [0, 0],
    exchangeGenTypes: ['text', 'image'],
    generationResults: new Map([[1, []]]),
    askMessages: [[
      user('turn-1'),
      assistant('a1', 'a1', { turnId: 'turn-1' }),
      user('turn-2'),
      assistant('a2', 'a2', { turnId: 'turn-2' }),
    ]],
    actMessages: [
      user('turn-1'),
      assistant('act-a1', 'act-a1', { turnId: 'turn-1' }),
      user('turn-2'),
      assistant('act-a2', 'act-a2', { turnId: 'turn-2' }),
    ],
  })

  const result = removeTurnFromConversationRuntime(runtime, 'turn-1')

  assert.equal(result.removedExchangeIndex, 0)
  assert.deepEqual(runtime.askChats[0].messages.map((message) => message.id), ['turn-2', 'a2'])
  assert.deepEqual(runtime.actChat.messages.map((message) => message.id), ['turn-2', 'act-a2'])
  assert.deepEqual(runtime.ui.exchangeGenTypes, ['image'])
  assert.equal(runtime.ui.generationResults.has(0), true)
  assert.equal(runtime.ui.generationResults.has(1), false)
  assert.equal(runtime.ui.isFirstMessage, false)
})
