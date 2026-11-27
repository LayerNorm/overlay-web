/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('../../../node_modules/typescript')
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
          loadFile('../../packages/overlay-chat-core/src/messages.ts'),
          loadFile('../../packages/overlay-chat-core/src/sources.ts'),
          loadFile('../../packages/overlay-chat-core/src/transcript-view.ts'),
          loadFile('../../packages/overlay-chat-core/src/visual-sequence.ts'),
        )
      }
      if (!id.startsWith('.')) {
        if (id.startsWith('node:')) return require(id)
        return require(require.resolve(id, { paths: [path.resolve(root, '../..')] }))
      }
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
const { createNativeTranscriptDomSnapshot } = load('lib/nativeChatTranscriptProjection.ts')
const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
const { mapNativePersonalMessageRows } = load('lib/toNativeChatMessage.ts')
const { collectWebSourcesFromBlocks } = load('../../packages/overlay-chat-core/src/sources.ts')
const { buildAutomationDraftFromTurn } = load('../../src/features/automations/lib/automation-drafts.ts')
const { MAX_AUTOMATION_GRAPH_SOURCE_LENGTH, MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT } = load('lib/nativeTranscriptLimits.ts')

function realAutomationDraft() {
  return buildAutomationDraftFromTurn({ userText: 'Create a daily tech news digest email using Gmail' })
}

function realAutomationView(draft) {
  return toNativeChatTranscriptView([
    { id: 'real-user', turnId: 'real-automation-turn', role: 'user', content: 'Create a daily tech news digest email using Gmail', timestamp: 10, mode: 'act' },
    {
      id: 'real-assistant', turnId: 'real-automation-turn', role: 'assistant', content: 'Automation draft ready', timestamp: 20,
      modelId: 'provider/model', status: 'completed', toolInvocations: [{
        toolCallId: 'real-automation-tool-key', toolName: 'draft_automation_from_chat', state: 'output-available',
        toolOutput: { success: true, draft },
      }],
    },
  ])
}

function realCitationView(sourceCitations) {
  return toNativeChatTranscriptView([
    { id: 'citation-user', turnId: 'citation-turn', role: 'user', content: 'Find sources', timestamp: 10, mode: 'act' },
    {
      id: 'citation-assistant', turnId: 'citation-turn', role: 'assistant', content: 'Sources found', timestamp: 20,
      modelId: 'provider/model', status: 'completed', sourceCitations,
    },
  ])
}

function sourceBridgeMessages(toolInvocation, providerSources = []) {
  return [
    { id: 'source-user', turnId: 'source-turn', role: 'user', content: 'Find sources', timestamp: 10, mode: 'act' },
    {
      id: 'source-assistant', turnId: 'source-turn', role: 'assistant', content: 'Sources found', timestamp: 20,
      modelId: 'provider/model', selectedModelId: 'provider/model', status: 'completed',
      responses: [{
        modelId: 'provider/model', variantIndex: 0, content: 'Sources found', status: 'completed',
        sources: providerSources,
        sourceCitations: {
          '0': { kind: 'file', sourceId: 'file-evidence-1', title: 'Evidence document' },
          '1': { kind: 'memory', sourceId: 'memory-evidence-1', title: 'Evidence memory' },
        },
        toolInvocations: Array.isArray(toolInvocation) ? toolInvocation : [toolInvocation],
      }],
    },
  ]
}

function sourceBridgeView(toolInvocation, providerSources = []) {
  return toNativeChatTranscriptView(sourceBridgeMessages(toolInvocation, providerSources))
}

function persistedSourceRows(toolInvocation) {
  const userMessage = {
    _id: 'persisted-source-user', turnId: 'persisted-source-turn', role: 'user', contentType: 'text',
    mode: 'act', content: 'Find persisted sources', parts: [{ type: 'text', text: 'Find persisted sources' }], createdAt: 10,
  }
  const assistantMessage = {
    _id: 'persisted-source-assistant', turnId: 'persisted-source-turn', role: 'assistant', contentType: 'text',
    mode: 'act', modelId: 'provider/model', status: 'completed', content: 'Sources found', createdAt: 20,
    parts: [
      { type: 'text', text: 'Sources found' },
      { type: 'tool-invocation', toolInvocation },
    ],
  }
  return [
    { message: assistantMessage, contextUser: null, outputs: [] },
    { message: userMessage, contextUser: null, outputs: [] },
  ]
}

test('persisted search sources bridge through native projection, shared source extraction, and open-source actions', async () => {
  const providerUrl = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map'
  const results = Array.from({ length: 8 }, (_, index) => ({
    url: index === 0 ? providerUrl : `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Array/result-${index}`,
    title: `MDN result ${index + 1}`,
    snippet: `SNIPPET_SECRET_${index}`,
    authorization: `AUTH_SECRET_${index}`,
  }))
  const rawOutput = {
    sources: [...results, results[1],
      { url: 'https://user:password@private.example/reference', title: 'Credential URL' },
      { url: 'https://private.example/api/files/private', title: 'Private file URL' },
      { url: 'https://search.example/reference?access_token=TOKEN_SECRET', title: 'Credential query URL' },
      { url: 'not-a-url', title: 'Malformed URL' }],
    raw: { authorization: 'RAW_AUTH_SECRET', snippet: 'RAW_SNIPPET_SECRET' },
  }
  const toolInvocation = {
    toolCallId: 'web-search-call',
    toolName: 'web_search',
    state: 'output-available',
    toolInput: { query: 'QUERY_SECRET', headers: { authorization: 'INPUT_AUTH_SECRET' } },
    toolOutput: rawOutput,
  }
  const providerSources = [
    { id: 'provider-mdn-source', sourceKind: 'url', sourceId: 'provider-mdn', url: providerUrl, title: 'Provider MDN source', originIndex: 0 },
    { id: 'provider-reference-source', sourceKind: 'url', sourceId: 'provider-reference', url: 'https://provider.example/reference', title: 'Provider reference', originIndex: 1 },
    { id: 'provider-file-source', sourceKind: 'document', sourceId: 'file-evidence-1', title: 'Evidence document', filename: 'evidence.pdf', originIndex: 2 },
  ]
  const view = sourceBridgeView(toolInvocation, providerSources)
  const exchange = view.exchanges[0]
  const response = exchange.responses[0]
  const webSources = response.sources.filter((source) => source.sourceKind === 'url' && source.id.startsWith('web-'))

  assert.equal(response.sources.filter((source) => source.url === providerUrl).length, 1)
  assert.equal(response.sources.find((source) => source.id === 'provider-file-source').sourceId, 'file-evidence-1')
  assert.equal(response.sourceCitations['0'].sourceId, 'file-evidence-1')
  assert.equal(webSources.length, 7)
  assert.ok(webSources.every((source) => source.url && source.title && source.sourceId === source.id))
  assert.equal(response.sources.some((source) => source.url?.includes('private.example')), false)
  assert.equal(response.sources.some((source) => source.url?.includes('TOKEN_SECRET')), false)

  const reloaded = sourceBridgeView(structuredClone(toolInvocation), structuredClone(providerSources))
  assert.deepEqual(reloaded.exchanges[0].responses[0].sources.map((source) => source.id), response.sources.map((source) => source.id))
  const otherMessages = sourceBridgeMessages(toolInvocation, providerSources)
  otherMessages[0].turnId = 'other-source-turn'
  otherMessages[1].turnId = 'other-source-turn'
  const otherResponse = toNativeChatTranscriptView(otherMessages).exchanges[0].responses[0]
  assert.notEqual(otherResponse.sources.find((source) => source.url === webSources[0].url).id, webSources[0].id)

  const oversizedSources = Array.from({ length: MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT + 5 }, (_, index) => ({
    url: `https://bounded.example/result-${index}`,
    title: 'x'.repeat(600),
  }))
  const boundedResponse = sourceBridgeView({ ...toolInvocation, toolOutput: { sources: oversizedSources } }, providerSources)
    .exchanges[0].responses[0]
  assert.equal(boundedResponse.sources.length, MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT)
  assert.ok(boundedResponse.sources.find((item) => item.id.startsWith('web-')).title.length <= 512)

  const fileHandle = 'file_evidence_handle_0001'
  const projected = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-source', conversationId: 'conversation-source', mountNonce: 'mount-source', focusNonce: 'focus-source',
    theme: 'dark', view: structuredClone(view), supportedActions: ['open-source', 'open-citation'], query: '', scrollIntent: null,
    assets: [{ handle: fileHandle, exchangeId: exchange.id, resourceId: 'file-evidence-1', resourceKind: 'file', previewable: true, label: 'evidence.pdf' }],
  })
  const projectedResponse = projected.view.exchanges[0].responses[0]
  const projectedSources = projectedResponse.sources.filter((source) => source.sourceKind === 'url')
  assert.equal(projectedSources.some((source) => source.url === providerUrl), true)
  assert.equal(projectedResponse.sources.find((source) => source.id === 'provider-file-source').sourceId, fileHandle)
  assert.equal(projectedResponse.sourceCitations['0'].sourceId, fileHandle)
  assert.equal(projectedResponse.sourceCitations['1'].sourceId, 'memory-evidence-1')

  const projectedTool = projectedResponse.blocks.find((block) => block.kind === 'tool')
  assert.deepEqual(Object.keys(projectedTool.toolOutput), ['sources'])
  assert.ok(projectedTool.toolOutput.sources.every((source) => Object.keys(source).sort().join(',') === 'title,url'))
  const sharedSources = collectWebSourcesFromBlocks(projectedResponse.blocks)
  assert.equal(sharedSources.length, 8)
  assert.ok(sharedSources.every((source) => !source.snippet || !source.snippet.includes('SNIPPET_SECRET')))
  const projectedJson = JSON.stringify(projected)
  for (const secret of ['SNIPPET_SECRET', 'AUTH_SECRET', 'RAW_AUTH_SECRET', 'RAW_SNIPPET_SECRET', 'QUERY_SECRET', 'INPUT_AUTH_SECRET', 'TOKEN_SECRET', 'user:password']) {
    assert.equal(projectedJson.includes(secret), false)
  }

  const f = fixture()
  f.context.view = view
  const source = webSources[0]
  const request = f.request('open-source', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    sourceId: source.id,
  })
  assert.equal((await f.controller.dispatch(request)).ok, true)
  assert.equal(f.calls.find(([name]) => name === 'openSource')[1].url, source.url)
  const staleRequest = f.request('open-source', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    sourceId: webSources[1].id,
  })
  f.context.focusNonce = 'focus-next'
  assert.equal((await f.controller.dispatch(staleRequest)).ok, false)
})

test('persisted Convex assistant parts map through the row adapter to native sources and open-source actions', async () => {
  const nestedSources = Array.from({ length: 8 }, (_, index) => ({
    url: `https://persisted.example/result-${index + 1}`,
    title: `Persisted result ${index + 1}`,
    snippet: `PERSISTED_SNIPPET_SECRET_${index}`,
  }))
  const toolInvocation = {
    toolCallId: 'persisted-web-search-call',
    toolName: 'web_search',
    state: 'output-available',
    toolInput: { query: 'PERSISTED_QUERY_SECRET', headers: { authorization: 'PERSISTED_AUTH_SECRET' } },
    toolOutput: { sources: nestedSources, raw: { authorization: 'PERSISTED_RAW_AUTH_SECRET' } },
  }
  const messages = mapNativePersonalMessageRows(persistedSourceRows(toolInvocation))
  const mappedAssistant = messages.find((message) => message.role === 'assistant')
  assert.ok(mappedAssistant.responses[0].blocks.some((block) => block.kind === 'tool' && block.name === 'web_search'))
  assert.equal(mappedAssistant.responses[0].sources.length, 0)

  const view = toNativeChatTranscriptView(messages)
  const exchange = view.exchanges[0]
  const response = exchange.responses[0]
  const webSources = response.sources.filter((source) => source.id.startsWith('web-'))
  assert.equal(webSources.length, 8)
  assert.deepEqual(Array.from(webSources, (source) => source.url), nestedSources.map((source) => source.url))

  const projected = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-source', conversationId: 'conversation-source', mountNonce: 'mount-source', focusNonce: 'focus-source',
    theme: 'dark', view: structuredClone(view), supportedActions: ['open-source'], query: '', scrollIntent: null, assets: [],
  })
  const projectedResponse = projected.view.exchanges[0].responses[0]
  const projectedTool = projectedResponse.blocks.find((block) => block.kind === 'tool')
  assert.deepEqual(Array.from(projectedTool.toolOutput.sources, (source) => source.url), nestedSources.map((source) => source.url))
  assert.ok(projectedTool.toolOutput.sources.every((source) => Object.keys(source).sort().join(',') === 'title,url'))
  assert.equal(collectWebSourcesFromBlocks(projectedResponse.blocks).length, 8)
  const projectedJson = JSON.stringify(projected)
  for (const secret of ['PERSISTED_SNIPPET_SECRET', 'PERSISTED_QUERY_SECRET', 'PERSISTED_AUTH_SECRET', 'PERSISTED_RAW_AUTH_SECRET']) {
    assert.equal(projectedJson.includes(secret), false)
  }

  const f = fixture()
  f.context.view = view
  const source = webSources[0]
  const request = f.request('open-source', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    sourceId: source.id,
  })
  assert.equal((await f.controller.dispatch(request)).ok, true)
  assert.equal(f.calls.find(([name]) => name === 'openSource')[1].url, source.url)

  const pendingMessages = mapNativePersonalMessageRows(persistedSourceRows({ ...toolInvocation, state: 'input-available' }))
  const pendingView = toNativeChatTranscriptView(pendingMessages)
  const pendingResponse = pendingView.exchanges[0].responses[0]
  assert.equal(pendingResponse.sources.some((candidate) => candidate.id.startsWith('web-')), false)
  assert.equal(pendingResponse.blocks.find((block) => block.kind === 'tool').state, 'input-available')
  const pendingProjection = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-source', conversationId: 'conversation-source', mountNonce: 'mount-source', focusNonce: 'focus-source',
    theme: 'dark', view: structuredClone(pendingView), supportedActions: ['open-source'], query: '', scrollIntent: null, assets: [],
  })
  assert.equal('toolOutput' in pendingProjection.view.exchanges[0].responses[0].blocks.find((block) => block.kind === 'tool'), false)
})

test('projection deduplicates multiple tool blocks and gates chip URLs by the response source budget', async () => {
  const providerSources = Array.from({ length: MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT - 1 }, (_, index) => ({
    id: `provider-source-${index}`,
    sourceKind: 'url',
    sourceId: `provider-${index}`,
    url: `https://provider.example/source-${index}`,
    title: `Provider source ${index}`,
    originIndex: index,
  }))
  const firstUrl = 'https://search.example/first'
  const toolInvocations = [
    {
      toolCallId: 'search-block-one', toolName: 'web_search', state: 'output-available',
      toolOutput: { sources: [
        { url: firstUrl, title: 'Canonical first' },
        { url: 'https://search.example/second', title: 'Over budget second' },
      ] },
    },
    {
      toolCallId: 'search-block-two', toolName: 'web_search', state: 'output-available',
      toolOutput: { sources: [
        { url: firstUrl, title: 'Duplicate first' },
        { url: 'https://search.example/third', title: 'Over budget third' },
      ] },
    },
  ]
  const view = sourceBridgeView(toolInvocations, providerSources)
  const exchange = view.exchanges[0]
  const response = exchange.responses[0]
  const webSources = response.sources.filter((source) => source.id.startsWith('web-'))
  assert.equal(response.sources.length, MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT)
  assert.equal(webSources.length, 1)

  const projected = createNativeTranscriptDomSnapshot({
    workspaceId: 'workspace-source', conversationId: 'conversation-source', mountNonce: 'mount-source', focusNonce: 'focus-source',
    theme: 'dark', view: structuredClone(view), supportedActions: ['open-source'], query: '', scrollIntent: null, assets: [],
  })
  const projectedResponse = projected.view.exchanges[0].responses[0]
  const projectedToolSources = projectedResponse.blocks
    .filter((block) => block.kind === 'tool')
    .flatMap((block) => block.toolOutput?.sources ?? [])
  assert.equal(projectedToolSources.length, 1)
  assert.equal(projectedToolSources[0].url, webSources[0].url)
  assert.ok(projectedToolSources.every((source) => projectedResponse.sources.some((candidate) => candidate.url === source.url)))
  assert.equal(collectWebSourcesFromBlocks(projectedResponse.blocks).length, 1)

  const f = fixture()
  f.context.view = view
  const request = f.request('open-source', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    sourceId: webSources[0].id,
  })
  assert.equal((await f.controller.dispatch(request)).ok, true)
  assert.equal(f.calls.find(([name]) => name === 'openSource')[1].url, firstUrl)
})

test('source-specific state reconciliation preserves legacy non-source tool outputs', () => {
  const toolOutput = { success: true, draft: { kind: 'automation', draft: { name: 'Legacy draft' } } }
  const view = sourceBridgeView({
    toolCallId: 'legacy-draft-call', toolName: 'draft_automation_from_chat', toolOutput,
  })
  const block = view.exchanges[0].responses[0].blocks.find((candidate) => candidate.kind === 'tool')
  assert.equal(block.state, 'output-available')
  assert.equal(JSON.stringify(block.toolOutput), JSON.stringify(toolOutput))
  assert.equal(view.exchanges[0].responses[0].sources.some((source) => source.id.startsWith('web-')), false)
})

test('empty, failed, denied, pending, malformed, and unallowlisted source tools project no source metadata', () => {
  const cases = [
    { state: 'output-available', toolOutput: { sources: [] } },
    { state: 'output-error', toolOutput: { sources: [{ url: 'https://search.example/result', title: 'failed' }], error: 'ERROR_SECRET' } },
    { state: 'output-denied', toolOutput: { sources: [{ url: 'https://search.example/result', title: 'denied' }] } },
    { state: 'input-available', toolOutput: { sources: [{ url: 'https://search.example/result', title: 'pending' }] } },
    { state: 'output-available', toolOutput: { rawResult: 'MALFORMED_SECRET' } },
    { state: 'output-available', toolName: 'ordinary_tool', toolOutput: { sources: [{ url: 'https://search.example/result', title: 'unallowlisted' }] } },
  ]
  for (const [index, toolState] of cases.entries()) {
    const view = sourceBridgeView({ toolCallId: `source-call-${index}`, toolName: 'web_search', toolInput: { query: 'QUERY_SECRET' }, ...toolState })
    const response = view.exchanges[0].responses[0]
    assert.equal(response.sources.some((source) => source.id.startsWith('web-')), false, `case ${index}`)
    const projected = createNativeTranscriptDomSnapshot({
      workspaceId: 'workspace-source', conversationId: 'conversation-source', mountNonce: 'mount-source', focusNonce: 'focus-source',
      theme: 'dark', view: structuredClone(view), supportedActions: ['open-source'], query: '', scrollIntent: null, assets: [],
    })
    const tool = projected.view.exchanges[0].responses[0].blocks.find((block) => block.kind === 'tool')
    assert.equal('toolOutput' in tool, false)
    assert.equal(JSON.stringify(projected).includes('SECRET'), false)
  }
})

function fixture() {
  const draft = { kind: 'skill', draft: { name: 'Skill', description: '', instructions: 'Do this', confidence: 'high', detectedIntegrations: [], reason: 'reason' } }
  const context = {
    workspaceId: 'workspace-a',
    conversationId: 'chat-a',
    mountNonce: 'nonce-a',
    focusNonce: 'focus-a',
    focused: true,
    mounted: true,
    allowedActions: ['copy', 'download-text', 'open-link', 'reply', 'jump-to-reply', 'open-asset', 'open-source', 'open-draft', 'keyboard-dismiss'],
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
    'copyText', 'downloadText', 'openLink', 'reply', 'jumpToReply', 'openAsset', 'openSource', 'openDraft', 'saveDraft', 'dismissKeyboard',
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
      ? { kind, workspaceId: context.workspaceId, conversationId: context.conversationId, mountNonce: context.mountNonce, focusNonce: context.focusNonce, intent: 'user-drag' }
      : { kind, workspaceId: context.workspaceId, conversationId: context.conversationId, mountNonce: context.mountNonce, focusNonce: context.focusNonce, exchangeId: 'exchange-a' }),
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
    focusNonce: request.focusNonce,
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

test('focus epochs reject delayed Copy, Download, and Draft after blur and refocus', async () => {
  for (const kind of ['copy', 'download-text', 'open-draft']) {
    const f = fixture()
    let finish
    const delayed = new Promise((resolve) => { finish = resolve })
    if (kind === 'copy') f.handlers.copyText = () => delayed
    if (kind === 'download-text') f.handlers.downloadText = () => delayed
    if (kind === 'open-draft') f.handlers.openDraft = () => delayed
    const request = f.request(kind, kind === 'copy'
      ? { target: { kind: 'user', userId: 'user-a' }, text: 'prompt' }
      : kind === 'download-text' ? { filename: 'answer.txt', text: 'answer' } : { toolKey: 'tool-key-a' })
    const pending = f.controller.dispatch(request)
    await Promise.resolve()
    f.context.focused = false
    f.context.focusNonce = 'focus-b'
    f.context.focused = true
    finish()
    assert.equal((await pending).error, 'stale-scope', `${kind} completion from an old focus epoch`)
    assert.equal((await f.controller.dispatch(request)).error, 'stale-scope', `${kind} callback from an old focus epoch`)
  }

  const f = fixture()
  await f.controller.dispatch(f.request('open-draft', { toolKey: 'tool-key-a' }))
  let finishSave
  f.handlers.saveDraft = () => new Promise((resolve) => { finishSave = resolve })
  const pendingSave = f.controller.saveDraft(f.getDraftToken(), f.draft)
  await Promise.resolve()
  f.context.focused = false
  f.context.focusNonce = 'focus-b'
  f.context.focused = true
  finishSave()
  assert.equal((await pendingSave).error, 'stale-scope', 'draft Save completion from an old focus epoch')
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

test('jump-to-reply resolves only the current user reply parent and passes parent ID with scope', async () => {
  const f = fixture()
  const source = f.context.view.exchanges[0]
  source.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Parent context' }
  const parent = structuredClone(source)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.user.id = 'parent-user'
  parent.user.replyThread = null
  f.context.view.exchanges.push(parent)
  const target = { kind: 'user', userId: source.user.id }
  const request = f.request('jump-to-reply', { target })

  assert.equal((await f.controller.dispatch(request)).ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['jumpToReply', 'parent-exchange', {
    workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', focusNonce: 'focus-a',
  }]])

  assert.equal((await f.controller.dispatch(f.request('jump-to-reply', { target: { kind: 'user', userId: 'parent-user' } }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('jump-to-reply', { exchangeId: 'parent-exchange', target }))).error, 'unknown-target')
  for (const extra of [{ parentExchangeId: 'parent-exchange' }, { destinationTurnId: 'parent-turn' }, { url: 'https://untrusted.example' }]) {
    assert.equal((await f.controller.dispatch({ ...request, ...extra })).error, 'invalid-request')
  }
  assert.equal((await f.controller.dispatch({ ...request, target: { kind: 'response', responseId: 'response-a' } })).error, 'invalid-request')
  assert.equal(f.calls.length, 1)

  source.user.replyThread = null
  assert.equal((await f.controller.dispatch(request)).error, 'unknown-target')
  source.user.replyThread = { replyToTurnId: 'removed-turn', replySnippet: 'Removed parent' }
  assert.equal((await f.controller.dispatch(request)).error, 'unknown-target')
  source.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Ambiguous parent' }
  f.context.view.exchanges.push({ ...structuredClone(parent), id: 'duplicate-parent' })
  assert.equal((await f.controller.dispatch(request)).error, 'unknown-target')
})

test('jump-to-reply revalidates focus, parent, and capability after delayed confirmation', async () => {
  const f = fixture()
  const source = f.context.view.exchanges[0]
  source.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Parent context' }
  const parent = structuredClone(source)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.user.id = 'parent-user'
  parent.user.replyThread = null
  f.context.view.exchanges.push(parent)
  const request = f.request('jump-to-reply', { target: { kind: 'user', userId: source.user.id } })
  const createConfirmedController = (confirm) => createNativeTranscriptActionController({
    getContext: () => f.context,
    handlers: f.handlers,
    confirmActions: ['jump-to-reply'],
    confirm,
    createDraftToken: () => 'unused-token',
  })
  const deferredConfirmation = () => {
    let resolve
    const promise = new Promise((finish) => { resolve = finish })
    return { promise, resolve }
  }

  const parentConfirmation = deferredConfirmation()
  const pendingParent = createConfirmedController(() => parentConfirmation.promise).dispatch(request)
  f.context.view.exchanges = [source]
  parentConfirmation.resolve(true)
  assert.equal((await pendingParent).error, 'unknown-target')

  f.context.view.exchanges.push(parent)
  const capabilityConfirmation = deferredConfirmation()
  const pendingCapability = createConfirmedController(() => capabilityConfirmation.promise).dispatch(request)
  f.context.allowedActions = f.context.allowedActions.filter((action) => action !== 'jump-to-reply')
  capabilityConfirmation.resolve(true)
  assert.equal((await pendingCapability).error, 'unsupported')

  f.context.allowedActions.push('jump-to-reply')
  const scopeConfirmation = deferredConfirmation()
  const pendingScope = createConfirmedController(() => scopeConfirmation.promise).dispatch(request)
  f.context.conversationId = 'chat-next'
  scopeConfirmation.resolve(true)
  assert.equal((await pendingScope).error, 'stale-scope')
  f.context.conversationId = 'chat-a'
  const staleRequest = { ...request, focusNonce: 'old-focus' }
  assert.equal((await f.controller.dispatch(staleRequest)).error, 'stale-scope')
  f.context.focusNonce = 'focus-next'
  assert.equal((await f.controller.dispatch(request)).error, 'stale-scope')
  assert.equal(f.calls.length, 0)
})

test('jump-to-reply rejects parent identity changes while its native handler is pending', async () => {
  const f = fixture()
  const source = f.context.view.exchanges[0]
  source.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Parent context' }
  const parent = structuredClone(source)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.user.id = 'parent-user'
  parent.user.replyThread = null
  const alternate = structuredClone(parent)
  alternate.id = 'alternate-parent-exchange'
  alternate.turnId = 'alternate-parent-turn'
  f.context.view.exchanges.push(parent, alternate)

  let finish
  const completion = new Promise((resolve) => { finish = resolve })
  let handlerCall
  f.handlers.jumpToReply = async (parentExchangeId, actionScope) => {
    handlerCall = { parentExchangeId, actionScope }
    await completion
  }
  const request = f.request('jump-to-reply', { target: { kind: 'user', userId: source.user.id } })
  const pending = f.controller.dispatch(request)
  assert.equal(handlerCall.parentExchangeId, 'parent-exchange')
  assert.equal(handlerCall.actionScope.workspaceId, 'workspace-a')
  assert.equal(handlerCall.actionScope.conversationId, 'chat-a')
  assert.equal(handlerCall.actionScope.mountNonce, 'nonce-a')
  assert.equal(handlerCall.actionScope.focusNonce, 'focus-a')

  source.user.replyThread = { replyToTurnId: 'alternate-parent-turn', replySnippet: 'Changed parent' }
  finish()
  assert.equal((await pending).error, 'unknown-target')
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

test('real news-digest automation graph opens and saves losslessly from its trusted adapter tool', async () => {
  const draft = realAutomationDraft()
  assert.ok(draft.graphSource.length > 256)
  assert.equal((draft.graphSource.match(/step\d+\[/g) ?? []).length, 11)
  const f = fixture()
  f.context.view = realAutomationView(draft)
  const exchange = f.context.view.exchanges[0]
  const response = exchange.responses[0]
  const request = f.request('open-draft', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    toolKey: 'real-automation-tool-key',
  })
  assert.equal((await f.controller.dispatch({ ...request, toolKey: 'wrong-tool-key' })).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(request)).ok, true)
  const opened = f.calls.find(([name]) => name === 'openDraft')
  assert.equal(JSON.stringify(opened?.[1]), JSON.stringify({ kind: 'automation', draft }))
  const token = f.getDraftToken()
  assert.equal((await f.controller.saveDraft(token, { kind: 'automation', draft })).ok, true)
  const saved = f.calls.find(([name]) => name === 'saveDraft')
  assert.equal(JSON.stringify(saved?.[1]), JSON.stringify({ kind: 'automation', draft }))
  assert.equal(JSON.stringify(saved?.[2]), JSON.stringify({ workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', focusNonce: 'focus-a' }))

  const oversized = { ...draft, graphSource: 'x'.repeat(MAX_AUTOMATION_GRAPH_SOURCE_LENGTH + 1) }
  const oversizedFixture = fixture()
  oversizedFixture.context.view = realAutomationView(oversized)
  const oversizedExchange = oversizedFixture.context.view.exchanges[0]
  const oversizedResponse = oversizedExchange.responses[0]
  assert.equal((await oversizedFixture.controller.dispatch(oversizedFixture.request('open-draft', {
    exchangeId: oversizedExchange.id,
    target: { kind: 'response', responseId: oversizedResponse.id },
    toolKey: 'real-automation-tool-key',
  }))).error, 'unknown-target')
})

test('open-citation resolves only a current numeric key and passes trusted citation with its origin scope', async () => {
  const f = fixture()
  const citations = {
    '1': { kind: 'file', sourceId: 'file-resource-1', title: 'Project plan', snippet: 'Trusted excerpt' },
    '2': { kind: 'memory', sourceId: 'memory-resource-2', title: 'Saved preference' },
  }
  f.context.allowedActions.push('open-citation')
  f.context.view = realCitationView(citations)
  const exchange = f.context.view.exchanges[0]
  const response = exchange.responses[0]
  const opened = []
  f.handlers.openCitation = async (...args) => opened.push(args)
  const request = f.request('open-citation', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    citationKey: '1',
  })
  assert.equal(Object.hasOwn(request, 'sourceId'), false)
  assert.equal(Object.hasOwn(request, 'citation'), false)
  assert.equal((await f.controller.dispatch(request)).ok, true)
  assert.equal(JSON.stringify(opened[0][0]), JSON.stringify(citations['1']))
  assert.equal(JSON.stringify(opened[0][1]), JSON.stringify({ workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', focusNonce: 'focus-a' }))
  assert.equal((await f.controller.dispatch({ ...request, citation: citations['1'] })).error, 'invalid-request')
  assert.equal((await f.controller.dispatch({ ...request, href: '/app/files?file=file-resource-1' })).error, 'invalid-request')
  assert.equal((await f.controller.dispatch({ ...request, citationKey: 'missing' })).error, 'invalid-request')
  assert.equal((await f.controller.dispatch({ ...request, citationKey: '3' })).error, 'unknown-target')

  response.sourceCitations['2'] = { kind: 'message', sourceId: 'message-resource-2' }
  assert.equal((await f.controller.dispatch({ ...request, citationKey: '2' })).error, 'unknown-target')
  response.sourceCitations['2'] = { kind: 'file', sourceId: '../invalid' }
  assert.equal((await f.controller.dispatch({ ...request, citationKey: '2' })).error, 'unknown-target')
  response.sourceCitations['2'] = { kind: 'memory', sourceId: 'memory-resource-2', extra: 'untrusted' }
  assert.equal((await f.controller.dispatch({ ...request, citationKey: '2' })).ok, true)
  assert.equal(JSON.stringify(opened[1][0]), JSON.stringify({ kind: 'memory', sourceId: 'memory-resource-2' }))
})

test('open-citation revalidates scope, target, capability, and strict IDs after confirmation', async () => {
  const mutations = [
    { error: 'stale-scope', change: (f) => { f.context.conversationId = 'chat-other' } },
    { error: 'unknown-target', change: (f, response) => { delete response.sourceCitations['1'] } },
    { error: 'unknown-target', change: (f, response) => { response.sourceCitations['1'].sourceId = '../invalid' } },
    { error: 'unsupported', change: (f) => { f.context.allowedActions = f.context.allowedActions.filter((action) => action !== 'open-citation') } },
  ]
  for (const mutation of mutations) {
    const f = fixture()
    f.context.allowedActions.push('open-citation')
    f.context.view = realCitationView({ '1': { kind: 'file', sourceId: 'file-resource-1', title: 'Plan' } })
    const exchange = f.context.view.exchanges[0]
    const response = exchange.responses[0]
    let handlerCalls = 0
    f.handlers.openCitation = async () => { handlerCalls += 1 }
    const controller = createNativeTranscriptActionController({
      getContext: () => f.context,
      handlers: f.handlers,
      confirmActions: ['open-citation'],
      confirm: async () => { mutation.change(f, response); return true },
      createDraftToken: () => 'citation-test-draft-token',
    })
    const result = await controller.dispatch(f.request('open-citation', {
      exchangeId: exchange.id,
      target: { kind: 'response', responseId: response.id },
      citationKey: '1',
    }))
    assert.equal(result.error, mutation.error)
    assert.equal(handlerCalls, 0)
  }
})

test('long native citations are normalized identically for projection and controller dispatch', async () => {
  const cyclicMetadata = {}
  cyclicMetadata.self = cyclicMetadata
  const sourceCitations = {
    '7': {
      kind: 'file',
      sourceId: 'citation-resource-007',
      title: 'T'.repeat(600),
      snippet: 'S'.repeat(2_200),
      secretSentinel: 'CITATION_SECRET_SENTINEL',
      cyclicMetadata,
    },
  }
  const view = realCitationView(sourceCitations)
  const exchange = view.exchanges[0]
  const response = exchange.responses[0]
  const f = fixture()
  f.context.view = view
  f.context.allowedActions.push('open-citation')
  const projectionView = structuredClone(view)
  const citationHandle = 'opaque_citation_resource_007'

  const projected = createNativeTranscriptDomSnapshot({
    workspaceId: f.context.workspaceId,
    conversationId: f.context.conversationId,
    mountNonce: f.context.mountNonce,
    focusNonce: f.context.focusNonce,
    theme: 'dark',
    view: projectionView,
    supportedActions: ['open-citation'],
    query: '',
    scrollIntent: null,
    assets: [{ handle: citationHandle, exchangeId: exchange.id, resourceId: 'citation-resource-007', resourceKind: 'file', previewable: true }],
  })
  const expectedCitation = {
    kind: 'file',
    sourceId: citationHandle,
    title: 'T'.repeat(512),
    snippet: 'S'.repeat(2_000),
  }
  const expectedNativeCitation = { ...expectedCitation, sourceId: 'citation-resource-007' }
  const projectedCitation = projected.view.exchanges[0].responses[0].sourceCitations?.['7']
  assert.ok(projectedCitation)
  assert.deepEqual(JSON.parse(JSON.stringify(projectedCitation)), expectedCitation)
  assert.equal(JSON.stringify(projected).includes('citation-resource-007'), false)
  assert.doesNotMatch(JSON.stringify(projected), /CITATION_SECRET_SENTINEL/)

  const opened = []
  f.handlers.openCitation = async (citation, scope) => { opened.push({ citation, scope }) }
  const result = await f.controller.dispatch(f.request('open-citation', {
    exchangeId: exchange.id,
    target: { kind: 'response', responseId: response.id },
    citationKey: '7',
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(opened[0])), {
    citation: expectedNativeCitation,
    scope: { workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', focusNonce: 'focus-a' },
  })
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
  const assetHandle = 'media_output_handle_0001'
  f.context.assets = [{ handle: assetHandle, exchangeId: exchange.id, resourceId: mediaResult.outputId, resourceKind: 'output', previewable: true }]
  assert.equal((await f.controller.dispatch(f.request('reply', { exchangeId: exchange.id, target: { kind: 'media', assetHandle } }))).ok, true)
  const trusted = f.calls.find(([name]) => name === 'reply')[1]
  assert.equal(trusted.response, null)
  assert.equal(trusted.mediaResult.outputId, mediaResult.outputId)
})

test('completed video Reply resolves by opaque identity while Open remains preview-only in mixed groups', async () => {
  const f = fixture()
  const videoHandle = 'completed_video_reply_handle_0001'
  const imageHandle = 'completed_image_reply_handle_0001'
  const exchange = f.context.view.exchanges[0]
  exchange.media = { kind: 'image', results: [
    { type: 'video', status: 'completed', outputId: 'completed-video-output', url: 'https://protected.example/video' },
    { type: 'image', status: 'completed', outputId: 'completed-image-output', url: 'https://protected.example/image' },
    { type: 'video', status: 'generating', outputId: 'temporary-video-output', url: 'https://protected.example/temp' },
  ] }
  f.context.assets = [
    { handle: videoHandle, exchangeId: exchange.id, resourceId: 'completed-video-output', resourceKind: 'output', previewable: false },
    { handle: imageHandle, exchangeId: exchange.id, resourceId: 'completed-image-output', resourceKind: 'output', previewable: true },
  ]
  assert.equal((await f.controller.dispatch(f.request('reply', { exchangeId: exchange.id, target: { kind: 'media', assetHandle: videoHandle } }))).ok, true)
  assert.equal(f.calls.find(([name]) => name === 'reply')[1].mediaResult.outputId, 'completed-video-output')
  assert.equal((await f.controller.dispatch(f.request('open-asset', { exchangeId: exchange.id, assetHandle: videoHandle }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('open-asset', { exchangeId: exchange.id, assetHandle: imageHandle }))).ok, true)
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

test('action leases reject removed responses and changed or canceled Draft origins before follow-up writes', async () => {
  const f = fixture()
  let finishDownload
  let downloadScope
  let followUpWrites = 0
  f.handlers.downloadText = async (_filename, _text, scope) => {
    downloadScope = scope
    await new Promise((resolve) => { finishDownload = resolve })
    if (scope.isCurrent()) followUpWrites += 1
  }
  const download = f.controller.dispatch(f.request('download-text', { filename: 'answer.txt', text: 'response text' }))
  await Promise.resolve()
  assert.equal(downloadScope.isCurrent(), true)
  f.context.view.exchanges[0].responses = []
  assert.equal(downloadScope.isCurrent(), false)
  finishDownload()
  assert.equal((await download).ok, false)
  assert.equal(followUpWrites, 0)

  for (const revoke of [
    (controller, context) => { context.view.exchanges[0].responses[0].blocks = [] },
    (_controller, context) => { context.view.exchanges[0].responses[0].blocks[1].toolOutput.draft.name = 'Changed source' },
    (controller, _context, token) => { controller.cancelDraft(token) },
    (_controller, context) => { context.focused = false },
  ]) {
    const current = fixture()
    await current.controller.dispatch(current.request('open-draft', { toolKey: 'tool-key-a' }))
    const token = current.getDraftToken()
    let finishSave
    let saveScope
    let writes = 0
    current.handlers.saveDraft = async (_draft, scope) => {
      saveScope = scope
      await new Promise((resolve) => { finishSave = resolve })
      if (scope.isCurrent()) writes += 1
    }
    const pendingSave = current.controller.saveDraft(token, current.draft)
    await Promise.resolve()
    revoke(current.controller, current.context, token)
    assert.equal(saveScope.isCurrent(), false)
    finishSave()
    assert.equal((await pendingSave).ok, false)
    assert.equal(writes, 0)
  }
})

test('copy and Download leases preserve requested text through unrelated response streaming', async () => {
  for (const kind of ['copy', 'download-text']) {
    const f = fixture()
    const sourceExchange = f.context.view.exchanges[0]
    let finish
    let received
    const requestedText = kind === 'copy' ? 'selected response text' : 'original download text'
    if (kind === 'copy') {
      f.handlers.copyText = async (text, scope) => {
        received = text
        f.scope = scope
        await new Promise((resolve) => { finish = resolve })
        if (scope.isCurrent()) f.followUpWrites = (f.followUpWrites ?? 0) + 1
      }
    } else {
      f.handlers.downloadText = async (_filename, text, scope) => {
        received = text
        f.scope = scope
        await new Promise((resolve) => { finish = resolve })
        if (scope.isCurrent()) f.followUpWrites = (f.followUpWrites ?? 0) + 1
      }
    }
    const request = f.request(kind, kind === 'copy'
      ? { text: requestedText }
      : { filename: 'answer.txt', text: requestedText })
    const pending = f.controller.dispatch(request)
    await Promise.resolve()
    assert.equal(f.scope.isCurrent(), true)
    sourceExchange.responses[0].blocks.push({ kind: 'text', text: 'Appended streamed text' })
    assert.equal(f.scope.isCurrent(), true)
    finish()
    assert.equal((await pending).ok, true)
    assert.equal(received, requestedText)
    assert.equal(f.followUpWrites, 1)
  }
})

test('Copy leases reject removed and replaced response targets', async () => {
  for (const replace of [
    (exchange) => { exchange.responses = [] },
    (exchange) => { exchange.responses[0] = { ...exchange.responses[0], id: 'replacement-response' } },
  ]) {
    const f = fixture()
    let finish
    let scope
    let writes = 0
    f.handlers.copyText = async (_text, currentScope) => {
      scope = currentScope
      await new Promise((resolve) => { finish = resolve })
      if (scope.isCurrent()) writes += 1
    }
    const pending = f.controller.dispatch(f.request('copy', { text: 'original selection' }))
    await Promise.resolve()
    replace(f.context.view.exchanges[0])
    assert.equal(scope.isCurrent(), false)
    finish()
    assert.equal((await pending).ok, false)
    assert.equal(writes, 0)
  }
})

test('open Draft and jump-to-reply leases survive unrelated text and status updates', async () => {
  const draftFixture = fixture()
  let finishDraft
  let draftScope
  const openDraft = draftFixture.handlers.openDraft
  draftFixture.handlers.openDraft = async (draft, scope, token) => {
    draftScope = scope
    await new Promise((resolve) => { finishDraft = resolve })
    await openDraft(draft, scope, token)
  }
  const draftOpen = draftFixture.controller.dispatch(draftFixture.request('open-draft', { toolKey: 'tool-key-a' }))
  await Promise.resolve()
  draftFixture.context.view.exchanges[0].responses[0].blocks.push({ kind: 'text', text: 'Unrelated streamed text' })
  assert.equal(draftScope.isCurrent(), true)
  finishDraft()
  assert.equal((await draftOpen).ok, true)
  assert.ok(draftFixture.getDraftToken())

  const f = fixture()
  const child = f.context.view.exchanges[0]
  child.user.replyThread = { replyToTurnId: 'parent-turn', replySnippet: 'Parent' }
  const parent = structuredClone(child)
  parent.id = 'parent-exchange'
  parent.turnId = 'parent-turn'
  parent.user.id = 'parent-user'
  parent.user.text = 'Parent response'
  parent.user.replyThread = null
  f.context.view.exchanges.push(parent)
  let finishJump
  let jumpScope
  let writes = 0
  f.handlers.jumpToReply = async (_parentId, scope) => {
    jumpScope = scope
    await new Promise((resolve) => { finishJump = resolve })
    if (scope.isCurrent()) writes += 1
  }
  const jump = f.controller.dispatch(f.request('jump-to-reply', { target: { kind: 'user', userId: child.user.id } }))
  await Promise.resolve()
  parent.user.text = 'Updated parent text'
  parent.responses[0].status = 'streaming'
  parent.responses[0].blocks.push({ kind: 'text', text: 'Parent token' })
  assert.equal(jumpScope.isCurrent(), true)
  finishJump()
  assert.equal((await jump).ok, true)
  assert.equal(writes, 1)
})

test('source and citation leases still revoke on relevant resource changes', async () => {
  for (const kind of ['open-source', 'open-citation']) {
    const f = fixture()
    const response = f.context.view.exchanges[0].responses[0]
    let finish
    let scope
    let writes = 0
    let mutate
    if (kind === 'open-source') {
      f.handlers.openSource = async (_source, currentScope) => {
        scope = currentScope
        await new Promise((resolve) => { finish = resolve })
        if (scope.isCurrent()) writes += 1
      }
      mutate = () => { response.sources[0].url = 'https://changed.example/path' }
    } else {
      f.context.allowedActions.push('open-citation')
      response.sourceCitations = { 0: { kind: 'file', sourceId: 'file-a', title: 'Citation' } }
      f.handlers.openCitation = async (_citation, currentScope) => {
        scope = currentScope
        await new Promise((resolve) => { finish = resolve })
        if (scope.isCurrent()) writes += 1
      }
      mutate = () => { response.sourceCitations[0].title = 'Changed citation' }
    }
    const request = f.request(kind, kind === 'open-source' ? { sourceId: 'source-a' } : { citationKey: '0' })
    const pending = f.controller.dispatch(request)
    await Promise.resolve()
    mutate()
    assert.equal(scope.isCurrent(), false)
    finish()
    assert.equal((await pending).ok, false)
    assert.equal(writes, 0)
  }
})

test('sources and keyboard dismiss require current supported native actions', async () => {
  const f = fixture()
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'source-a' }))).ok, true)
  assert.equal((await f.controller.dispatch(f.request('open-source', { sourceId: 'unknown' }))).error, 'unknown-target')
  assert.equal((await f.controller.dispatch(f.request('keyboard-dismiss'))).ok, true)
  assert.equal((await f.controller.dispatch({ kind: 'keyboard-dismiss', workspaceId: 'workspace-a', conversationId: 'chat-a', mountNonce: 'nonce-a', focusNonce: 'focus-a', intent: 'programmatic-scroll' })).error, 'invalid-request')
  for (const unsupported of ['delete-turn', 'branch', 'retry', 'continue', 'generated-ui-write', 'regenerate']) {
    assert.equal((await f.controller.dispatch(f.request(unsupported))).error, 'invalid-request')
  }
})
