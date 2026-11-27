/* eslint-disable @typescript-eslint/no-require-imports */
require('tsx/cjs')

const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.resolve(__dirname, '..')
const aiServicePath = path.join(projectRoot, 'services/aiService.ts')
const actPolicyPath = path.join(
  projectRoot,
  '..',
  'src/server/app-api/v1/conversations/act/act-route-policy.ts',
)

const state = {
  requests: [],
  submissions: [],
  responses: [],
}

function reset() {
  state.requests.length = 0
  state.submissions.length = 0
  state.responses.length = 0
}

async function* appXhrStreamSse(url, options) {
  state.requests.push({ url, options })
  const response = state.responses.shift() ?? { type: 'text-delta', delta: 'ok' }
  if (response instanceof Error) throw response
  yield response
}

const originalLoad = Module._load
Module._load = function loadAiServiceMocks(request, parent, isMain) {
  if (parent?.filename === aiServicePath) {
    if (request === './appApi') {
      return {
        appRequest: async () => ({ ok: true, json: async () => ({}) }),
        appXhrStreamSse,
        getRequestWorkspaceId: () => 'workspace-a',
      }
    }
    if (request === './appConfig') return { AUTH_BASE_URL: 'https://auth.example.test' }
    if (request === './bootstrapService') return { getAppBootstrap: async () => null }
    if (request === '../lib/chatModels') return { sortChatModels: (models) => models }
    if (request === './personalChatService') {
      return {
        submitPersonalTurn: async (turn, workspaceId, signal) => {
          state.submissions.push({ turn, workspaceId, signal })
          return { conversationId: turn.conversationId ?? 'conversation-server' }
        },
      }
    }
    if (request === './convexClient') return { convexWorkspaceId: () => 'workspace-a' }
  }
  if (request === '@react-native-async-storage/async-storage') {
    return { getItem: async () => null, setItem: async () => {} }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { chatStream } = require(aiServicePath)
Module._load = originalLoad
const { decidePersonalActRoute } = require(actPolicyPath)

async function collect(options) {
  const chunks = []
  for await (const chunk of chatStream('model-a', [{ role: 'user', content: 'Create an automation' }], options)) {
    chunks.push(chunk)
  }
  return chunks
}

test('Automate serializes the current Web mode-only Act contract', async () => {
  reset()
  const signal = new AbortController().signal
  state.responses.push({ type: 'text-delta', delta: 'created' })
  await collect({
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    turnId: 'turn-automate',
    variantIndex: 2,
    requestMode: 'automate',
    requestedToolIds: ['web_search'],
    memoryEnabled: false,
    mentions: [{ type: 'file', id: 'file-a', name: 'Report' }],
    replyContextForModel: 'reply body',
    signal,
  })

  const request = state.requests[0]
  const body = request.options.json
  assert.equal(request.url, '/api/v1/conversations/act')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.signal, signal)
  assert.equal(request.options.headers['x-overlay-workspace-id'], 'workspace-a')
  assert.equal(request.options.headers['Idempotency-Key'], 'act:turn-automate:2')
  assert.equal(body.mode, 'automate')
  assert.equal(body.automationMode, undefined)
  assert.equal(body.automationExecution, undefined)
  assert.equal(body.conversationId, 'conversation-a')
  assert.deepEqual(body.requestedToolIds, ['web_search'])
  assert.equal(body.memoryEnabled, false)
  assert.deepEqual(body.mentions, [{ type: 'file', id: 'file-a', name: 'Report' }])
  assert.equal(body.replyContextForModel, 'reply body')
  assert.deepEqual(
    decidePersonalActRoute({ authType: 'access-token', mode: body.mode, automationMode: body.automationMode }),
    { kind: 'admit' },
  )
  assert.deepEqual(
    decidePersonalActRoute({ authType: 'access-token', mode: body.mode, automationMode: true }),
    { kind: 'legacy_execution_retired' },
  )
  assert.deepEqual(
    decidePersonalActRoute({ authType: 'access-token', mode: body.mode, automationExecution: true }),
    { kind: 'legacy_execution_retired' },
  )
})

test('ordinary and temporary chat retain current fields without legacy Act flags', async () => {
  reset()
  state.responses.push({ type: 'text-delta', delta: 'chat' })
  await collect({
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    turnId: 'turn-chat',
    requestMode: 'chat',
    requestedToolIds: ['sandbox'],
    memoryEnabled: true,
  })
  const normalBody = state.requests[0].options.json
  assert.equal(normalBody.mode, 'chat')
  assert.equal(normalBody.automationMode, undefined)
  assert.equal(normalBody.automationExecution, undefined)
  assert.deepEqual(normalBody.requestedToolIds, ['sandbox'])
  assert.equal(normalBody.memoryEnabled, true)

  reset()
  state.responses.push({ type: 'text-delta', delta: 'temporary' })
  await collect({
    workspaceId: 'workspace-a',
    turnId: 'turn-temporary',
    temporaryChat: true,
    requestMode: 'chat',
  })
  const temporaryBody = state.requests[0].options.json
  assert.equal(temporaryBody.mode, 'chat')
  assert.equal(temporaryBody.temporaryChat, true)
  assert.equal(temporaryBody.automationMode, undefined)
  assert.equal(temporaryBody.conversationId, undefined)
  assert.equal(state.submissions.length, 0)
})

test('HTTP failure after persistence retries the same turn and ownership', async () => {
  reset()
  state.responses.push(Object.assign(new Error('legacy execution retired'), { status: 410 }), { type: 'text-delta', delta: 'retried' })
  const options = {
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    turnId: 'turn-retry',
    variantIndex: 1,
    requestMode: 'chat',
  }
  const originalError = console.error
  console.error = () => {}
  try {
    await collect(options)
    await collect(options)
  } finally {
    console.error = originalError
  }

  assert.equal(state.submissions.length, 2)
  assert.equal(state.requests.length, 2)
  assert.deepEqual(state.submissions.map(({ workspaceId }) => workspaceId), ['workspace-a', 'workspace-a'])
  assert.deepEqual(state.submissions.map(({ turn }) => turn.conversationId), ['conversation-a', 'conversation-a'])
  assert.deepEqual(state.submissions.map(({ turn }) => turn.turnId), ['turn-retry', 'turn-retry'])
  assert.deepEqual(
    state.requests.map(({ options: requestOptions }) => requestOptions.headers['Idempotency-Key']),
    ['act:turn-retry:1', 'act:turn-retry:1'],
  )
  assert.deepEqual(
    state.requests.map(({ options: requestOptions }) => requestOptions.json.conversationId),
    ['conversation-a', 'conversation-a'],
  )
  assert.equal(new Set(state.submissions.map(({ workspaceId, turn }) => `${workspaceId}:${turn.conversationId}:${turn.turnId}`)).size, 1)
})
