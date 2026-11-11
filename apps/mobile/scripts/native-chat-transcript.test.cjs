/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file) {
  const cache = new Map()
  function loadFile(relativeFile) {
    const filename = path.resolve(root, relativeFile)
    if (cache.has(filename)) return cache.get(filename).exports
    const loadedModule = { exports: {} }
    cache.set(filename, loadedModule)
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText
    const localRequire = id => {
      if (id === '@overlay/chat-core') {
        return Object.assign(
          {},
          loadFile('../packages/overlay-chat-core/src/messages.ts'),
          loadFile('../packages/overlay-chat-core/src/transcript-view.ts'),
          loadFile('../packages/overlay-chat-core/src/visual-sequence.ts'),
        )
      }
      if (id.startsWith('react-native') || id.startsWith('expo-') || id.startsWith('convex/')) {
        assert.fail(`Pure transcript adapter loaded platform dependency: ${id}`)
      }
      if (!id.startsWith('.')) return require(id)
      const base = path.resolve(path.dirname(filename), id)
      const withoutJs = base.replace(/\.js$/, '')
      const candidate = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        withoutJs,
        `${withoutJs}.ts`,
        `${withoutJs}.tsx`,
      ].find(candidatePath => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile())
      assert.ok(candidate, `Could not resolve ${id} from ${filename}`)
      return loadFile(path.relative(root, candidate))
    }
    vm.runInNewContext(
      `(function(require,module,exports){${output}\n})`,
      { console, Error },
      )(localRequire, loadedModule, loadedModule.exports)
    return loadedModule.exports
  }
  return loadFile(file)
}

const clean = value => JSON.parse(JSON.stringify(value))
const user = (id, turnId, extra = {}) => ({
  id,
  turnId,
  role: 'user',
  content: `Question ${id}`,
  timestamp: 10,
  mode: 'act',
  ...extra,
})
const assistant = (id, turnId, extra = {}) => ({
  id,
  turnId,
  role: 'assistant',
  content: `Answer ${id}`,
  timestamp: 20,
  mode: 'act',
  ...extra,
})

test('groups explicit and legacy turns and gives assistant orphans an empty user', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const view = toNativeChatTranscriptView([
    user('user-explicit', 'turn-explicit'),
    assistant('assistant-explicit', 'turn-explicit'),
    user('legacy-user', undefined),
    assistant('legacy-assistant', undefined),
    assistant('orphan-explicit', 'orphan-turn'),
  ])

  assert.deepEqual(clean(view.exchanges.map(exchange => exchange.turnId)), [
    'turn-explicit',
    'legacy-user',
    'orphan-turn',
  ])
  assert.equal(view.exchanges[2].user.text, '')
  assert.equal(view.exchanges[2].user.id, 'orphan-turn:user')

  const legacyOrphan = toNativeChatTranscriptView([
    assistant('orphan-legacy', undefined),
  ]).exchanges[0]
  assert.equal(legacyOrphan.turnId, 'legacy-orphan-orphan-legacy')
  assert.equal(legacyOrphan.user.text, '')
})

test('empty and user-only transcripts are valid and old cached messages remain accepted', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  assert.deepEqual(clean(toNativeChatTranscriptView([])), { version: 1, exchanges: [] })

  const userOnly = toNativeChatTranscriptView([user('only-user', 'only-turn')]).exchanges[0]
  assert.equal(userOnly.responses.length, 0)
  assert.equal(userOnly.selectedResponseIndex, -1)
  assert.equal(userOnly.status, 'idle')
  assert.equal(userOnly.media, null)

  const oldCache = toNativeChatTranscriptView([
    { id: 'old-user', role: 'user', content: 'Cached question', timestamp: 1 },
    {
      id: 'old-assistant',
      role: 'assistant',
      content: 'Cached answer',
      timestamp: 2,
      blocks: [{ kind: 'text', text: 'Cached answer' }],
      transcriptSources: [],
    },
  ])
  assert.equal(oldCache.exchanges[0].user.text, 'Cached question')
  assert.equal(oldCache.exchanges[0].responses[0].blocks[0].text, 'Cached answer')
})

test('preserves multiple model variants and keeps canonical selected blocks on one response', () => {
  const core = load('lib/toNativeChatTranscriptView.ts')
  const sourcePart = {
    type: 'source-url',
    id: 'source-1',
    sourceId: 'web-result-1',
    url: 'https://example.test',
    title: 'Example',
  }
  const normalized = load('../packages/overlay-chat-core/src/transcript-view.ts')
    .normalizeTranscriptAssistantParts([
      { type: 'reasoning', text: 'Selected reasoning' },
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: 'selected-tool',
          toolName: 'search',
          state: 'output-available',
          toolOutput: { result: 'selected' },
        },
      },
      {
        type: 'data',
        id: 'draft-1',
        dataType: 'overlay.generated_ui',
        data: { version: 1, kind: 'draft.text', body: 'Selected draft' },
      },
      sourcePart,
      { type: 'text', text: 'Selected answer' },
    ])
  const view = core.toNativeChatTranscriptView([
    user('user', 'turn', { selectedModelId: 'beta' }),
    assistant('assistant', 'turn', {
      modelId: 'alpha',
      selectedModelId: 'beta',
      content: 'Selected answer',
      reasoning: 'Selected reasoning',
      toolInvocations: [{ toolName: 'search', toolOutput: { result: 'selected' } }],
      generatedFiles: [{ url: '/selected.png', mediaType: 'image/png' }],
      blocks: normalized.blocks,
      transcriptSources: normalized.sources,
      sourceCitations: { source: { kind: 'file', sourceId: 'private-source' } },
      responses: [
        { modelId: 'alpha', modelName: 'Alpha', provider: 'a', content: 'Alpha answer', isLoading: false },
        { modelId: 'beta', modelName: 'Beta', provider: 'b', content: 'Beta first', isLoading: false, variantIndex: 0 },
        { modelId: 'beta', modelName: 'Beta', provider: 'b', content: 'Beta latest', isLoading: false, variantIndex: 1 },
      ],
    }),
  ]).exchanges[0]

  assert.deepEqual(clean(view.responses.map(response => response.modelId)), ['alpha', 'beta', 'beta'])
  assert.deepEqual(clean(view.responses.map(response => response.id)), [
    'turn:response:alpha:0',
    'turn:response:beta:0',
    'turn:response:beta:1',
  ])
  assert.equal(view.selectedModelId, 'beta')
  assert.equal(view.selectedResponseIndex, 2)
  assert.deepEqual(clean(view.responses[0].blocks), [{ kind: 'text', text: 'Alpha answer' }])
  assert.deepEqual(clean(view.responses[1].blocks), [{ kind: 'text', text: 'Beta first' }])
  assert.deepEqual(clean(view.responses[2].blocks), clean(normalized.blocks))
  assert.equal(view.responses[0].sources.length, 0)
  assert.equal(view.responses[2].sources[0].sourceId, 'web-result-1')
  assert.equal(view.responses[2].sourceCitations.source.sourceId, 'private-source')
})

test('streaming completion keeps response ids stable and maps settled, failed, and interrupted states', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const streaming = [
    user('user', 'stable-turn', { selectedModelId: 'model' }),
    assistant('streaming', 'stable-turn', {
      modelId: 'model',
      variantIndex: 0,
      isStreaming: true,
      responses: [{
        modelId: 'model',
        modelName: 'Model',
        provider: 'provider',
        content: 'Complete paragraph.\n\npartial tail',
        reasoning: 'Reasoning',
        toolInvocations: [{ toolName: 'lookup', state: 'output-available' }],
        generatedFiles: [{ url: '/result.pdf', mediaType: 'application/pdf' }],
        isLoading: true,
      }],
    }),
  ]
  const before = JSON.stringify(streaming)
  const live = toNativeChatTranscriptView(streaming, {
    activeTurnId: 'stable-turn',
    status: 'streaming',
  }).exchanges[0]
  assert.equal(live.status, 'streaming')
  assert.equal(live.responses[0].status, 'streaming')
  assert.equal(live.responses[0].blocks[0].text, 'Complete paragraph.\n\n')
  assert.ok(live.responses[0].blocks.some(block => block.kind === 'reasoning'))
  assert.ok(live.responses[0].blocks.some(block => block.kind === 'tool'))
  assert.ok(live.responses[0].blocks.some(block => block.kind === 'file'))
  assert.equal(JSON.stringify(streaming), before)

  const settled = toNativeChatTranscriptView([
    user('user', 'stable-turn', { selectedModelId: 'model' }),
    assistant('persisted', 'stable-turn', {
      modelId: 'model',
      variantIndex: 0,
      status: 'completed',
      blocksAreComplete: true,
      blocks: [{ kind: 'text', text: 'Complete paragraph.\n\nSettled tail.' }],
    }),
  ]).exchanges[0]
  assert.equal(settled.responses[0].id, live.responses[0].id)
  assert.equal(settled.responses[0].blocks[0].text, 'Complete paragraph.\n\nSettled tail.')
  assert.equal(settled.status, 'completed')

  const failed = toNativeChatTranscriptView(streaming, {
    activeTurnId: 'stable-turn',
    status: 'failed',
    error: 'Generation failed',
  }).exchanges[0]
  assert.equal(failed.status, 'error')
  assert.equal(failed.responses[0].status, 'error')
  assert.equal(failed.responses[0].errorMessage, 'Generation failed')

  const interrupted = toNativeChatTranscriptView(streaming, {
    activeTurnId: 'stable-turn',
    interrupted: true,
  }).exchanges[0]
  assert.equal(interrupted.status, 'interrupted')
  assert.equal(interrupted.responses[0].status, 'interrupted')
})

test('typed Convex rows map modelId, status, user metadata, normalized parts, and media outputs', () => {
  const { mapNativePersonalMessageRows } = load('lib/toNativeChatMessage.ts')
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const output = {
    _id: 'output-image',
    type: 'image',
    status: 'completed',
    prompt: 'A blue bird',
    modelId: 'image-model',
    createdAt: 30,
    turnId: 'native-turn',
    url: '/api/v1/files/output-image/content',
  }
  const userMessage = {
    _id: 'user-row',
    turnId: 'native-turn',
    role: 'user',
    mode: 'act',
    contentType: 'image',
    modelId: 'image-model',
    content: 'Please inspect [Indexed documents: body.txt]',
    parts: [
      { type: 'text', text: 'Please inspect [Indexed documents: body.txt]' },
      { type: 'file', url: '/api/v1/files/photo/content', mediaType: 'image/jpeg', fileName: 'photo.jpg' },
    ],
    userMetadata: {
      indexedDocuments: ['notes.md'],
      indexedAttachments: [{ name: 'spec.pdf', fileIds: ['file-spec'] }],
      mentions: [{ type: 'file', id: 'file-spec', name: 'Spec', fileIds: ['file-spec'] }],
    },
    replyToTurnId: 'prior-turn',
    replySnippet: 'Earlier answer',
    createdAt: 10,
  }
  const assistantMessage = {
    _id: 'assistant-row',
    turnId: 'native-turn',
    role: 'assistant',
    mode: 'act',
    contentType: 'image',
    modelId: 'actual-convex-model-id',
    variantIndex: 1,
    content: 'Image response',
    parts: [
      { type: 'reasoning', text: 'Reasoning block' },
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: 'tool-1',
          toolName: 'search',
          state: 'output-available',
          toolOutput: { result: 'found' },
        },
      },
      {
        type: 'data',
        id: 'draft-1',
        dataType: 'overlay.generated_ui',
        data: { version: 1, kind: 'draft.text', body: 'Generated draft' },
      },
      {
        type: 'source-url',
        id: 'source-1',
        sourceId: 'web-source',
        url: 'https://example.test/source',
        title: 'Source title',
      },
      { type: 'file', url: '/api/v1/files/generated.pdf', mediaType: 'application/pdf', fileName: 'generated.pdf' },
      { type: 'text', text: 'Image response' },
    ],
    status: 'completed',
    createdAt: 20,
  }
  const rows = [
    { message: assistantMessage, contextUser: null, outputs: [output] },
    { message: userMessage, contextUser: null, outputs: [output] },
  ]
  const originalRows = JSON.stringify(rows)
  const messages = mapNativePersonalMessageRows(rows)
  assert.equal(JSON.stringify(rows), originalRows)
  const storedAssistant = messages.find(message => message.role === 'assistant')
  assert.equal(storedAssistant.modelId, 'actual-convex-model-id')
  assert.equal(storedAssistant.responses[0].modelId, 'actual-convex-model-id')
  assert.equal(storedAssistant.variantIndex, 1)
  assert.equal(storedAssistant.status, 'completed')
  assert.equal(storedAssistant.blocksAreComplete, true)
  assert.equal(storedAssistant.generatedFiles[0].url, '/api/v1/files/generated.pdf')

  const view = toNativeChatTranscriptView(messages)
  const exchange = view.exchanges[0]
  assert.equal(exchange.responses[0].modelId, 'actual-convex-model-id')
  assert.deepEqual(clean(exchange.responses[0].blocks.map(block => block.kind)), [
    'reasoning',
    'tool',
    'generated-ui',
    'source',
    'file',
    'text',
  ])
  assert.equal(exchange.responses[0].sources[0].sourceId, 'web-source')
  assert.equal(exchange.user.text, 'Please inspect')
  assert.ok(exchange.user.documentNames.includes('notes.md'))
  assert.ok(exchange.user.documentNames.includes('body.txt'))
  assert.ok(exchange.user.documentNames.includes('spec.pdf'))
  assert.deepEqual(clean(exchange.user.indexedAttachments), [
    { name: 'spec.pdf', fileIds: ['file-spec'] },
  ])
  assert.deepEqual(clean(exchange.user.images), [{
    url: '/api/v1/files/photo/content',
    name: 'photo.jpg',
    mediaType: 'image/jpeg',
  }])
  assert.deepEqual(clean(exchange.user.mentions), [{
    type: 'file',
    id: 'file-spec',
    name: 'Spec',
    fileIds: ['file-spec'],
  }])
  assert.deepEqual(clean(exchange.user.replyThread), {
    replyToTurnId: 'prior-turn',
    replySnippet: 'Earlier answer',
  })
  assert.equal(exchange.selectedModelId, 'image-model')
  assert.equal(exchange.media.kind, 'image')
  assert.equal(exchange.media.results[0].outputId, 'output-image')
  assert.equal(exchange.media.results[0].modelUsed, 'image-model')
  assert.equal(exchange.media.results[0].status, 'completed')
  assert.equal(exchange.media.results.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(view)), clean(view))

  const videoOutput = {
    _id: 'output-video',
    type: 'video',
    status: 'pending',
    prompt: 'A blue bird taking flight',
    modelId: 'video-model',
    createdAt: 50,
    turnId: 'video-turn',
  }
  const videoMessages = mapNativePersonalMessageRows([
    {
      message: { ...assistantMessage, _id: 'video-assistant', turnId: 'video-turn', modelId: 'video-model', contentType: 'video' },
      contextUser: null,
      outputs: [videoOutput],
    },
    {
      message: { ...userMessage, _id: 'video-user', turnId: 'video-turn', modelId: 'video-model', contentType: 'video' },
      contextUser: null,
      outputs: [videoOutput],
    },
  ])
  const videoExchange = toNativeChatTranscriptView(videoMessages).exchanges[0]
  assert.equal(videoExchange.media.kind, 'video')
  assert.equal(videoExchange.media.results[0].type, 'video')
  assert.equal(videoExchange.media.results[0].status, 'generating')
  assert.equal(videoExchange.media.results[0].outputId, 'output-video')

  const errorMessages = mapNativePersonalMessageRows([{
    message: {
      _id: 'error-assistant',
      turnId: 'error-turn',
      role: 'assistant',
      mode: 'ask',
      contentType: 'text',
      modelId: 'error-model',
      content: 'The response failed',
      parts: [{
        type: 'data-native-agent-error',
        data: { runId: 'test-run-id', code: 'MODEL_ERROR', message: 'Safe display error', retryable: true },
      }],
      status: 'error',
      createdAt: 60,
    },
    contextUser: null,
    outputs: [],
  }])
  assert.equal(errorMessages[0].status, 'error')
  assert.equal(errorMessages[0].errorMessage, 'Safe display error')
  const errorResponse = toNativeChatTranscriptView(errorMessages).exchanges[0].responses[0]
  assert.equal(errorResponse.status, 'error')
  assert.equal(errorResponse.errorMessage, 'Safe display error')
  assert.equal(JSON.stringify(errorResponse).includes('test-run-id'), false)
})

test('pagination context users and repeated output rows are deduplicated without replacing real users', () => {
  const { mapNativePersonalMessageRows } = load('lib/toNativeChatMessage.ts')
  const contextUser = {
    _id: 'context-user',
    turnId: 'context-turn',
    role: 'user',
    mode: 'ask',
    contentType: 'text',
    content: 'Context prompt',
    parts: [{ type: 'text', text: 'Context prompt' }],
    createdAt: 1,
  }
  const actualUser = {
    _id: 'actual-user',
    turnId: 'real-turn',
    role: 'user',
    mode: 'act',
    contentType: 'text',
    content: 'Real prompt',
    parts: [{ type: 'text', text: 'Real prompt' }],
    createdAt: 2,
  }
  const messages = mapNativePersonalMessageRows([
    {
      message: { ...assistant('context-a2', 'context-turn'), _id: 'context-a2', createdAt: 4 },
      contextUser,
      outputs: [],
    },
    {
      message: { ...assistant('context-a1', 'context-turn'), _id: 'context-a1', createdAt: 3 },
      contextUser,
      outputs: [],
    },
    {
      message: { ...assistant('real-a', 'real-turn'), _id: 'real-a', createdAt: 5 },
      contextUser: null,
      outputs: [],
    },
    { message: actualUser, contextUser: null, outputs: [] },
  ])
  assert.equal(messages.filter(message => message.role === 'user' && message.turnId === 'context-turn').length, 1)
  assert.equal(messages.find(message => message.turnId === 'context-turn').id, 'context-user')
  assert.equal(messages.filter(message => message.role === 'user' && message.turnId === 'real-turn').length, 1)
  assert.equal(messages.find(message => message.turnId === 'real-turn' && message.role === 'user').id, 'actual-user')
})

test('ordered streaming blocks preserve text before tool, reasoning, and file blocks', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const { normalizeTranscriptAssistantParts } = load('../packages/overlay-chat-core/src/transcript-view.ts')
  const committedText = 'Committed text before the tool with an unfinished-looking tail'
  const normalized = normalizeTranscriptAssistantParts([
    { type: 'text', text: committedText },
    {
      type: 'tool-invocation',
      toolInvocation: { toolCallId: 'lookup', toolName: 'lookup', state: 'input-available' },
    },
    { type: 'reasoning', text: 'Thinking' },
    { type: 'file', url: '/result.pdf', mediaType: 'application/pdf' },
  ])
  const exchange = toNativeChatTranscriptView([
    user('ordered-user', 'ordered-turn', { selectedModelId: 'model' }),
    assistant('ordered-assistant', 'ordered-turn', {
      modelId: 'model',
      isStreaming: true,
      blocks: normalized.blocks,
    }),
  ]).exchanges[0]

  assert.equal(exchange.responses[0].blocks[0].text, committedText)
  assert.deepEqual(clean(exchange.responses[0].blocks.map(block => block.kind)), [
    'text', 'tool', 'reasoning', 'file',
  ])
})

test('canonical streaming completion only holds a true trailing text block', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const { normalizeTranscriptAssistantParts } = load('../packages/overlay-chat-core/src/transcript-view.ts')
  const committedText = 'Committed text before tool output'
  const tail = 'Heading\n\nComplete paragraph.\n\npartial tail'
  const normalized = normalizeTranscriptAssistantParts([
    { type: 'text', text: committedText },
    {
      type: 'tool-invocation',
      toolInvocation: { toolCallId: 'lookup', toolName: 'lookup', state: 'output-available' },
    },
    { type: 'reasoning', text: 'Thinking' },
    { type: 'file', url: '/result.pdf', mediaType: 'application/pdf' },
    { type: 'text', text: tail },
  ])
  const exchange = toNativeChatTranscriptView([
    user('tail-user', 'tail-turn', { selectedModelId: 'model' }),
    assistant('tail-assistant', 'tail-turn', {
      modelId: 'model',
      isStreaming: true,
      blocksAreComplete: false,
      blocks: normalized.blocks,
    }),
  ]).exchanges[0]

  assert.equal(exchange.responses[0].blocks[0].text, committedText)
  assert.equal(exchange.responses[0].blocks.at(-1).text, 'Heading\n\nComplete paragraph.\n\n')
})

test('legacy content fallback still completes text before synthetic reasoning and tools', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const exchange = toNativeChatTranscriptView([
    user('legacy-stream-user', 'legacy-stream-turn', { selectedModelId: 'model' }),
    assistant('legacy-stream-assistant', 'legacy-stream-turn', {
      modelId: 'model',
      content: 'Intro.\n\nComplete paragraph.\n\npartial tail',
      reasoning: 'Reasoning',
      toolInvocations: [{ toolName: 'lookup', state: 'output-available' }],
      generatedFiles: [{ url: '/result.pdf', mediaType: 'application/pdf' }],
      isStreaming: true,
    }),
  ]).exchanges[0]

  assert.equal(exchange.responses[0].blocks[0].text, 'Intro.\n\nComplete paragraph.\n\n')
  assert.deepEqual(clean(exchange.responses[0].blocks.map(block => block.kind)), [
    'text', 'reasoning', 'tool', 'file',
  ])
})

test('exchange status follows the selected response rather than older failed variants', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const messagesFor = healthyStatus => [
    user('variant-user', 'variant-turn', { selectedModelId: 'healthy' }),
    assistant('variant-assistant', 'variant-turn', {
      modelId: 'healthy',
      selectedModelId: 'healthy',
      responses: [
        {
          modelId: 'failed', modelName: 'Failed', provider: 'old', content: 'Old failure',
          isLoading: false, status: 'failed', error: 'Old failure',
        },
        {
          modelId: 'healthy', modelName: 'Healthy', provider: 'new', content: 'Current response',
          isLoading: healthyStatus === 'generating', status: healthyStatus,
        },
      ],
    }),
  ]

  const streaming = toNativeChatTranscriptView(messagesFor('generating')).exchanges[0]
  assert.equal(streaming.selectedResponseIndex, 1)
  assert.equal(streaming.responses[0].status, 'error')
  assert.equal(streaming.responses[1].status, 'streaming')
  assert.equal(streaming.status, 'streaming')

  const completed = toNativeChatTranscriptView(messagesFor('completed')).exchanges[0]
  assert.equal(completed.status, 'completed')
})

test('submitted user-only turns remain submitted before a response arrives', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const pending = toNativeChatTranscriptView(
    [user('submitted-user', 'submitted-turn')],
    { activeTurnId: 'submitted-turn', status: 'submitted' },
  ).exchanges[0]

  assert.equal(pending.responses.length, 0)
  assert.equal(pending.status, 'submitted')

  const submittedResponse = toNativeChatTranscriptView([
    user('submitted-user-2', 'submitted-turn-2', { selectedModelId: 'model' }),
    assistant('submitted-assistant', 'submitted-turn-2', { modelId: 'model', status: 'submitted' }),
  ]).exchanges[0]
  assert.equal(submittedResponse.responses[0].status, 'submitted')
  assert.equal(submittedResponse.status, 'submitted')
})

test('image and video exchange status follows pending, failed, and completed outputs', () => {
  const { toNativeChatTranscriptView } = load('lib/toNativeChatTranscriptView.ts')
  const exchangeFor = (statuses, type = 'image') => toNativeChatTranscriptView([
    user('media-user', 'media-turn', {
      contentType: type,
      outputs: statuses.map((status, index) => ({
        _id: `output-${index}`,
        type,
        status,
        prompt: 'Image prompt',
        modelId: 'image-model',
        createdAt: index + 1,
        turnId: 'media-turn',
      })),
    }),
  ]).exchanges[0]

  assert.equal(exchangeFor(['pending']).status, 'streaming')
  assert.equal(exchangeFor(['failed']).status, 'error')
  assert.equal(exchangeFor(['completed']).status, 'completed')
  assert.equal(exchangeFor(['completed', 'pending']).status, 'streaming')
  assert.equal(exchangeFor(['failed', 'pending']).status, 'error')
  assert.equal(exchangeFor(['pending'], 'video').status, 'streaming')
  assert.equal(exchangeFor(['failed'], 'video').status, 'error')
  assert.equal(exchangeFor(['completed'], 'video').status, 'completed')
})
