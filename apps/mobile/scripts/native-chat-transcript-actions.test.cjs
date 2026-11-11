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
      if (id === '@overlay/chat-core') {
        return Object.assign(
          {},
          loadFile('../packages/overlay-chat-core/src/messages.ts'),
          loadFile('../packages/overlay-chat-core/src/transcript-view.ts'),
          loadFile('../packages/overlay-chat-core/src/visual-sequence.ts'),
        )
      }
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
const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')

function fixture() {
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
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
        responses: [{ id: 'response-a', modelId: 'model-a', blocks: [
          { kind: 'generated-ui', part: { type: 'data', id: 'part-a', dataType: 'test', data: {} } },
          { kind: 'tool', key: 'tool-key-a', name: 'draft_skill_from_chat', state: 'output-available', toolOutput: { success: true, draft: draft.draft } },
        ], sources: [{ id: 'source-a', sourceKind: 'url', sourceId: 'web-a', url: 'https://example.test/path', originIndex: 0 }], status: 'completed', errorMessage: null }],
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
    ...(kind === 'keyboard-dismiss'
      ? { kind, workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', intent: 'user-drag' }
      : { kind, workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', exchangeId: 'exchange-a' }),
    ...(kind === 'open-asset' || kind === 'keyboard-dismiss' ? {} : { target: { kind: 'response', responseId: 'response-a' } }),
    ...fields,
  })
  return { context, calls, controller, handlers, request, draft, getDraftToken: () => openedDraftToken }
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
    target: request.target,
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
  assert.equal((await f.controller.dispatch(f.request('reply', { target: { kind: 'response', responseId: 'wrong-response' } }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('reply', { conversationId: 'chat-b' }))).error, 'stale-scope')
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

test('source and draft requests must refer to a current safe source or trusted tool block', async () => {
  const f = fixture()
  f.context.view.exchanges[0].responses[0].sources[0].url = 'javascript:alert(1)'
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'source-a' }))).error, 'unknown-target')
  f.context.view.exchanges[0].responses[0].sources[0].url = 'https://example.test/path'
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: '../private' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'https://example.test/path' }))).error, 'unknown-target')
  f.context.view.exchanges[0].responses[0].sources[0].sourceKind = 'document'
  f.context.view.exchanges[0].responses[0].sources[0].sourceId = '../private'
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'source-a' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('open-draft', { toolKey: 'not-a-tool' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a', draft: f.draft }))).error, 'invalid-request')
})

test('reply receives only the trusted current target, never caller text', async () => {
  const f = fixture()
  assert.equal((await f.controller.dispatch(f.request('reply', { body: 'untrusted text' }))).error, 'invalid-request')
  assert.equal((await f.controller.dispatch(f.request('reply'))).ok, true)
  assert.equal(f.calls[0][0], 'reply')
  assert.equal(f.calls[0][1].exchange.user.text, 'trusted question')
  assert.equal(f.calls[0][1].response.id, 'response-a')
  assert.equal(f.calls[0][1].target.kind, 'response')
})

test('real adapter response IDs with model slashes resolve by exact target membership', async () => {
  const f = fixture()
  const view = toNativeChatTranscriptView([
    { id: 'user-real', turnId: 'turn-real', role: 'user', content: 'Question', timestamp: 10, mode: 'act' },
    { id: 'assistant-real', turnId: 'turn-real', role: 'assistant', content: 'Answer', timestamp: 20, mode: 'act', modelId: 'provider/model' },
  ])
  const exchange = view.exchanges[0]
  const response = exchange.responses[0]
  assert.ok(response.id.includes('/'))
  f.context.view = view
  const result = await f.controller.dispatch(f.request('copy', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    text: 'selected answer',
  }))
  assert.equal(result.ok, true)
})

test('real user-only adapter exchanges support user Copy, links, and trusted Reply without a response', async () => {
  const f = fixture()
  const view = toNativeChatTranscriptView([
    { id: 'user-only', turnId: 'user-turn', role: 'user', content: 'Open https://example.test/path', timestamp: 10, mode: 'act' },
  ])
  const exchange = view.exchanges[0]
  assert.equal(exchange.responses.length, 0)
  f.context.view = view
  const target = { kind: 'user', userId: exchange.user.id }
  assert.equal((await f.controller.dispatch(f.request('copy', { exchangeId: exchange.id, target, text: exchange.user.text }))).ok, true)
  assert.equal((await f.controller.dispatch(f.request('open-link', { exchangeId: exchange.id, target, url: 'https://example.test/path' }))).ok, true)
  assert.equal((await f.controller.dispatch(f.request('reply', { exchangeId: exchange.id, target }))).ok, true)
  const trusted = f.calls.find(([name]) => name === 'reply')[1]
  assert.equal(trusted.exchange.id, exchange.id)
  assert.equal(trusted.user.text, exchange.user.text)
  assert.equal(trusted.response, null)
  assert.equal((await f.controller.dispatch(f.request('download-text', { exchangeId: exchange.id, target, filename: 'answer.txt', text: 'x' }))).error, 'invalid-request')
})

test('real completed media exchanges support trusted Reply without a fake response or DOM URL target', async () => {
  const f = fixture()
  const view = toNativeChatTranscriptView([
    { id: 'media-user', turnId: 'media-turn', role: 'user', content: 'Generate image', contentType: 'image', timestamp: 10, mode: 'image', outputs: [
      { _id: 'media-output-a', type: 'image', status: 'completed', url: 'https://protected.example/image', modelId: 'image-model', createdAt: 11, prompt: 'Generate image' },
    ] },
  ])
  const exchange = view.exchanges[0]
  const mediaResult = exchange.media.results[0]
  assert.equal(exchange.responses.length, 0)
  assert.equal(mediaResult.status, 'completed')
  f.context.view = view
  assert.equal((await f.controller.dispatch(f.request('reply', { exchangeId: exchange.id, target: { kind: 'media', outputId: mediaResult.outputId } }))).ok, true)
  const trusted = f.calls.find(([name]) => name === 'reply')[1]
  assert.equal(trusted.response, null)
  assert.equal(trusted.mediaResult.outputId, mediaResult.outputId)
})

test('confirmation rejects a changed conversation or removed target before invoking the handler', async () => {
  for (const change of [
    (f) => { f.context.conversationId = 'chat-b' },
    (f) => { f.context.view.exchanges[0].responses = [] },
  ]) {
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
    change(f)
    release(true)
    assert.equal((await pending).ok, false)
    assert.equal(opened, 0)
  }
})

test('draft save is bound to its opening scope and rejects delayed or malformed saves', async () => {
  const f = fixture()
  const draft = f.draft
  const opened = await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  assert.equal(opened.ok, true)
  assert.equal(opened.draftToken, undefined)
  const openedToken = f.getDraftToken()
  f.context.conversationId = 'chat-b'
  assert.equal((await f.controller.saveDraft(openedToken, draft)).error, 'stale-scope')
  assert.equal(f.calls.some(([name]) => name === 'saveDraft'), false)
  f.context.conversationId = 'chat-a'
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  assert.equal((await f.controller.saveDraft(f.getDraftToken(), { kind: 'automation', draft: {} })).error, 'invalid-payload')
  assert.equal((await f.controller.saveDraft(f.getDraftToken(), draft)).ok, true)
  assert.equal(f.calls.filter(([name]) => name === 'saveDraft').length, 1)
})

test('draft Save rejects removed or changed tool targets and allows retry after native rejection', async () => {
  for (const alter of [
    (f) => { f.context.view.exchanges[0].responses[0].blocks = [] },
    (f) => { f.context.view.exchanges[0].responses[0].blocks[1].toolOutput.draft.name = 'Changed' },
  ]) {
    const f = fixture()
    await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
    const token = f.getDraftToken()
    alter(f)
    assert.equal((await f.controller.saveDraft(token, f.draft)).error, 'unknown-target')
  }
  const f = fixture()
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  let attempts = 0
  f.handlers.saveDraft = async () => { if (++attempts === 1) throw new Error('safe failure') }
  assert.equal((await f.controller.saveDraft(f.getDraftToken(), f.draft)).error, 'action-failed')
  assert.equal((await f.controller.saveDraft(f.getDraftToken(), f.draft)).ok, true)
  assert.equal(attempts, 2)
})

test('pending draft saves deduplicate identical writes and reject different concurrent payloads', async () => {
  const f = fixture()
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  let finish
  let calls = 0
  f.handlers.saveDraft = () => { calls++; return new Promise((resolve) => { finish = resolve }) }
  const token = f.getDraftToken()
  const first = f.controller.saveDraft(token, f.draft)
  const duplicate = f.controller.saveDraft(token, f.draft)
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal((await f.controller.saveDraft(token, { ...f.draft, draft: { ...f.draft.draft, name: 'Other' } })).error, 'action-pending')
  finish()
  assert.equal((await first).ok, true)
  assert.equal((await duplicate).ok, true)
})

test('draft save is revoked when the current action allowlist changes or the controller invalidates', async () => {
  const f = fixture()
  const draft = f.draft
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  const openedToken = f.getDraftToken()
  f.context.allowedActions = f.context.allowedActions.filter((item) => item !== 'open-draft')
  assert.equal((await f.controller.saveDraft(openedToken, draft)).error, 'unsupported')
  f.context.allowedActions = ['open-draft']
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  const secondToken = f.getDraftToken()
  f.controller.invalidate()
  assert.equal((await f.controller.saveDraft(secondToken, draft)).error, 'stale-scope')
  assert.equal((await f.controller.dispatch(f.request('reply'))).error, 'stale-scope')
  assert.equal(f.calls.some(([name]) => name === 'saveDraft'), false)
})

test('delayed draft open does not retain a token after scope changes', async () => {
  const f = fixture()
  const draft = f.draft
  let finish
  let token
  f.handlers.openDraft = (value, scope, draftToken) => {
    token = draftToken
    return new Promise((resolve) => { finish = resolve })
  }
  const pending = f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  await Promise.resolve()
  f.context.conversationId = 'chat-b'
  finish()
  assert.equal((await pending).error, 'stale-scope')
  assert.equal((await f.controller.saveDraft(token, draft)).error, 'stale-scope')
})

test('delayed draft save cannot resolve successfully after its scope changes', async () => {
  const f = fixture()
  const draft = f.draft
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  let finish
  f.handlers.saveDraft = () => new Promise((resolve) => { finish = resolve })
  const pending = f.controller.saveDraft(f.getDraftToken(), draft)
  await Promise.resolve()
  f.context.conversationId = 'chat-b'
  finish()
  assert.equal((await pending).error, 'stale-scope')
})

test('delayed draft Save cannot complete successfully after its tool target is removed', async () => {
  const f = fixture()
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  let finish
  f.handlers.saveDraft = () => new Promise((resolve) => { finish = resolve })
  const pending = f.controller.saveDraft(f.getDraftToken(), f.draft)
  await Promise.resolve()
  f.context.view.exchanges[0].responses[0].blocks = []
  finish()
  assert.equal((await pending).error, 'unknown-target')
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
  assert.equal((await f.controller.dispatch(f.request('keyboard-dismiss'))).ok, true)
  assert.equal((await f.controller.dispatch({ kind: 'keyboard-dismiss', workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', intent: 'programmatic-scroll' })).error, 'invalid-request')
  for (const unsupported of ['delete-turn', 'branch', 'retry', 'continue', 'generated-ui-write', 'regenerate']) {
    assert.equal((await f.controller.dispatch(f.request(unsupported))).error, 'invalid-request')
  }
})
