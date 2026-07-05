import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createConversationUiState } from '@overlay/chat-core'
import type {
  ConversationRuntime,
  LiveConversationMessage,
} from '../chat-interface/types'
import {
  patchLiveMessagesIntoRuntime,
  patchServerAssistantRowsIntoRuntime,
} from './live-message-patching'

function user(id: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text: id }],
    turnId: id,
  } as UIMessage
}

function runtimeFor(): ConversationRuntime {
  const firstTurn = user('turn-1')
  return {
    askChats: [
      { messages: [firstTurn], setMessages() {}, stop() {} } as never,
      { messages: [firstTurn], setMessages() {}, stop() {} } as never,
      { messages: [], setMessages() {}, stop() {} } as never,
      { messages: [], setMessages() {}, stop() {} } as never,
    ],
    actChat: { messages: [firstTurn], setMessages() {}, stop() {} } as never,
    hydrated: true,
    ui: createConversationUiState({
      selectedActModel: 'model-a',
      selectedModels: ['model-a', 'model-b'],
      askModelSelectionMode: 'multiple',
      exchangeModes: ['act'],
      exchangeModels: [['model-a', 'model-b']],
      selectedTabPerExchange: [0],
      exchangeGenTypes: ['text'],
      isFirstMessage: false,
    }),
  }
}

test('patches live act assistant snapshots into act chat and matching ask slot', () => {
  const runtime = runtimeFor()
  const incoming = {
    _id: 'message-1',
    turnId: 'turn-1',
    role: 'assistant',
    mode: 'act',
    content: 'hello',
    contentType: 'text',
    modelId: 'model-b',
    variantIndex: 1,
    status: 'generating',
  } as LiveConversationMessage

  assert.equal(patchLiveMessagesIntoRuntime(runtime, [incoming]), true)
  assert.equal((runtime.actChat.messages[1] as unknown as { id?: string }).id, 'message-1')
  assert.equal((runtime.askChats[1].messages[1] as unknown as { id?: string }).id, 'message-1')
  assert.equal(runtime.askChats[0].messages.length, 1)
  assert.equal(patchLiveMessagesIntoRuntime(runtime, [incoming]), false)
})

test('patches fallback server rows and ignores identical snapshots', () => {
  const runtime = runtimeFor()

  assert.equal(patchServerAssistantRowsIntoRuntime(runtime, [{
    id: 'message-1',
    turnId: 'turn-1',
    role: 'assistant',
    mode: 'act',
    parts: [{ type: 'text', text: 'done' }],
    model: 'model-a',
    variantIndex: 0,
    status: 'completed',
  }]), true)
  assert.equal((runtime.actChat.messages[1] as unknown as { status?: string }).status, 'completed')
  assert.equal((runtime.askChats[0].messages[1] as unknown as { status?: string }).status, 'completed')
  assert.equal(patchServerAssistantRowsIntoRuntime(runtime, [{
    id: 'message-1',
    turnId: 'turn-1',
    role: 'assistant',
    mode: 'act',
    parts: [{ type: 'text', text: 'done' }],
    model: 'model-a',
    variantIndex: 0,
    status: 'completed',
  }]), false)
})
