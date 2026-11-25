import assert from 'node:assert/strict'
import test from 'node:test'
import { INTERRUPTED_RESPONSE_NOTICE } from './agent-assistant-text'
import {
  createFirstReplyTracker,
  firstReplyProgress,
  SETTLED_REPLY_GRACE_MS,
  type FirstReplyStart,
} from './first-reply-timing'

type Message = Parameters<typeof firstReplyProgress>[2]['native'][number]

const user = (turnId: string): Message => ({ id: turnId, role: 'user', turnId, parts: [{ type: 'text', text: 'hello' }] })
const reply = (turnId: string, text: string, extra: Partial<Message> = {}): Message => ({
  id: `reply-${turnId}`, role: 'assistant', turnId, status: 'generating', parts: [{ type: 'text', text }], ...extra,
})
const convexLive = { harnessAccepted: { liveTransport: 'convex' } }
const start = (extra: Partial<FirstReplyStart> = {}): FirstReplyStart => ({
  startedAt: 1_000, modelId: 'model-a', isNewChat: false, native: true, conversationId: 'chat-a', hidden: false, ...extra,
})

test('a Convex reply reports once, when its first text shows', () => {
  const tracker = createFirstReplyTracker()
  tracker.begin('turn-1', start())
  const sdk = [user('turn-1'), { id: 'sdk-1', role: 'assistant', parts: [], metadata: convexLive }]
  assert.deepEqual(tracker.observe('chat-a', { native: [user('turn-1')], sdk }, 1_100), [])
  assert.deepEqual(tracker.observe('chat-a', { native: [user('turn-1'), reply('turn-1', '')], sdk }, 1_200), [])
  assert.deepEqual(tracker.observe('chat-a', { native: [user('turn-1'), reply('turn-1', 'Hi')], sdk }, 1_234.6), [{
    ttft_ms: 235, model_id: 'model-a', is_new_chat: false, was_hidden: false, transport: 'convex',
  }])
  assert.deepEqual(tracker.observe('chat-a', { native: [user('turn-1'), reply('turn-1', 'Hi there')], sdk }, 1_300), [])
  tracker.begin('turn-1', start())
  assert.equal(tracker.pendingCount(), 0, 'a reported turn is never measured again')
})

test('an SSE reply reports once, with the sse transport', () => {
  const tracker = createFirstReplyTracker()
  tracker.begin('turn-1', start({ native: false, conversationId: 'temporary', isNewChat: true }))
  const waiting = [user('turn-1'), { id: 'sdk-1', role: 'assistant', parts: [{ type: 'step-start' }] }]
  assert.deepEqual(tracker.observe('temporary', { native: [], sdk: waiting }, 1_050), [])
  const shown = [user('turn-1'), { id: 'sdk-1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }]
  assert.deepEqual(tracker.observe('temporary', { native: [], sdk: shown }, 1_400), [{
    ttft_ms: 400, model_id: 'model-a', is_new_chat: true, was_hidden: false, transport: 'sse',
  }])
  assert.deepEqual(tracker.observe('temporary', { native: [], sdk: shown }, 1_500), [])
})

test('a native turn whose act response relayed the text reports sse', () => {
  const sdk = [user('turn-1'), { id: 'sdk-1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] }]
  assert.deepEqual(firstReplyProgress('turn-1', { native: true, settledAt: null },
    { native: [user('turn-1'), reply('turn-1', 'Hi')], sdk }, 0), { transport: 'sse' })
})

test('historical and unrelated replies never report', () => {
  const tracker = createFirstReplyTracker()
  tracker.begin('turn-2', start())
  const native = [user('turn-1'), reply('turn-1', 'Earlier answer', { status: 'completed' }), user('turn-2')]
  const sdk = [user('turn-1'), { id: 'sdk-old', role: 'assistant', parts: [{ type: 'text', text: 'Earlier' }] }, user('turn-2')]
  assert.deepEqual(tracker.observe('chat-a', { native, sdk }, 2_000), [])
  assert.deepEqual(tracker.observe('chat-a', { native: [...native, reply('turn-3', 'Other turn')], sdk }, 2_100), [])
  assert.equal(tracker.pendingCount(), 1)
})

test('incomplete replies wait: blank text, reasoning and tool parts do not count', () => {
  for (const parts of [[{ type: 'text', text: '  \n' }], [{ type: 'reasoning', text: 'Thinking' }], [{ type: 'tool-web_search' }]]) {
    assert.equal(firstReplyProgress('turn-1', { native: true, settledAt: null },
      { native: [user('turn-1'), reply('turn-1', '', { parts })], sdk: [] }, 0), 'waiting')
  }
})

test('replies that end without text are dropped, not reported later', () => {
  const tracker = createFirstReplyTracker()
  tracker.begin('native', start())
  tracker.begin('sse', start({ native: false }))
  const failed = reply('native', '', { status: 'error', parts: [] })
  assert.deepEqual(tracker.observe('chat-a', { native: [user('native'), failed], sdk: [] }, 1_100), [])
  assert.equal(tracker.pendingCount(), 1)
  assert.deepEqual(tracker.observe('chat-a', { native: [user('native'), reply('native', 'Retry text')], sdk: [] }, 1_200), [])

  tracker.settle('sse', 1_300)
  assert.deepEqual(tracker.observe('chat-a', { native: [], sdk: [user('sse')] }, 1_300 + SETTLED_REPLY_GRACE_MS), [])
  assert.equal(tracker.pendingCount(), 0)
})

test('error replies and the cancellation notice are not first text', () => {
  const submitError = reply('submit', 'Message could not be saved. Retry to send.', {
    id: 'native-submit-error:submit', status: 'error' })
  const streamError = reply('stream', 'The response could not be received. Retry to continue.', {
    id: 'native-stream-error:stream', status: 'error' })
  const failedRun = reply('failed', 'Partial', { status: 'error' })
  const cancelled = reply('cancelled', '', { status: 'completed', parts: [{ type: 'text', text: INTERRUPTED_RESPONSE_NOTICE }] })
  const tracker = createFirstReplyTracker()
  for (const turnId of ['submit', 'stream', 'failed', 'cancelled']) tracker.begin(turnId, start())
  const native = [submitError, streamError, failedRun, cancelled].flatMap(message => [user(message.turnId!), message])
  assert.deepEqual(tracker.observe('chat-a', { native, sdk: [] }, 1_200), [])
  assert.equal(tracker.pendingCount(), 0, 'each ended without text and is dropped')
  assert.deepEqual(firstReplyProgress('stream', { native: false, settledAt: null },
    { native: [], sdk: [user('stream'), { ...streamError, role: 'assistant' }] }, 0), 'waiting', 'an error note relayed over SSE does not count either')
})

test('a settled native turn waits a grace period for a late reply, then is dropped', () => {
  const tracker = createFirstReplyTracker()
  tracker.begin('late', start())
  tracker.begin('never', start())
  tracker.begin('lagging', start())
  for (const turnId of ['late', 'never', 'lagging']) tracker.settle(turnId, 2_000)
  const early = { native: [user('late'), user('never'), user('lagging'), reply('lagging', '')], sdk: [] }
  assert.deepEqual(tracker.observe('chat-a', early, 2_100), [])
  assert.equal(tracker.pendingCount(), 3, 'nothing is dropped inside the grace period')
  const lateReply = { ...early, native: [...early.native, reply('late', 'Here it is')] }
  assert.deepEqual(tracker.observe('chat-a', lateReply, 3_000).map(event => event.ttft_ms), [2_000])
  assert.deepEqual(tracker.observe('chat-a', early, 2_000 + SETTLED_REPLY_GRACE_MS), [])
  assert.equal(tracker.pendingCount(), 1, 'no reply at all is dropped; a reply still generating keeps waiting')
  const finished = { native: [user('lagging'), reply('lagging', 'Done', { status: 'completed' })], sdk: [] }
  assert.equal(tracker.observe('chat-a', finished, 9_000).length, 1)
})

test('was_hidden covers only turns waiting while the tab was hidden', () => {
  const tracker = createFirstReplyTracker()
  tracker.begin('turn-1', start())
  tracker.markHidden()
  tracker.begin('turn-2', start())
  tracker.begin('turn-3', start({ hidden: true }))
  const native = ['turn-1', 'turn-2', 'turn-3'].flatMap(id => [user(id), reply(id, 'Hi')])
  assert.deepEqual(tracker.observe('chat-a', { native, sdk: [] }, 1_500).map(event => event.was_hidden), [true, false, true])
})

test('leaving the conversation drops the turn, except while a new chat is being saved', () => {
  const tracker = createFirstReplyTracker()
  const shown = (id: string) => ({ native: [user(id), reply(id, 'Hi')], sdk: [] })

  tracker.begin('existing', start())
  assert.deepEqual(tracker.observe('chat-b', { native: [], sdk: [] }, 1_100), [])
  assert.deepEqual(tracker.observe('chat-a', shown('existing'), 1_200), [], 'returning later does not report')

  tracker.begin('to-blank', start())
  assert.deepEqual(tracker.observe(null, { native: [], sdk: [] }, 1_100), [])
  assert.equal(tracker.pendingCount(), 0)

  tracker.begin('new', start({ conversationId: null, isNewChat: true }))
  assert.deepEqual(tracker.observe(null, { native: [], sdk: [] }, 1_100), [])
  tracker.persisted('new', 'chat-new')
  assert.deepEqual(tracker.observe(null, { native: [], sdk: [] }, 1_150), [], 'the view can lag the saved id')
  assert.equal(tracker.observe('chat-new', shown('new'), 1_300).length, 1)

  tracker.begin('new-left', start({ conversationId: null, isNewChat: true }))
  tracker.persisted('new-left', 'chat-new-2')
  assert.deepEqual(tracker.observe('chat-b', shown('new-left'), 1_300), [])
  assert.equal(tracker.pendingCount(), 0)
})

test('tracking stays bounded to the most recent turns', () => {
  const tracker = createFirstReplyTracker()
  for (let index = 0; index < 20; index++) tracker.begin(`turn-${index}`, start())
  assert.equal(tracker.pendingCount(), 8)
  const native = [user('turn-0'), reply('turn-0', 'Hi'), user('turn-19'), reply('turn-19', 'Hi')]
  assert.equal(tracker.observe('chat-a', { native, sdk: [] }, 1_500).length, 1, 'the oldest turn was evicted')
})
