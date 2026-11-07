import assert from 'node:assert/strict'
import test from 'node:test'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { ConversationRuntime } from '../chat-interface/types'
import { saveGeneratedUiChange } from './generated-ui-mutation'

test('generated UI changes wait for server acceptance, preserve rejected state and serialize edits', async () => {
  const messages = [{ id: 'message', role: 'assistant', parts: [{
    type: 'data', id: 'part', dataType: 'overlay.generated_ui', data: { answer: 'original' },
  }] }]
  const runtime = { actChat: { messages }, askChats: [{ messages }] } as unknown as ConversationRuntime
  const pending: Array<{ resolve(): void; reject(error: Error): void }> = []
  let calls = 0
  const persist = () => new Promise<void>((resolve, reject) => {
    calls += 1
    pending.push({ resolve, reject })
  })
  const update = (answer: string) => saveGeneratedUiChange({
    conversationId: 'chat', persist, runtime, messageId: 'message', partId: 'part',
    data: { answer } as unknown as GeneratedUiData, isCurrent: () => true,
  })
  const first = update('rejected')
  const rejected = assert.rejects(first, /Could not save draft edits/)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(runtime.actChat.messages, messages)
  pending.shift()!.reject(new Error('NATIVE_RUN_RETIRED'))
  await rejected
  assert.equal(runtime.actChat.messages, messages)
  assert.equal(runtime.askChats[0].messages, messages)
  const second = update('second')
  const third = update('third')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(calls, 2)
  pending.shift()!.resolve()
  assert.equal(await second, true)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(calls, 3)
  pending.shift()!.resolve()
  assert.equal(await third, true)
  assert.deepEqual(runtime.actChat.messages[0].parts, [{
    type: 'data', id: 'part', dataType: 'overlay.generated_ui', data: { answer: 'third' },
  }])
  assert.deepEqual(runtime.askChats[0].messages, runtime.actChat.messages)
})
