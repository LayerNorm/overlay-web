import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationRuntime } from '../chat-interface/types'
import {
  getResponseForExchange,
  readableModelId,
  removeTurnFromConversationRuntime,
  sameAssistantSnapshot,
  withViewModelSelection,
} from './chat-runtime-helpers'

function message(id: string, role: 'user' | 'assistant', text = id): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

function runtimeFor(): ConversationRuntime {
  const user = message('turn-1', 'user')
  const primary = { ...message('answer-0', 'assistant'), turnId: 'turn-1', variantIndex: 0 } as UIMessage
  const other = { ...message('answer-1', 'assistant'), turnId: 'turn-1', variantIndex: 1 } as UIMessage
  return {
    askChats: [{ messages: [user, primary], setMessages() {}, stop() {} } as never],
    actChat: { messages: [user, primary, other], setMessages() {}, stop() {} } as never,
    hydrated: true,
    ui: createConversationUiState({
      selectedActModel: 'model-a',
      selectedModels: ['model-a'],
      exchangeModes: ['act'],
      exchangeModels: [['model-a']],
      exchangeGenTypes: ['text'],
      isFirstMessage: false,
    }),
  }
}

test('formats readable model ids and compares assistant snapshots', () => {
  assert.equal(readableModelId('openai/gpt-4.1-mini'), 'GPT 4.1 Mini')
  const first = message('a', 'assistant', 'hello')
  const same = message('b', 'assistant', 'hello')
  assert.equal(sameAssistantSnapshot(first, same), true)
})

test('uses one primary response and removes the selected turn from both runtimes', () => {
  const runtime = runtimeFor()
  assert.equal(getResponseForExchange({ exchangeIndex: 0, activeRuntime: runtime })?.id, 'answer-0')
  assert.equal(removeTurnFromConversationRuntime(runtime, 'turn-1').removedExchangeIndex, 0)
  assert.equal(runtime.askChats[0].messages.length, 0)
  assert.equal(runtime.actChat.messages.length, 0)
})

test('withViewModelSelection carries the picked model into a stale runtime snapshot', () => {
  const stale = createConversationUiState({
    selectedModels: ['openai/gpt-5.4-mini'],
    selectedActModel: 'openai/gpt-5.4-mini',
    exchangeModels: [['openai/gpt-5.4-mini']],
  })

  const next = withViewModelSelection(stale, {
    selectedModels: ['openrouter/free'],
    selectedActModel: 'openrouter/free',
  })

  assert.deepEqual(next.selectedModels, ['openrouter/free'])
  assert.equal(next.selectedActModel, 'openrouter/free')
  assert.deepEqual(next.exchangeModels, [['openai/gpt-5.4-mini']])
  assert.deepEqual(stale.selectedModels, ['openai/gpt-5.4-mini'])
})
