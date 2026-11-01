import assert from 'node:assert/strict'
import test from 'node:test'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ConversationRuntime } from '../chat-interface/types'
import { saveGeneratedUiChange } from './generated-ui-mutation'

test('generated UI changes wait for server acceptance, preserve rejected state and serialize edits', async (t) => {
  const messages = [{ id: 'message', role: 'assistant', parts: [{
    type: 'data', id: 'part', dataType: 'overlay.generated_ui', data: { answer: 'original' },
  }] }]
  const runtime = { actChat: { messages }, askChats: [{ messages }] } as unknown as ConversationRuntime
  const responses: Array<(response: Response) => void> = []
  const post = t.mock.method(overlayAppClient.conversations, 'updateMessageUiPartResponse', () => new Promise<Response>((resolve) => {
    responses.push(resolve)
  }))
  const update = (answer: string) => saveGeneratedUiChange({
    conversationId: 'room', runtime, messageId: 'message', partId: 'part',
    data: { answer } as unknown as GeneratedUiData, isCurrent: () => true,
  })
  const first = update('rejected')
  const rejected = assert.rejects(first, /Retired/)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(runtime.actChat.messages, messages)
  responses.shift()!(Response.json({ error: 'Retired', code: 'native_runner_retired' }, { status: 410 }))
  await rejected
  assert.equal(runtime.actChat.messages, messages)
  assert.equal(runtime.askChats[0].messages, messages)
  const second = update('second')
  const third = update('third')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(post.mock.callCount(), 2)
  responses.shift()!(Response.json({ success: true }))
  assert.equal(await second, true)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(post.mock.callCount(), 3)
  responses.shift()!(Response.json({ success: true }))
  assert.equal(await third, true)
  assert.deepEqual(runtime.actChat.messages[0].parts, [{
    type: 'data', id: 'part', dataType: 'overlay.generated_ui', data: { answer: 'third' },
  }])
  assert.deepEqual(runtime.askChats[0].messages, runtime.actChat.messages)
})
