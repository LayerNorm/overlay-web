import assert from 'node:assert/strict'
import test from 'node:test'
import { Chat } from '@ai-sdk/react'
import type { ChatTransport, UIMessage } from 'ai'
import type { ConversationRuntime } from '../chat-interface/types'
import { startActRetryStream, startActTextStream } from './chatTransport'

test('real AI SDK Chat retry rolls both histories back after a swallowed compatibility POST error', async () => {
  const error = Object.assign(new Error('Compatibility is unavailable.'), {
    code: 'native_thread_compatibility_unavailable',
    status: 503,
  })
  const transport = {
    sendMessages: async () => { throw error },
    reconnectToStream: async () => null,
  } as unknown as ChatTransport<UIMessage>
  const user = {
    id: 'turn-1',
    turnId: 'turn-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Continue' }],
  } as UIMessage
  const assistant = {
    id: 'assistant-1',
    turnId: 'turn-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Previous answer' }],
  } as UIMessage
  const laterUser = {
    id: 'turn-2',
    turnId: 'turn-2',
    role: 'user',
    parts: [{ type: 'text', text: 'Later message' }],
  } as UIMessage
  const actMessages = [user, assistant, laterUser]
  const askMessages = [user, assistant, laterUser]
  const actChat = new Chat({ id: 'conversation-1', messages: [...actMessages], transport })
  const runtime = {
    actChat,
    askChats: [{ messages: [...askMessages], stop: () => undefined }],
  } as unknown as ConversationRuntime
  const errors: unknown[] = []

  await startActRetryStream({
    chatId: 'conversation-1',
    targetRuntime: runtime,
    textModelsForTurn: ['model'],
    selectedActModel: 'model',
    turnId: 'turn-1',
    partsForModel: [{ type: 'text', text: 'Continue' }],
    commonBody: {},
    isChatActive: () => false,
    completeSession: () => undefined,
    loadChats: () => undefined,
    loadSubscription: () => undefined,
    onError: (value) => { errors.push(value) },
    logPrefix: 'test retry',
    isRuntimeCurrent: () => true,
  })

  assert.equal(actChat.status, 'error')
  assert.deepEqual(actChat.messages, actMessages)
  assert.deepEqual(runtime.askChats[0].messages, askMessages)
  assert.deepEqual(errors, [])
})

for (const superseded of [false, true]) {
  test(`late SDK compatibility failure ${superseded ? 'preserves a superseding deletion' : 'restores the cached runtime after navigation'}`, async () => {
    let reject!: (error: unknown) => void
    const response = new Promise<never>((_, no) => { reject = no })
    const transport: ChatTransport<UIMessage> = {
      sendMessages: () => response,
      reconnectToStream: async () => null,
    }
    const messages: UIMessage[] = [
      { id: 'turn', role: 'user', parts: [{ type: 'text', text: 'Continue' }] },
      { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Prior answer' }] },
    ]
    const runtime = {
      actChat: new Chat({ id: 'a', messages, transport }),
      askChats: [{ messages: [...messages] }],
    } as unknown as ConversationRuntime
    const other = new Chat({ id: 'b', messages: [...messages], transport })
    let active = 'a'
    const errors: unknown[] = []
    const finished = startActRetryStream({
      chatId: 'a', targetRuntime: runtime, turnId: 'turn',
      textModelsForTurn: ['model'], selectedActModel: 'model',
      partsForModel: [{ type: 'text', text: 'Continue' }], commonBody: {},
      isChatActive: (id) => id === active,
      isRuntimeCurrent: (id, value) => id === 'a' && value === runtime,
      completeSession: () => undefined, loadChats: () => undefined,
      loadSubscription: () => undefined, onError: (error) => { errors.push(error) }, logPrefix: 'test',
    })
    active = 'b'
    const askAfterRetry = runtime.askChats[0].messages
    if (superseded) runtime.actChat.messages = []
    reject(Object.assign(new Error('Retired'), { code: 'native_runner_retired' }))
    await finished
    assert.deepEqual(runtime.actChat.messages, superseded ? [] : messages)
    assert.deepEqual(runtime.askChats[0].messages, superseded ? askAfterRetry : messages)
    assert.deepEqual(other.messages, messages)
    assert.deepEqual(errors, [])
  })
}

test('a failed first turn reports its error before completion activates the real chat', async () => {
  let active = true
  const events: string[] = []
  const runtime = {
    actChat: { sendMessage: async () => { throw new Error('Act rejected') }, error: undefined },
    askChats: [{ messages: [], stop: () => undefined }],
  } as unknown as ConversationRuntime

  await startActTextStream({
    chatId: 'pending-first',
    targetRuntime: runtime,
    textModelsForTurn: ['model'],
    selectedActModel: 'model',
    turnId: 'turn-1',
    partsForModel: [{ type: 'text', text: 'Hello' }],
    commonBody: {},
    isChatActive: () => active,
    completeSession: (_id, wasActive) => {
      events.push(`complete:${wasActive}`)
      active = false
    },
    loadSubscription: () => undefined,
    onError: () => { events.push('error') },
    logPrefix: 'test',
  } as unknown as Parameters<typeof startActTextStream>[0])

  assert.deepEqual(events, ['error', 'complete:true'])
})
