import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClientSession, MessageResponse, MessageStreamEvent } from 'eve/client'
import type { NormalizedAgentEvent } from './adapter'
import { EveAgentAdapter } from './eve-adapter'

test('Eve adapter creates one durable session and normalizes visible turn output', async () => {
  const events: NormalizedAgentEvent[] = []
  const persisted: Array<Record<string, unknown>> = []
  let createMessage = ''
  let sendCalls = 0
  const session = fakeSession('eve-session-1')
  const first = response(session, [
    event('turn.started', { sequence: 1, turnId: 'turn-1' }),
    event('message.appended', { messageDelta: 'Hello', messageSoFar: 'Hello', sequence: 1, stepIndex: 0, turnId: 'turn-1' }),
    event('reasoning.completed', { reasoning: 'private chain of thought', sequence: 1, stepIndex: 0, turnId: 'turn-1' }),
    event('actions.requested', { actions: [{ callId: 'call-1', kind: 'tool-call', toolName: 'read_file', input: { path: 'README.md' } }], sequence: 1, stepIndex: 0, turnId: 'turn-1' }),
    event('action.result', { result: { callId: 'call-1', kind: 'tool-result', toolName: 'read_file', output: 'done' }, sequence: 1, stepIndex: 0, status: 'completed', turnId: 'turn-1' }),
    event('step.completed', { finishReason: 'stop', sequence: 1, stepIndex: 0, turnId: 'turn-1', usage: { inputTokens: 10, outputTokens: 4 } }),
    event('turn.completed', { sequence: 1, turnId: 'turn-1' }),
  ])
  session.send = (async () => { sendCalls += 1; return response(session, []) }) as never

  const adapter = new EveAgentAdapter({ host: 'http://127.0.0.1:3000', clientFactory: () => ({ sessions: {
    create: async ({ message }) => { createMessage = message; return { session, response: first } },
    attach: () => session,
  } }) })
  const connected = await adapter.start({
    runId: 'run-1', workingDirectory: '/workspace', additionalDirectories: [], prompt: 'hello', metadata: {},
    persistAdapterState: (state) => persisted.push(state),
  }, async (value) => { events.push(value) })
  await connected.prompt('hello')

  assert.equal(createMessage, 'hello')
  assert.equal(sendCalls, 0, 'the initial prompt is not sent twice')
  assert.equal(connected.remoteSessionId, 'eve-session-1')
  assert.ok(events.some((value) => value.type === 'text_checkpoint' && value.payload.text === 'Hello'))
  assert.ok(events.some((value) => value.type === 'action' && value.payload.actionId === 'call-1' && value.payload.status === 'completed'))
  assert.ok(events.some((value) => value.type === 'completed' && value.payload.usage.inputTokens === 10))
  assert.equal(JSON.stringify(events).includes('private chain of thought'), false)
  assert.deepEqual(persisted.at(-1), {
    sessionId: 'eve-session-1', streamIndex: 7,
    pendingRequests: [], requestBatches: [], pendingResponses: [],
  })
})

test('Eve adapter validates pending approvals and resumes from its persisted cursor', async () => {
  const events: NormalizedAgentEvent[] = []
  const session = fakeSession('eve-session-2')
  let attachedCursor: number | undefined
  let responseValue: unknown
  let cancelCalls = 0
  session.respond = (async (responses: unknown) => {
    responseValue = responses
    return response(session, [event('turn.completed', { sequence: 2, turnId: 'turn-2' })])
  }) as never
  session.cancel = async () => { cancelCalls += 1; return { status: 'cancellation-requested' } as never }
  session.stream = () => response(session, [
    event('input.requested', {
      requests: [{
        requestId: 'permission-1', kind: 'tool-approval', prompt: 'Run command?',
        options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }],
        action: { callId: 'call-2', kind: 'tool-call', toolName: 'bash', input: { command: 'pwd' } },
      }],
      sequence: 2, stepIndex: 0, turnId: 'turn-2',
    }),
    event('session.waiting', { continuationToken: 'eve-session-2', wait: 'next-user-message' }),
  ])

  const adapter = new EveAgentAdapter({ host: 'http://127.0.0.1:3000', clientFactory: () => ({ sessions: {
    create: async () => { throw new Error('should attach') },
    attach: (_sessionId, options) => { attachedCursor = options?.streamIndex; return session },
  } }) })
  const connected = await adapter.start({
    runId: 'run-2', workingDirectory: '/workspace', additionalDirectories: [], prompt: '', remoteSessionId: 'eve-session-2', metadata: {},
    adapterState: { sessionId: 'eve-session-2', streamIndex: 12 },
  }, async (value) => { events.push(value) })
  await connected.resume()
  assert.equal(attachedCursor, 12)
  assert.ok(events.some((value) => value.type === 'approval_requested'))
  await assert.rejects(connected.approve('permission-1', 'forged'), /does not match/)
  await connected.approve('permission-1', 'allow')
  assert.deepEqual(responseValue, [{ requestId: 'permission-1', optionId: 'allow' }])
  await connected.cancel()
  assert.equal(cancelCalls, 1)

  await assert.rejects(adapter.start({
    runId: 'run-3', workingDirectory: '/workspace', additionalDirectories: [], prompt: '', remoteSessionId: 'eve-session-2', metadata: {},
  }, async () => undefined), /persisted durable stream cursor/)
})

test('Eve adapter restores a parked approval across a host restart', async () => {
  const session = fakeSession('eve-session-3')
  let responseValue: unknown
  session.respond = (async (responses: unknown) => {
    responseValue = responses
    return response(session, [event('turn.completed', { sequence: 3, turnId: 'turn-3' })])
  }) as never
  const adapter = new EveAgentAdapter({ host: 'http://127.0.0.1:3000', clientFactory: () => ({ sessions: {
    create: async () => { throw new Error('should attach') },
    attach: () => session,
  } }) })
  const connected = await adapter.start({
    runId: 'run-3', workingDirectory: '/workspace', additionalDirectories: [], prompt: '', remoteSessionId: 'eve-session-3', metadata: {},
    adapterState: {
      sessionId: 'eve-session-3', streamIndex: 8,
      pendingRequests: [['permission-3', { kind: 'tool-approval', options: [{ id: 'allow', label: 'Allow' }] }]],
      requestBatches: [['permission-3', ['permission-3']]],
      pendingResponses: [],
    },
  }, async () => undefined)
  await connected.approve('permission-3', 'allow')
  assert.deepEqual(responseValue, [{ requestId: 'permission-3', optionId: 'allow' }])
})

function fakeSession(sessionId: string) {
  const state = { sessionId, streamIndex: 0 }
  return {
    state,
    send: async () => response({ state } as never, []),
    respond: async () => response({ state } as never, []),
    cancel: async () => ({ status: 'cancellation-requested' }),
    stream: () => response({ state } as never, []),
  } as unknown as Pick<ClientSession, 'state' | 'send' | 'respond' | 'cancel' | 'stream'> & {
    send: ClientSession['send']; respond: ClientSession['respond']; cancel: ClientSession['cancel']; stream: ClientSession['stream']
  }
}

function response(session: { state: { streamIndex: number } }, events: MessageStreamEvent[]) {
  return {
    sessionId: 'sessionId' in session.state ? String(session.state.sessionId) : 'eve-session',
    cancel: async () => ({ status: 'cancellation-requested' }),
    async *[Symbol.asyncIterator]() {
      for (const value of events) {
        session.state.streamIndex += 1
        yield value
      }
    },
  } as unknown as MessageResponse
}

function event<T extends MessageStreamEvent['type']>(type: T, data: unknown): Extract<MessageStreamEvent, { type: T }> {
  return { type, data, meta: { id: `event-${Math.random()}`, at: new Date(0).toISOString() } } as unknown as Extract<MessageStreamEvent, { type: T }>
}
