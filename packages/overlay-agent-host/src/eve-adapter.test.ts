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
    event('session.waiting', { continuationToken: 'eve-session-1', wait: 'next-user-message' }),
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
    sessionId: 'eve-session-1', streamIndex: 8,
    pendingRequests: [], requestBatches: [], pendingResponses: [],
    textByStep: [[0, 'Hello']],
    usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  })
})

test('Eve adapter fails closed when Eve requests unsupported external authorization', async () => {
  const events: NormalizedAgentEvent[] = []
  const session = fakeSession('eve-session-auth')
  const adapter = new EveAgentAdapter({ host: 'http://127.0.0.1:3000', clientFactory: () => ({ sessions: {
    create: async () => ({ session, response: response(session, [
      event('authorization.required', {
        name: 'linear', description: 'Connect Linear', sequence: 1, stepIndex: 0, turnId: 'turn-auth',
      }),
      event('session.waiting', { continuationToken: 'eve-session-auth', wait: 'next-user-message' }),
    ]) }),
    attach: () => session,
  } }) })
  const connected = await adapter.start({
    runId: 'run-auth', workingDirectory: '/workspace', additionalDirectories: [], prompt: 'connect Linear', metadata: {},
  }, async (value) => { events.push(value) })
  await connected.prompt('connect Linear')
  assert.ok(events.some((value) => value.type === 'failed' && value.payload.code === 'eve_authorization_unsupported' && value.payload.retryable === false))
})

test('Eve adapter keeps default approval options resolvable when Eve omits them', async () => {
  const events: NormalizedAgentEvent[] = []
  const session = fakeSession('eve-session-default-approval')
  let responseValue: unknown
  session.stream = () => response(session, [
    event('input.requested', {
      requests: [{
        requestId: 'permission-default', kind: 'tool-approval', prompt: 'Run command?',
        action: { callId: 'call-default', kind: 'tool-call', toolName: 'bash', input: { command: 'pwd' } },
      }],
      sequence: 1, stepIndex: 0, turnId: 'turn-default',
    }),
    event('session.waiting', { continuationToken: 'eve-session-default-approval', wait: 'next-user-message' }),
  ])
  session.respond = (async (responses: unknown) => {
    responseValue = responses
    return response(session, [
      event('turn.completed', { sequence: 1, turnId: 'turn-default' }),
      event('session.waiting', { continuationToken: 'eve-session-default-approval', wait: 'next-user-message' }),
    ])
  }) as never
  const adapter = new EveAgentAdapter({ host: 'http://127.0.0.1:3000', clientFactory: () => ({ sessions: {
    create: async () => { throw new Error('should attach') },
    attach: () => session,
  } }) })
  const connected = await adapter.start({
    runId: 'run-default', workingDirectory: '/workspace', additionalDirectories: [], prompt: '',
    remoteSessionId: 'eve-session-default-approval', metadata: {},
    adapterState: { sessionId: 'eve-session-default-approval', streamIndex: 0 },
  }, async (value) => { events.push(value) })
  await connected.resume()
  const requested = events.find((value) => value.type === 'approval_requested')
  assert.deepEqual(requested?.type === 'approval_requested' ? requested.payload.options : undefined, [
    { id: 'approve', label: 'Approve' },
    { id: 'deny', label: 'Deny' },
  ])
  await connected.approve('permission-default', 'approve')
  assert.deepEqual(responseValue, [{ requestId: 'permission-default', optionId: 'approve' }])
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
  const events: NormalizedAgentEvent[] = []
  const session = fakeSession('eve-session-3')
  let responseValue: unknown
  session.respond = (async (responses: unknown) => {
    responseValue = responses
    return response(session, [
      event('message.appended', { messageDelta: ' after restart', messageSoFar: 'after restart', sequence: 3, stepIndex: 1, turnId: 'turn-3' }),
      event('step.completed', { finishReason: 'stop', sequence: 3, stepIndex: 1, turnId: 'turn-3', usage: { inputTokens: 3, outputTokens: 2 } }),
      event('turn.completed', { sequence: 3, turnId: 'turn-3' }),
      event('session.waiting', { continuationToken: 'eve-session-3', wait: 'next-user-message' }),
    ])
  }) as never
  const adapter = new EveAgentAdapter({ host: 'http://127.0.0.1:3000', clientFactory: () => ({ sessions: {
    create: async () => { throw new Error('should attach') },
    attach: (_sessionId, options) => { (session.state as { streamIndex: number }).streamIndex = options?.streamIndex ?? 0; return session },
  } }) })
  const connected = await adapter.start({
    runId: 'run-3', workingDirectory: '/workspace', additionalDirectories: [], prompt: '', remoteSessionId: 'eve-session-3', metadata: {},
    adapterState: {
      sessionId: 'eve-session-3', streamIndex: 8,
      pendingRequests: [['permission-3', { kind: 'tool-approval', options: [{ id: 'allow', label: 'Allow' }] }]],
      requestBatches: [['permission-3', ['permission-3']]],
      pendingResponses: [],
      textByStep: [[0, 'before restart']],
      usage: { inputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
    },
  }, async (value) => { events.push(value) })
  await connected.approve('permission-3', 'allow')
  assert.deepEqual(responseValue, [{ requestId: 'permission-3', optionId: 'allow' }])
  assert.ok(events.some((value) => value.type === 'text_checkpoint' && value.payload.text === 'before restart\n\nafter restart'))
  assert.ok(events.some((value) => value.type === 'completed' && value.payload.usage.inputTokens === 10 && value.payload.usage.outputTokens === 2))
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
