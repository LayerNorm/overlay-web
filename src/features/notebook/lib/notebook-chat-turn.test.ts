import assert from 'node:assert/strict'
import test from 'node:test'
import type { NotebookAgentRequest } from '@overlay/app-core'
import {
  admissionStreamError,
  runNotebookChatTurn,
  type NotebookChatTurn,
  type NotebookTurnOutcome,
  type NotebookTurnSettlement,
} from './notebook-chat-turn'

const request: NotebookAgentRequest = {
  noteId: 'note-1', noteContent: '# Draft', noteTitle: 'Draft', message: 'Tighten the intro', modelId: 'model',
}
const target = { workspaceId: 'workspace', conversationId: 'conversation' }
const admitted = 'data: {"type":"start"}\n\ndata: {"type":"message-metadata","messageMetadata":{"harnessAccepted":{"liveTransport":"convex"}}}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n'

function harness(options: { response?: Response; settlement?: Promise<NotebookTurnSettlement> } = {}) {
  const acts: Array<{ body: Record<string, unknown>; options: Record<string, unknown> }> = []
  const stops: string[] = []
  const waits: unknown[] = []
  const events: Array<{ kind: 'start' | 'end'; turn: NotebookChatTurn; outcome?: NotebookTurnOutcome }> = []
  const client = {
    actResponse: async (body: Record<string, unknown>, init: Record<string, unknown>) => {
      acts.push({ body, options: init })
      return options.response ?? new Response(admitted, { status: 200 })
    },
    stopResponse: async ({ conversationId }: { conversationId: string }) => {
      stops.push(conversationId)
      return { success: true }
    },
  }
  const run = (signal: AbortSignal) => runNotebookChatTurn({
    request,
    signal,
    ensureConversation: async () => target,
    waitForTurn: (turn) => {
      waits.push(turn)
      return options.settlement ?? Promise.resolve('completed')
    },
    onTurnStart: (turn) => events.push({ kind: 'start', turn }),
    onTurnEnd: (turn, outcome) => events.push({ kind: 'end', turn, outcome }),
    client: client as never,
    now: () => 42,
  })
  return { acts, stops, waits, events, run }
}

test('sends on the note chat with Convex live transport and resolves when the turn settles', async () => {
  const { acts, waits, events, run } = harness()
  assert.equal(await run(new AbortController().signal), undefined)
  assert.equal(acts.length, 1)
  const turnId = acts[0]!.body.turnId as string
  assert.deepEqual({ ...acts[0]!.body, turnId: undefined, messages: undefined }, {
    conversationId: 'conversation', turnId: undefined, mode: 'chat', modelId: 'model', notebookNoteId: 'note-1',
    liveTransport: 'convex', messages: undefined,
  })
  assert.deepEqual(acts[0]!.body.messages, [{ id: turnId, role: 'user', parts: [{ type: 'text', text: 'Tighten the intro' }] }])
  assert.deepEqual(waits, [{ ...target, turnId }])
  assert.deepEqual(events.map((event) => [event.kind, event.outcome]), [['start', undefined], ['end', 'completed']])
  assert.deepEqual(events[0]!.turn, { ...target, turnId, noteId: 'note-1', text: 'Tighten the intro', modelId: 'model', createdAt: 42 })
})

test('a failed or cancelled execution resolves and reports its outcome', async () => {
  for (const outcome of ['failed', 'cancelled'] as const) {
    const { events, run } = harness({ settlement: Promise.resolve(outcome) })
    assert.equal(await run(new AbortController().signal), undefined)
    assert.equal(events.at(-1)!.outcome, outcome)
  }
})

test('a refused send returns its response for the editor to show and never waits', async () => {
  const refused = new Response(JSON.stringify({ error: 'Out of credit' }), { status: 402 })
  const { waits, events, run } = harness({ response: refused })
  assert.equal(await run(new AbortController().signal), refused)
  assert.deepEqual(waits, [])
  assert.equal(events.at(-1)!.outcome, 'rejected')
})

test('an admission error in the stream or a lost conversation throws a visible error', async () => {
  const errored = new Response('data: {"type":"error","errorText":"The durable stream is unavailable."}\n\n', { status: 200 })
  const rejected = harness({ response: errored })
  await assert.rejects(rejected.run(new AbortController().signal), /durable stream is unavailable/)
  assert.deepEqual(rejected.waits, [])
  assert.equal(rejected.events.at(-1)!.outcome, 'rejected')

  const lost = harness({ settlement: Promise.resolve('unavailable') })
  await assert.rejects(lost.run(new AbortController().signal), /no longer available/)
  assert.equal(lost.events.at(-1)!.outcome, 'unavailable')
})

test('stopping or leaving the note stops the run and ends the wait at once', async () => {
  const controller = new AbortController()
  const { stops, events, run } = harness({ settlement: new Promise(() => {}) })
  const running = run(controller.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(events.length, 1)
  controller.abort()
  assert.equal(await running, undefined)
  assert.deepEqual(stops, ['conversation'])
  assert.equal(events.at(-1)!.outcome, 'cancelled')
})

test('a stop before the request is answered stops the run and rethrows the abort', async () => {
  const controller = new AbortController()
  const stops: string[] = []
  const events: NotebookTurnOutcome[] = []
  const running = runNotebookChatTurn({
    request,
    signal: controller.signal,
    ensureConversation: async () => target,
    waitForTurn: async () => 'completed',
    onTurnEnd: (_turn, outcome) => events.push(outcome),
    client: {
      actResponse: (_body: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
      stopResponse: async ({ conversationId }: { conversationId: string }) => { stops.push(conversationId) },
    } as never,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
  await assert.rejects(running, /Aborted/)
  assert.deepEqual(stops, ['conversation'])
  assert.deepEqual(events, ['cancelled'])
})

test('admission stream errors are read from the SSE body', () => {
  assert.equal(admissionStreamError(admitted), null)
  assert.equal(admissionStreamError('data: {"type":"error"}\n\n'), 'The response could not be completed.')
  assert.equal(admissionStreamError('data: not-json\n\n'), null)
})
