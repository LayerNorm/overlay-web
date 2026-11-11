/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function load(file) {
  const cache = new Map()
  function loadFile(relativeFile) {
    const filename = path.resolve(root, relativeFile)
    if (cache.has(filename)) return cache.get(filename).exports
    const loaded = { exports: {} }
    cache.set(filename, loaded)
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const localRequire = (id) => {
      if (!id.startsWith('.')) return require(id)
      const base = path.resolve(path.dirname(filename), id)
      const candidate = [base, `${base}.ts`, `${base}.tsx`].find((item) => fs.existsSync(item) && fs.statSync(item).isFile())
      assert.ok(candidate, `Could not resolve ${id} from ${filename}`)
      return loadFile(path.relative(root, candidate))
    }
    vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { URL, console, Error, Object, Map, Set, Promise, JSON, RegExp, Number, Array, String }, { filename })(localRequire, loaded, loaded.exports)
    return loaded.exports
  }
  return loadFile(file)
}

const { createNativeTranscriptActionController, MAX_TRANSCRIPT_TEXT_LENGTH } = load('lib/nativeChatTranscriptActions.ts')

function fixture() {
  const context = {
    workspaceId: 'workspace-a',
    conversationId: 'chat-a',
    mountNonce: 'nonce-a',
    focused: true,
    mounted: true,
    allowedActions: ['copy', 'download-text', 'open-link', 'reply', 'open-asset', 'open-source', 'open-draft', 'keyboard-dismiss'],
    view: {
      version: 1,
      exchanges: [{
        id: 'exchange-a',
        turnId: 'turn-a',
        index: 0,
        mode: 'act',
        generationMode: 'text',
        user: { id: 'user-a', text: 'trusted question', documentNames: [], indexedAttachments: [], images: [], mentions: [], replyThread: null },
        responses: [{ id: 'response-a', modelId: 'model-a', blocks: [{ kind: 'generated-ui', part: { type: 'data', id: 'part-a', dataType: 'test', data: {} } }], sources: [{ id: 'source-a', sourceKind: 'url', sourceId: 'web-a', url: 'https://example.test/path', originIndex: 0 }], status: 'completed', errorMessage: null }],
        selectedResponseIndex: 0,
        selectedModelId: 'model-a',
        status: 'completed',
        media: null,
      }],
    },
    assets: [{ handle: 'asset_handle_000001', exchangeId: 'exchange-a', resourceId: 'file-a', resourceKind: 'file', previewable: true }],
  }
  const calls = []
  let openedDraftToken = null
  const handlers = Object.fromEntries([
    'copyText', 'downloadText', 'openLink', 'reply', 'openAsset', 'openSource', 'openDraft', 'saveDraft', 'dismissKeyboard',
  ].map((name) => [name, async (...args) => {
    if (name === 'openDraft') openedDraftToken = args[2]
    calls.push([name, ...args])
  }]))
  let token = 0
  const controller = createNativeTranscriptActionController({
    getContext: () => context,
    handlers,
    createDraftToken: () => `draft-token-${++token}`,
  })
  const request = (kind, fields = {}) => ({
    kind,
    workspaceId: 'workspace-a',
    conversationId: 'chat-a',
    mountNonce: 'nonce-a',
    exchangeId: 'exchange-a',
    ...(kind === 'open-asset' ? {} : { responseId: 'response-a' }),
    ...fields,
  })
  return { context, calls, controller, handlers, request, getDraftToken: () => openedDraftToken }
}

test('copies only a bounded request for a known target and resolves after the native writer', async () => {
  const f = fixture()
  let finish
  f.handlers.copyText = (text) => new Promise((resolve) => {
    f.calls.push(['copyText', text])
    finish = resolve
  })
  const request = f.request('copy', { text: 'selected code' })
  let firstDone = false
  const first = f.controller.dispatch(request).then((value) => { firstDone = true; return value })
  const duplicate = f.controller.dispatch({
    text: request.text,
    responseId: request.responseId,
    exchangeId: request.exchangeId,
    mountNonce: request.mountNonce,
    conversationId: request.conversationId,
    workspaceId: request.workspaceId,
    kind: request.kind,
  })
  await Promise.resolve()
  assert.equal(f.calls.filter(([name]) => name === 'copyText').length, 1)
  assert.equal(firstDone, false)
  finish()
  assert.equal((await first).ok, true)
  assert.equal((await duplicate).ok, true)
  assert.equal((await f.controller.dispatch(f.request('copy', { text: 'x'.repeat(MAX_TRANSCRIPT_TEXT_LENGTH + 1) }))).error, 'invalid-request')
})

test('download does not resolve success before both injected write/share work completes', async () => {
  const f = fixture()
  let finish
  f.handlers.downloadText = () => new Promise((resolve) => { finish = resolve })
  let settled = false
  const pending = f.controller.dispatch(f.request('download-text', { filename: 'answer.txt', text: 'safe text' }))
    .then((result) => { settled = true; return result })
  await Promise.resolve()
  assert.equal(settled, false)
  finish()
  assert.equal((await pending).ok, true)
})

test('rejects stale scope, target, blur, unmount, and revoked action state', async () => {
  const f = fixture()
  const request = f.request('reply')
  f.context.mountNonce = 'new-nonce'
  assert.equal((await f.controller.dispatch(request)).error, 'stale-scope')
  f.context.mountNonce = 'nonce-a'
  f.context.workspaceId = 'workspace-b'
  assert.equal((await f.controller.dispatch(request)).error, 'stale-scope')
  f.context.workspaceId = 'workspace-a'
  f.context.focused = false
  assert.equal((await f.controller.dispatch(request)).error, 'unfocused')
  f.context.focused = true
  f.context.mounted = false
  assert.equal((await f.controller.dispatch(request)).error, 'stale-scope')
  f.context.mounted = true
  assert.equal((await f.controller.dispatch(f.request('reply', { exchangeId: 'wrong' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('reply', { responseId: 'wrong-response' }))).error, 'unknown-target')
  f.context.allowedActions = f.context.allowedActions.filter((item) => item !== 'reply')
  assert.equal((await f.controller.dispatch(request)).error, 'unsupported')
})

test('revalidates after asynchronous confirmation before opening a link', async () => {
  const f = fixture()
  let release
  let opened = 0
  f.handlers.openLink = async () => { opened++ }
  const controller = createNativeTranscriptActionController({
    getContext: () => f.context,
    handlers: f.handlers,
    confirmActions: ['open-link'],
    confirm: () => new Promise((resolve) => { release = resolve }),
    createDraftToken: () => 'unused',
  })
  const pending = controller.dispatch(f.request('open-link', { url: 'https://example.test' }))
  await Promise.resolve()
  f.context.allowedActions = f.context.allowedActions.filter((item) => item !== 'open-link')
  release(true)
  assert.equal((await pending).error, 'unsupported')
  assert.equal(opened, 0)
})

test('rejects unsafe links, traversal filenames, and oversized downloads', async () => {
  const f = fixture()
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.test', 'https://example.test/\npath', 'https://example.test/'.padEnd(2050, 'x')]) {
    assert.equal((await f.controller.dispatch(f.request('open-link', { url }))).error, 'invalid-request')
  }
  for (const filename of ['../secret.txt', 'a\\b.txt', '/tmp/file.txt', '.hidden', 'a..b.txt']) {
    assert.equal((await f.controller.dispatch(f.request('download-text', { filename, text: 'body' }))).error, 'invalid-request')
  }
  assert.equal((await f.controller.dispatch(f.request('download-text', { filename: 'answer.txt', text: 'x'.repeat(MAX_TRANSCRIPT_TEXT_LENGTH + 1) }))).error, 'invalid-request')
  assert.equal(f.calls.length, 0)
})

test('writer failures return safe errors and do not leak exception messages', async () => {
  const f = fixture()
  f.handlers.downloadText = async () => { throw new Error('private path and token') }
  const result = await f.controller.dispatch(f.request('download-text', { filename: 'answer.txt', text: 'safe text' }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error, 'action-failed')
})

test('asset preview requires a registered handle in the current exchange; raw URL fields are rejected', async () => {
  const f = fixture()
  assert.equal((await f.controller.dispatch(f.request('open-asset', { assetHandle: 'unknown_handle_000' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('open-asset', { assetHandle: 'asset_handle_000001', url: 'https://secret.test' }))).error, 'invalid-request')
  assert.equal((await f.controller.dispatch(f.request('open-asset', { assetHandle: 'asset_handle_000001' }))).ok, true)
  assert.equal(f.calls[0][0], 'openAsset')
  f.context.assets[0].previewable = false
  assert.equal((await f.controller.dispatch(f.request('open-asset', { assetHandle: 'asset_handle_000001' }))).error, 'unknown-target')
  f.context.assets[0].resourceId = 'https://example.test/file'
  assert.equal((await f.controller.dispatch(f.request('open-asset', { assetHandle: 'asset_handle_000001' }))).error, 'unknown-target')
})

test('an action is not enabled without a real injected native handler', async () => {
  const f = fixture()
  const controller = createNativeTranscriptActionController({
    getContext: () => f.context,
    handlers: { ...f.handlers, openAsset: undefined },
  })
  assert.equal((await controller.dispatch(f.request('open-asset', { assetHandle: 'asset_handle_000001' }))).error, 'unsupported')
  assert.equal(f.calls.length, 0)
})

test('source and draft requests must refer to a current safe source or generated UI part', async () => {
  const f = fixture()
  f.context.view.exchanges[0].responses[0].sources[0].url = 'javascript:alert(1)'
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'source-a' }))).error, 'unknown-target')
  f.context.view.exchanges[0].responses[0].sources[0].url = 'https://example.test/path'
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: '../private' }))).error, 'invalid-request')
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'https://example.test/path' }))).error, 'invalid-request')
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
  assert.equal((await f.controller.dispatch(f.request('open-draft', { partId: 'not-a-part', draft }))).error, 'unknown-target')
})

test('reply receives only the trusted current exchange and response, never caller text', async () => {
  const f = fixture()
  assert.equal((await f.controller.dispatch(f.request('reply', { body: 'untrusted text' }))).error, 'invalid-request')
  assert.equal((await f.controller.dispatch(f.request('reply'))).ok, true)
  assert.equal(f.calls[0][0], 'reply')
  assert.equal(f.calls[0][1].exchange.user.text, 'trusted question')
  assert.equal(f.calls[0][1].response.blocks[0].part.id, 'part-a')
})

test('draft save is bound to its opening scope and rejects delayed or malformed saves', async () => {
  const f = fixture()
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
  const opened = await f.controller.dispatch(f.request('open-draft', { partId: 'part-a', draft }))
  assert.equal(opened.ok, true)
  assert.equal(opened.draftToken, undefined)
  const openedToken = f.getDraftToken()
  f.context.conversationId = 'chat-b'
  assert.equal((await f.controller.saveDraft(openedToken, draft)).error, 'stale-scope')
  assert.equal(f.calls.some(([name]) => name === 'saveDraft'), false)
  f.context.conversationId = 'chat-a'
  await f.controller.dispatch(f.request('open-draft', { partId: 'part-a', draft }))
  assert.equal((await f.controller.saveDraft(f.getDraftToken(), { kind: 'automation', draft: {} })).error, 'invalid-payload')
  assert.equal((await f.controller.saveDraft(f.getDraftToken(), draft)).ok, true)
  assert.equal(f.calls.filter(([name]) => name === 'saveDraft').length, 1)
})

test('draft save is revoked when the current action allowlist changes or the controller invalidates', async () => {
  const f = fixture()
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
  await f.controller.dispatch(f.request('open-draft', { partId: 'part-a', draft }))
  const openedToken = f.getDraftToken()
  f.context.allowedActions = f.context.allowedActions.filter((item) => item !== 'open-draft')
  assert.equal((await f.controller.saveDraft(openedToken, draft)).error, 'unsupported')
  f.context.allowedActions = ['open-draft']
  await f.controller.dispatch(f.request('open-draft', { partId: 'part-a', draft }))
  const secondToken = f.getDraftToken()
  f.controller.invalidate()
  assert.equal((await f.controller.saveDraft(secondToken, draft)).error, 'stale-scope')
  assert.equal((await f.controller.dispatch(f.request('reply'))).error, 'stale-scope')
  assert.equal(f.calls.some(([name]) => name === 'saveDraft'), false)
})

test('delayed draft open does not retain a token after scope changes', async () => {
  const f = fixture()
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
  let finish
  let token
  f.handlers.openDraft = (value, scope, draftToken) => {
    token = draftToken
    return new Promise((resolve) => { finish = resolve })
  }
  const pending = f.controller.dispatch(f.request('open-draft', { partId: 'part-a', draft }))
  await Promise.resolve()
  f.context.conversationId = 'chat-b'
  finish()
  assert.equal((await pending).error, 'stale-scope')
  assert.equal((await f.controller.saveDraft(token, draft)).error, 'stale-scope')
})

test('delayed draft save cannot resolve successfully after its scope changes', async () => {
  const f = fixture()
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
  await f.controller.dispatch(f.request('open-draft', { partId: 'part-a', draft }))
  let finish
  f.handlers.saveDraft = () => new Promise((resolve) => { finish = resolve })
  const pending = f.controller.saveDraft(f.getDraftToken(), draft)
  await Promise.resolve()
  f.context.conversationId = 'chat-b'
  finish()
  assert.equal((await pending).error, 'stale-scope')
})

test('delayed writer completion cannot report success after scope changes', async () => {
  const f = fixture()
  let finish
  f.handlers.copyText = () => new Promise((resolve) => { finish = resolve })
  const pending = f.controller.dispatch(f.request('copy', { text: 'safe' }))
  await Promise.resolve()
  f.context.mountNonce = 'new-mount'
  finish()
  assert.equal((await pending).error, 'stale-scope')
})

test('sources and keyboard dismiss require current supported native actions', async () => {
  const f = fixture()
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'source-a' }))).ok, true)
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'unknown' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch({ kind: 'keyboard-dismiss', workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a' })).ok, true)
  for (const unsupported of ['delete-turn', 'branch', 'retry', 'continue', 'generated-ui-write', 'regenerate']) {
    assert.equal((await f.controller.dispatch(f.request(unsupported))).error, 'invalid-request')
  }
})
