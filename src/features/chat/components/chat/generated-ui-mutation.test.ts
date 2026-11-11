import assert from 'node:assert/strict'
import test from 'node:test'
import { Chat } from '@ai-sdk/react'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import type { UIMessageChunk } from 'ai'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { ConversationRuntime } from '../chat-interface/types'
import { removeTransientGeneratedUiPreviews, saveGeneratedUiChange } from './generated-ui-mutation'

test('AI SDK keyed preview parts survive subsequent writes, preserve order, and retain final data', async () => {
  const preview = {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Building view', streaming: true,
    specJson: JSON.stringify({ root: 'view', elements: { view: { type: 'Text', props: { text: 'Hello' } } } }),
  }
  const updated = { ...preview, specJson: JSON.stringify({ root: 'view', elements: { view: { type: 'Text', props: { text: 'Updated' } } } }) }
  const final = { ...updated, streaming: undefined }
  const chunks = [
    { type: 'start', messageId: 'assistant' },
    { type: 'text-start', id: 'before' }, { type: 'text-delta', id: 'before', delta: 'Before' }, { type: 'text-end', id: 'before' },
    { type: 'data-overlay.generated_ui', id: 'render-1', data: preview },
    { type: 'text-start', id: 'after' }, { type: 'text-delta', id: 'after', delta: ' after' }, { type: 'text-end', id: 'after' },
    { type: 'data-overlay.generated_ui', id: 'render-1', data: updated },
    { type: 'data-overlay.generated_ui', id: 'render-1', data: { kind: 'preview-cleared' } },
    { type: 'data-overlay.generated_ui', id: 'render-1', data: final },
    { type: 'finish', finishReason: 'stop' },
  ] as UIMessageChunk[]
  const transport = {
    sendMessages: async () => new ReadableStream<UIMessageChunk>({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close() } }),
    reconnectToStream: async () => null,
  }
  const snapshots: UIMessage[][] = []
  const chat = new Chat({
    id: 'preview-consumer-test',
    transport: transport as never,
    onFinish: ({ messages }) => {
      const settled = removeTransientGeneratedUiPreviews(messages as UIMessage[])
      if (settled !== messages) chat.messages = settled as never
    },
  })
  const unsubscribe = chat['~registerMessagesCallback'](() => snapshots.push(JSON.parse(JSON.stringify(chat.messages)) as UIMessage[]))
  await chat.sendMessage({ text: 'Show a view' })
  unsubscribe()
  const sequences = snapshots.map(messages => buildAssistantVisualSequence(messages.at(-1)?.parts).map(block => block.kind))
  assert.ok(sequences.some(sequence => sequence.join(',') === 'text,generated-ui,text'))
  const visible = snapshots.filter(messages => buildAssistantVisualSequence(messages.at(-1)?.parts).some(block => block.kind === 'generated-ui'))
  assert.ok(visible.length >= 2)
  for (const messages of visible) {
    const part = messages.at(-1)?.parts.find(part => part.type === 'data-overlay.generated_ui' && part.id === 'render-1')
    assert.ok(part)
    assert.equal(messages.at(-1)?.parts.filter(part => part.type === 'data-overlay.generated_ui' && part.id === 'render-1').length, 1)
  }
  const settledPart = chat.messages.at(-1)?.parts.find(part => part.type === 'data-overlay.generated_ui' && part.id === 'render-1')
  assert.ok(settledPart && 'data' in settledPart && (settledPart.data as Record<string, unknown>).streaming === undefined)
  assert.equal(chat.messages.at(-1)?.parts.some(part => part.type === 'data-overlay.generated_ui' && (part.data as Record<string, unknown>)?.kind === 'preview-cleared'), false)
})

test('preview cleanup removes SDK and persisted transient shapes but preserves final data', () => {
  const messages = [{ id: 'assistant', role: 'assistant', parts: [
    { type: 'data-overlay.generated_ui', id: 'sdk-preview', data: { streaming: true } },
    { type: 'data', dataType: 'overlay.generated_ui', id: 'saved-preview', data: { streaming: true } },
    { type: 'data-overlay.generated_ui', id: 'sdk-clear', data: { kind: 'preview-cleared' } },
    { type: 'data', dataType: 'overlay.generated_ui', id: 'saved-clear', data: { kind: 'preview-cleared' } },
    { type: 'data-overlay.generated_ui', id: 'final', data: { version: 1, kind: 'json_render', streaming: undefined } },
  ] }] as unknown as UIMessage[]
  const cleaned = removeTransientGeneratedUiPreviews(messages)
  assert.deepEqual(cleaned[0]?.parts.map(part => part.id), ['final'])
})

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
