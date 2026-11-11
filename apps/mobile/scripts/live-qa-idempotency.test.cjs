/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}) {
  const filename = path.resolve(root, file), loaded = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { Error, console: { log() {}, error() {} } })(id => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    assert.ok(id.startsWith('.'), 'Unexpected import ' + id)
    return load(path.resolve(path.dirname(filename), id) + '.ts', mocks)
  }, loaded, loaded.exports)
  return loaded.exports
}
const clean = value => JSON.parse(JSON.stringify(value))
function transport() {
  const calls = []
  let failure = false
  return {
    calls, fail: value => { failure = value },
    api: {
      getRequestWorkspaceId: () => 'workspace',
      async appRequest(url, options) {
        calls.push([url, clean(options)])
        return { ok: !failure, json: async () => failure ? { error: 'Unavailable' } : { url: 'https://example.test/image.png' } }
      },
      async appJson(url, options) { calls.push([url, clean(options)]); if (failure) throw new Error('Unavailable'); return { ok: true } },
      async *appXhrStreamSse(url, options) {
        calls.push([url, clean(options)])
        if (failure) throw new Error('Unavailable')
        yield url.endsWith('generate-video') ? { type: 'completed', url: 'https://example.test/video.mp4' } : { type: 'text-delta', delta: 'Done' }
      },
    },
  }
}

test('personal act uses the web turn/variant key across retries, including temporary chats, and rejects missing turn IDs', async () => {
  const http = transport(), submits = []
  const service = load('services/aiService.ts', {
    './appApi': http.api, './appConfig': { AUTH_BASE_URL: 'https://example.test' },
    '@react-native-async-storage/async-storage': {}, './bootstrapService': {}, '../lib/chatModels': {},
    './convexClient': { convexWorkspaceId: () => 'workspace' },
    './personalChatService': { submitPersonalTurn: async args => { submits.push(args); return { conversationId: 'durable' } } },
  })
  const collect = async options => { const chunks = []; for await (const chunk of service.chatStream('model', [{ role: 'user', content: 'Hello' }], options)) chunks.push(chunk); return chunks }
  const options = { turnId: 'stable-turn', conversationId: 'durable', variantIndex: 2 }
  http.fail(true)
  assert.equal((await collect(options)).at(-1).type, 'error')
  http.fail(false)
  await collect(options)
  assert.equal(http.calls[0][1].headers['Idempotency-Key'], 'act:stable-turn:2')
  assert.equal(http.calls[1][1].headers['Idempotency-Key'], 'act:stable-turn:2')
  assert.deepEqual(http.calls[0][1].json, http.calls[1][1].json)
  await collect({ ...options, turnId: 'next-turn' })
  await collect({ ...options, variantIndex: 3 })
  assert.equal(new Set(http.calls.map(call => call[1].headers['Idempotency-Key'])).size, 3)
  const submitCount = submits.length
  await collect({ turnId: 'temporary-turn', temporaryChat: true })
  assert.equal(http.calls.at(-1)[1].headers['Idempotency-Key'], 'act:temporary-turn:0')
  assert.equal(submits.length, submitCount)
  const count = http.calls.length
  assert.equal((await collect({ temporaryChat: true })).at(-1).type, 'error')
  assert.equal(http.calls.length, count)
})

test('image and video retries preserve per-turn keys and empty turns never start generation', async () => {
  const http = transport()
  const service = load('services/conversationActionsService.ts', {
    './appApi': http.api, './overlayClient': {}, './chatStorage': {}, './convexClient': {}, './collaborationService': {},
  })
  for (const [kind, generate] of [['image', service.generateImage], ['video', service.generateVideo]]) {
    const input = { prompt: 'A tree', modelId: 'model', conversationId: 'durable', turnId: 'same-turn' }
    http.fail(true)
    await assert.rejects(generate(input), /Unavailable/)
    http.fail(false)
    await generate(input)
    assert.equal(http.calls.at(-1)[1].headers['Idempotency-Key'], `${kind}:same-turn`)
    assert.equal(http.calls.at(-2)[1].headers['Idempotency-Key'], `${kind}:same-turn`)
    await generate({ ...input, turnId: 'new-turn' })
    assert.equal(http.calls.at(-1)[1].headers['Idempotency-Key'], `${kind}:new-turn`)
    const count = http.calls.length
    await assert.rejects(generate({ ...input, turnId: '' }), /turn ID is required/)
    assert.equal(http.calls.length, count)
  }
})

test('automation run and knowledge-search callers can reuse keys on failure and default to new keys for distinct actions', async () => {
  const http = transport()
  let next = 0
  const mocks = { './appApi': http.api, '@overlay/api-client': { createIdempotencyKey: () => `request-${++next}` }, './convexClient': {}, './filesService': {}, './settingsNativeService': {} }
  const automation = load('services/automationsService.ts', mocks)
  const knowledge = load('services/knowledgeService.ts', mocks)
  for (const invoke of [key => automation.runAutomationNow('automation', key), key => knowledge.searchKnowledge('query', 'file', key)]) {
    http.fail(true)
    await assert.rejects(invoke('retry-key'), /Unavailable/)
    http.fail(false)
    await invoke('retry-key')
    assert.equal(http.calls.at(-2)[1].headers['Idempotency-Key'], 'retry-key')
    assert.equal(http.calls.at(-1)[1].headers['Idempotency-Key'], 'retry-key')
    await invoke(); await invoke()
    assert.notEqual(http.calls.at(-2)[1].headers['Idempotency-Key'], http.calls.at(-1)[1].headers['Idempotency-Key'])
  }
  const count = http.calls.length
  assert.equal((await knowledge.searchKnowledge(' ', 'memory')).chunks.length, 0)
  assert.equal(http.calls.length, count)
})

test('room sends carry their stable nonce to the shared client idempotency header converter', async () => {
  const calls = []
  const service = load('services/collaborationService.ts', {
    './overlayClient': { mobileOverlayAppClient: { conversations: { addMessage: async (...args) => calls.push(clean(args)) } } },
    './convexClient': {}, '../lib/activity': {}, '../../src/shared/chat/public-stream-projection': {},
  })
  const turn = { conversationId: 'room', turnId: 'turn', clientNonce: 'stable-nonce', content: 'Hello', mentionedPrincipalIds: [], memoryEnabled: true }
  await service.sendRoomMessage(turn); await service.sendRoomMessage(turn)
  assert.equal(calls[0][1].idempotencyKey, 'room:stable-nonce')
  assert.deepEqual(calls[0], calls[1])
})

test('native transcription attaches a key to its URLRequest and automation UIs preserve pending run keys', () => {
  const swift = fs.readFileSync(path.join(root, 'ios/RecordingViewController.swift'), 'utf8')
  assert.match(swift, /request\.setValue\(UUID\(\)\.uuidString, forHTTPHeaderField: "Idempotency-Key"\)/)
  for (const file of ['components/automations/AutomationBrowserScreen.tsx', 'components/automations/AutomationDetailSheet.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /runAutomationNow\([^,]+, key\)/)
    assert.match(source, /if \(runRequest\.current\?\.key === key\) runRequest\.current = null/)
  }
})
