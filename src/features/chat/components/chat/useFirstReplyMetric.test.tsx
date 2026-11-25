import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core'
import { CapabilitiesProvider } from '@/components/providers/CapabilitiesProvider'
import { createFirstReplyTracker, type FirstReplyProperties, type FirstReplyTracker } from '@/shared/chat/first-reply-timing'
import { PENDING_FIRST_CHAT_ID, TEMPORARY_CHAT_ID } from './chat-send-body-builders'
import { useFirstReplyMetric } from './useFirstReplyMetric'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

type Message = { id: string; role: string; turnId?: string; status?: string; parts?: Array<{ type: string; text?: string }>; metadata?: unknown }
type Props = { shown: string | null; native?: Message[]; sdk?: Message[] }

const NONE: Message[] = []
const user = (turnId: string): Message => ({ id: turnId, role: 'user', turnId, parts: [{ type: 'text', text: 'hello' }] })
const reply = (turnId: string, text: string): Message => ({
  id: `reply-${turnId}`, role: 'assistant', turnId, status: 'generating', parts: [{ type: 'text', text }],
})

function withDocument(run: (hide: () => void) => Promise<void>) {
  const listeners = new Set<() => void>()
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  const hide = () => {
    fakeDocument.visibilityState = 'hidden'
    for (const listener of listeners) listener()
  }
  return run(hide).finally(() => {
    Reflect.deleteProperty(globalThis, 'document')
    assert.equal(listeners.size, 0, 'the visibility listener is removed on unmount')
  })
}

function mount(tracker: FirstReplyTracker, analytics: boolean) {
  const sent: FirstReplyProperties[] = []
  const send = (properties: FirstReplyProperties) => { sent.push(properties) }
  function Harness({ shown, native = NONE, sdk = NONE }: Props) {
    useFirstReplyMetric({ shownConversationId: shown, native, sdk, tracker, send })
    return null
  }
  let renderer: ReactTestRenderer | null = null
  const element = (props: Props) => (
    <CapabilitiesProvider initialCapabilities={{ ...DEFAULT_OVERLAY_CAPABILITIES, analytics }}>
      <Harness {...props} />
    </CapabilitiesProvider>
  )
  return {
    sent,
    render: async (props: Props) => {
      await act(async () => {
        if (renderer) renderer.update(element(props))
        else renderer = create(element(props))
      })
    },
    unmount: async () => { await act(async () => renderer?.unmount()) },
  }
}

const start = { startedAt: performance.now(), modelId: 'model-a', isNewChat: false, hidden: false }

test('the Convex path sends exactly one event, after the render that shows text', () => withDocument(async () => {
  const tracker = createFirstReplyTracker()
  const view = mount(tracker, true)
  tracker.begin('turn-1', { ...start, native: true, conversationId: 'chat-a' })
  const history = [user('turn-0'), { ...reply('turn-0', 'Earlier answer'), status: 'completed' }]
  await view.render({ shown: 'chat-a', native: [...history, user('turn-1')] })
  await view.render({ shown: 'chat-a', native: [...history, user('turn-1'), reply('turn-1', '')] })
  assert.equal(view.sent.length, 0, 'history and an empty generating reply do not count')
  await view.render({ shown: 'chat-a', native: [...history, user('turn-1'), reply('turn-1', 'Hi')] })
  await view.render({ shown: 'chat-a', native: [...history, user('turn-1'), reply('turn-1', 'Hi there')] })
  assert.equal(view.sent.length, 1)
  assert.equal(view.sent[0]!.transport, 'convex')
  assert.equal(view.sent[0]!.model_id, 'model-a')
  assert.equal(Number.isInteger(view.sent[0]!.ttft_ms), true)
  await view.unmount()
}))

test('the SSE path sends exactly one event for a temporary chat', () => withDocument(async () => {
  const tracker = createFirstReplyTracker()
  const view = mount(tracker, true)
  tracker.begin('turn-1', { ...start, native: false, conversationId: TEMPORARY_CHAT_ID })
  await view.render({ shown: TEMPORARY_CHAT_ID, sdk: [user('turn-1'), { id: 'a1', role: 'assistant', parts: [] }] })
  await view.render({ shown: TEMPORARY_CHAT_ID, sdk: [user('turn-1'), { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }] })
  await view.render({ shown: TEMPORARY_CHAT_ID, sdk: [user('turn-1'), { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi!' }] }] })
  assert.deepEqual(view.sent.map(event => event.transport), ['sse'])
  await view.unmount()
}))

test('a new chat keeps its turn through the pending first chat id, and hiding the tab marks it', () => withDocument(async (hide) => {
  const tracker = createFirstReplyTracker()
  const view = mount(tracker, true)
  tracker.begin('turn-1', { ...start, isNewChat: true, native: true, conversationId: null })
  await view.render({ shown: PENDING_FIRST_CHAT_ID, native: [user('turn-1')] })
  hide()
  tracker.persisted('turn-1', 'chat-new')
  await view.render({ shown: 'chat-new', native: [user('turn-1'), reply('turn-1', 'Hi')] })
  assert.deepEqual(view.sent.map(event => [event.is_new_chat, event.was_hidden]), [[true, true]])
  await view.unmount()
}))

test('no event is sent when analytics is off, and the turn is still cleaned up', () => withDocument(async () => {
  const tracker = createFirstReplyTracker()
  const view = mount(tracker, false)
  tracker.begin('turn-1', { ...start, native: true, conversationId: 'chat-a' })
  await view.render({ shown: 'chat-a', native: [user('turn-1'), reply('turn-1', 'Hi')] })
  assert.equal(view.sent.length, 0)
  assert.equal(tracker.pendingCount(), 0)
  await view.unmount()
}))
