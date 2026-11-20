import assert from 'node:assert/strict'
import test from 'node:test'
import type { PersonalTranscriptRow } from './personal-transcript'
import { createWebChatTranscriptAdapter } from './toChatTranscriptView'
import { embeddedPersonalExchanges } from './embedded-personal-transcript'

type Message = PersonalTranscriptRow['message']

function message(overrides: Partial<Message> & Pick<Message, '_id' | 'role'>): Message {
  return {
    _creationTime: 1,
    conversationId: 'conversation',
    userId: 'user',
    turnId: 'turn-1',
    mode: 'act',
    content: '',
    contentType: 'text',
    createdAt: overrides.role === 'user' ? 1 : 2,
    ...overrides,
  } as Message
}

function rows(...messages: Message[]): PersonalTranscriptRow[] {
  return messages.map((entry) => ({ message: entry, contextUser: null, outputs: [] }))
}

const question = message({ _id: 'user-1', role: 'user', content: 'Tighten the intro', parts: [{ type: 'text', text: 'Tighten the intro' }] })
const view = (input: Omit<Parameters<typeof embeddedPersonalExchanges>[0], 'toTranscriptView'>) =>
  embeddedPersonalExchanges({ ...input, toTranscriptView: createWebChatTranscriptAdapter() })

test('a generating reply streams its live text with tool rows and stays in progress', () => {
  const reply = message({
    _id: 'reply-1', role: 'assistant', status: 'generating', modelId: 'model', content: 'Reading the note',
    parts: [
      { type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'read_note', state: 'result', toolInput: {}, toolOutput: { ok: true } } },
      { type: 'text', text: 'Reading the note' },
    ],
  })
  const [entry] = view({ rows: rows(question, reply), pendingSend: null, endedTurn: null })
  assert.equal(entry!.responseInProgress, true)
  assert.equal(entry!.errorMessage, null)
  assert.equal(entry!.exchange.user.text, 'Tighten the intro')
  const blocks = entry!.exchange.responses.at(-1)!.blocks
  assert.ok(blocks.some((block) => block.kind === 'text' && block.text.includes('Reading the note')))
  assert.ok(blocks.some((block) => block.kind !== 'text'))
})

test('a pending send shows its message before the saved row and is in progress', () => {
  const pendingSend = { turnId: 'turn-2', text: 'Add a summary', createdAt: 5 }
  const reply = message({ _id: 'reply-1', role: 'assistant', status: 'completed', content: 'Done', parts: [{ type: 'text', text: 'Done' }] })
  const exchanges = view({ rows: rows(question, reply), pendingSend, endedTurn: null })
  assert.deepEqual(exchanges.map((entry) => entry.exchange.turnId), ['turn-1', 'turn-2'])
  assert.equal(exchanges[0]!.responseInProgress, false)
  assert.equal(exchanges[1]!.exchange.user.text, 'Add a summary')
  assert.equal(exchanges[1]!.responseInProgress, true)
})

test('a turn this surface stopped shows the interrupted state and no loading mark', () => {
  const reply = message({ _id: 'reply-1', role: 'assistant', status: 'generating', content: 'Half', parts: [{ type: 'text', text: 'Half' }] })
  const [entry] = view({ rows: rows(question, reply), pendingSend: null, endedTurn: { turnId: 'turn-1', outcome: 'cancelled' } })
  assert.equal(entry!.responseInProgress, false)
  assert.equal(entry!.interrupted, true)
  assert.equal(entry!.exchange.status, 'interrupted')
})

test('a failed run ends in the failed state even before its row settles', () => {
  const reply = message({ _id: 'reply-1', role: 'assistant', status: 'generating', content: '', parts: [] })
  const [entry] = view({ rows: rows(question, reply), pendingSend: null, endedTurn: { turnId: 'turn-1', outcome: 'failed' } })
  assert.equal(entry!.responseInProgress, false)
  assert.equal(entry!.interrupted, false)
  assert.equal(entry!.errorMessage, 'The response could not be completed.')
})

test('a saved error reply shows its recorded reason, as chat does', () => {
  const reply = message({
    _id: 'reply-1', role: 'assistant', status: 'error', content: '',
    parts: [{ type: 'data-native-agent-error', data: { runId: 'run', code: 'model_failed', message: 'The model is unavailable.', retryable: true, failedAt: 3 } }],
  })
  const [entry] = view({ rows: rows(question, reply), pendingSend: null, endedTurn: null })
  assert.equal(entry!.responseInProgress, false)
  assert.equal(entry!.errorMessage, 'The model is unavailable.')
  const unexplained = view({
    rows: rows(question, message({ _id: 'reply-1', role: 'assistant', status: 'error', content: '', parts: [] })),
    pendingSend: null, endedTurn: null,
  })
  assert.equal(unexplained[0]!.errorMessage, 'This response failed. No failure reason is available.')
})
