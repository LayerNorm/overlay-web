/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const clean = value => JSON.parse(JSON.stringify(value))
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(root, file)
  const source = fs.readFileSync(filename, 'utf8')
  const result = { exports: {} }
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.React } }).outputText
  vm.runInNewContext('(function(require,module,exports){' + output + '\n})', { console: { log() {}, error() {} }, Error, ...globals })(id => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id.endsWith('.png')) return 1
    if (id === '@overlay/chat-core') return { ...load('../packages/overlay-chat-core/src/visual-sequence.ts', mocks), ...load('../packages/overlay-chat-core/src/messages.ts', mocks) }
    assert.ok(id.startsWith('.'), 'Unexpected dependency: ' + id)
    const target = path.resolve(path.dirname(filename), id)
    return load(fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx', mocks)
  }, result, result.exports)
  return result.exports
}
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), memo: component => component, forwardRef: component => component, useMemo: fn => fn(), useState: value => [value, () => {}], useRef: value => ({ current: value }) }
react.default = react
const native = new Proxy({ StyleSheet: { create: styles => styles, flatten: style => style, hairlineWidth: 1 } }, { get: (target, key) => target[key] ?? key })
const ui = { react, 'react-native': native, 'lucide-react-native': native, 'react-native-enriched-markdown': { EnrichedMarkdownText: 'Markdown' }, '@expo/vector-icons': { Feather: 'Feather' }, 'expo-image': { Image: 'Image' }, 'react-native-reanimated': { default: { View: 'AnimatedView' }, FadeIn: { duration: () => null } }, '../../constants/theme': { spacing: {}, fontSize: {}, borderRadius: {} }, './GeneratedUiCard': { GeneratedUiCard: 'GeneratedUiCard' }, './ResponseMark': { ResponseMark: 'ResponseMark' } }
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.props.children.flat(Infinity).flatMap(nodes)] }
function texts(tree) { return !tree || typeof tree !== 'object' ? String(tree ?? '') : tree.props.children.flat(Infinity).map(texts).join(' ') }

test('chat sheets are opaque and tall without changing legacy glass sheets; empty content is safe', () => {
  const animated = { Value: class {}, add: () => 0, View: 'AnimatedView' }
  const rn = new Proxy({ ...native, Animated: animated, PanResponder: { create: () => ({ panHandlers: {} }) } }, { get: (target, key) => target[key] ?? key })
  const { BottomSheet } = load('components/ui/AppChrome.tsx', { ...ui, react: { ...react, useEffect() {} }, 'react-native': rn, '../../contexts/DrawerContext': { useDrawer: () => ({}) }, './GlassSurface': { GlassSurface: 'GlassSurface' } })
  const props = { theme: { surface: '#fff', glassBg: 'rgba(255,255,255,0.5)' }, title: 'Model', visible: true, onClose() {}, children: null }
  const solid = nodes(BottomSheet({ ...props, solid: true, tall: true }))
  assert.equal(solid.filter(node => node.type === 'GlassSurface').length, 0)
  assert.ok(solid.some(node => node.type === 'AnimatedView' && node.props.style.some(style => style?.backgroundColor === '#fff' && style.maxHeight === '92%')))
  const legacy = nodes(BottomSheet(props))
  assert.equal(legacy.filter(node => node.type === 'GlassSurface').length, 1)
  assert.ok(legacy.some(node => node.type === 'AnimatedView' && node.props.style.some(style => style?.backgroundColor === props.theme.glassBg && style.maxHeight === '78%')))
})

test('model ordering follows shared web quality rather than names or provider alphabet', () => {
  const { modelSections, sortChatModels, resolveAutoModel } = load('lib/chatModels.ts')
  const models = [{ id: 'openai/gpt-5.4-mini', name: 'A', provider: 'openai' }, { id: 'claude-sonnet-4-6', name: 'B', provider: 'anthropic' }, { id: 'gemini-3.1-pro-preview', name: 'Z', provider: 'google' }, { id: 'anthropic/claude-opus-4.7', name: 'Y', provider: 'anthropic' }]
  assert.deepEqual(clean(sortChatModels(models).map(model => model.id)), ['anthropic/claude-opus-4.7', 'gemini-3.1-pro-preview', 'claude-sonnet-4-6', 'openai/gpt-5.4-mini'])
  const sections = modelSections(models, ['claude-sonnet-4-6'])
  assert.deepEqual(clean(sections.map(section => section.label)), ['Favorites', 'Anthropic', 'Google', 'OpenAI'])
  assert.equal(sections[1].models.length, 2)
  assert.equal(modelSections(models, [], 'nothing').length, 0)
  assert.equal(modelSections([], [], '').length, 0)
  assert.equal(modelSections(models, [], 'google')[0].models.length, 1)
  assert.equal(resolveAutoModel(models, 'claude-sonnet-4-6').id, 'claude-sonnet-4-6')
  assert.equal(resolveAutoModel(models).id, 'anthropic/claude-opus-4.7')
  assert.equal(resolveAutoModel([], 'missing'), undefined)
})

test('picker pins Auto, exposes mode tabs, supported chips only and independent favorite actions', () => {
  const { ModelPicker } = load('components/chat/ModelPicker.tsx', ui)
  const calls = [], props = { theme: {}, models: [{ id: 'm', name: 'Plain', provider: 'openai' }], favoriteIds: [], onFavorite: id => calls.push(id), onSelect: (...args) => calls.push(args), onAuto: () => calls.push('auto') }
  const tree = ModelPicker(props), all = nodes(tree)
  assert.equal(all.filter(node => node.props.accessibilityRole === 'tab').length, 3)
  assert.equal(all.filter(node => ['Vision', 'Reasoning'].includes(node.props.accessibilityLabel)).length, 0)
  all.find(node => node.props.accessibilityLabel === 'Auto').props.onPress()
  all.find(node => node.props.accessibilityLabel === 'Favorite Plain').props.onPress()
  all.find(node => node.props.accessibilityLabel === 'Plain').props.onPress()
  assert.deepEqual(calls, ['auto', 'm', ['text', 'm']])
  const capable = nodes(ModelPicker({ ...props, models: [{ ...props.models[0], supportsVision: true, supportsReasoning: true }] }))
  assert.equal(capable.filter(node => ['Vision', 'Reasoning'].includes(node.props.accessibilityLabel)).length, 2)
  assert.match(texts(ModelPicker({ ...props, mode: 'image' })), /No models available/)
  assert.match(texts(ModelPicker({ ...props, mode: 'video' })), /No models available/)
})

test('favorites tolerate corrupt/empty storage and discard non-string values', () => {
  const { parseFavoriteModels } = load('hooks/useFavoriteModels.ts', { react, '@react-native-async-storage/async-storage': {} })
  for (const value of [null, '', 'bad', '{}', 'null']) assert.deepEqual(clean(parseFavoriteModels(value)), [])
  assert.deepEqual(clean(parseFavoriteModels('["a",12,"a","b"]')), ['a', 'b'])
})

test('favorites queued before storage loads preserve saved values and stale reads cannot overwrite them', async () => {
  let state, finishRead
  let reads = 0
  const effects = [], writes = []
  const storage = { getItem: () => ++reads === 1 ? new Promise(resolve => { finishRead = resolve }) : Promise.resolve('["saved"]'), setItem: async (key, value) => { writes.push([key, value]) } }
  const { useFavoriteModels } = load('hooks/useFavoriteModels.ts', { react: { useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: value => ({ current: value }), useState: value => { state = value; return [value, next => { state = next }] } }, '@react-native-async-storage/async-storage': { __esModule: true, default: storage } })
  const hook = useFavoriteModels('viewer')
  effects[0]()
  hook.toggleFavorite('new')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes, [['overlay:favorite-models:v2:viewer', '["saved","new"]']])
  finishRead('["saved"]')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(clean(state.ids), ['saved', 'new'])
})

test('personal Convex submit preserves exact typed payload, nonce, scope and backend failures', async () => {
  let workspace = 'ws', failure, result = { conversationId: 'c', userMessageId: 'u' }
  const calls = [], watches = []
  const service = load('services/personalChatService.ts', { './appApi': { getRequestWorkspaceId: () => workspace }, './convexClient': { api: { chat: { personal: { submit: 'submit', getExecution: 'execution' } } }, convexWorkspaceId: () => workspace, mutateConvex: async (ref, args) => { calls.push([ref, clean(args)]); if (failure) throw failure; return result }, subscribeConvex: (ref, args, value, error) => { const watch = { ref, args, value, error, stopped: false }; watches.push(watch); return () => { watch.stopped = true } } } })
  const turn = { conversationId: 'c', turnId: 'stable', modelId: 'model', mode: 'act', contentType: 'text', parts: [{ type: 'text', text: 'Hello' }], replyToTurnId: 'prior', replySnippet: 'Reply' }
  assert.equal((await service.submitPersonalTurn(turn)).conversationId, 'c')
  assert.deepEqual(calls[0], ['submit', { ...turn, workspaceId: 'ws' }])
  failure = new Error('denied'); await assert.rejects(service.submitPersonalTurn(turn), /denied/)
  workspace = 'other'; await assert.rejects(service.submitPersonalTurn(turn, 'ws'), /Workspace changed/)
  const values = [], errors = [], stop = service.watchPersonalExecution('ws', 'c', value => values.push(value), error => errors.push(error))
  watches[0].value({ run: null }); watches[0].value({ run: { id: 'run' } }); watches[0].error('offline'); stop()
  assert.deepEqual(clean(watches[0].args), { workspaceId: 'ws', conversationId: 'c' })
  assert.deepEqual(clean(values), [null, { id: 'run' }]); assert.deepEqual(errors, ['offline']); assert.equal(watches[0].stopped, true)
})

test('personal submit precedes HTTP act orchestration; temporary mode skips durable writes', async () => {
  const calls = []
  let failure
  const ai = load('services/aiService.ts', { '@react-native-async-storage/async-storage': {}, './appConfig': { AUTH_BASE_URL: 'https://isolated.invalid' }, './bootstrapService': { getAppBootstrap: async () => ({ chatModels: [] }) }, './convexClient': { convexWorkspaceId: () => 'ws' }, './personalChatService': { submitPersonalTurn: async (args, ws, signal) => { calls.push(['submit', clean(args), ws, signal]); if (failure) throw failure; return { conversationId: 'canonical' } } }, './appApi': { getRequestWorkspaceId: () => 'ws', appXhrStreamSse: async function* (url, options) { calls.push(['http', url, clean(options)]); yield { type: 'text-delta', delta: 'Hello' } } } })
  const collect = async options => { const chunks = []; for await (const chunk of ai.chatStream('model', [{ role: 'user', content: 'Prompt', replyToTurnId: 'prior' }], options)) chunks.push(chunk); return chunks }
  const owner = new AbortController()
  const chunks = await collect({ turnId: 'nonce', conversationClientId: 'draft', indexedFileNames: ['file'], signal: owner.signal })
  assert.deepEqual(calls.map(call => call[0]), ['submit', 'http'])
  assert.equal(calls[0][1].turnId, 'nonce'); assert.equal(calls[0][1].parts[0].text, 'Prompt'); assert.equal(calls[0][1].replyToTurnId, 'prior')
  assert.equal(calls[0][3], owner.signal)
  assert.equal(calls[1][2].json.conversationId, 'canonical'); assert.equal(calls[1][2].headers['x-overlay-workspace-id'], 'ws')
  assert.equal(chunks[0].metadata.conversationId, 'canonical')
  calls.length = 0; await collect({ turnId: 'temp', temporaryChat: true }); assert.deepEqual(calls.map(call => call[0]), ['http'])
  calls.length = 0; failure = new Error('offline'); assert.equal((await collect({ turnId: 'nonce' })).at(-1).type, 'error'); assert.deepEqual(calls.map(call => call[0]), ['submit'])
  calls.length = 0; assert.equal((await collect({})).at(-1).type, 'error'); assert.equal(calls.length, 0)
})

test('chatStream logs only a fixed diagnostic for transport failures', async () => {
  const logs = []
  const sentinel = 'Bearer secret-sentinel backend-body-sentinel'
  const service = load('services/aiService.ts', {
    '@react-native-async-storage/async-storage': {},
    './appConfig': { AUTH_BASE_URL: 'https://isolated.invalid' },
    './bootstrapService': {},
    '../lib/chatModels': {},
    './convexClient': { convexWorkspaceId: () => 'ws' },
    './personalChatService': { submitPersonalTurn: async () => ({ conversationId: 'unused' }) },
    './appApi': {
      getRequestWorkspaceId: () => 'ws',
      appXhrStreamSse: async function* () { throw new Error(sentinel) },
    },
  }, { console: { log() {}, error: (...args) => logs.push(args) } })
  const chunks = []
  for await (const chunk of service.chatStream('model', [{ role: 'user', content: 'Hello' }], { temporaryChat: true })) chunks.push(chunk)
  assert.equal(chunks.at(-1).type, 'error')
  assert.deepEqual(logs, [['[aiService] act failed']])
  assert.equal(JSON.stringify(logs).includes(sentinel), false)
})

test('stream blocks stay sequential, update tools in place and hold incomplete Markdown', () => {
  const { appendPersonalBlock, completePersonalBlocks } = load('lib/personalStream.ts')
  let blocks = []
  for (const chunk of [{ type: 'text', content: 'Intro.\n\nTail' }, { type: 'tool', toolCallId: 't', toolName: 'search', state: 'input-available' }, { type: 'text', content: 'After.\n\n```js\nopen' }, { type: 'tool', toolCallId: 't', state: 'output-available', output: 'done' }]) blocks = appendPersonalBlock(blocks, chunk)
  assert.deepEqual(clean(blocks.map(block => block.kind)), ['text', 'tool', 'text'])
  assert.equal(blocks[1].name, 'search'); assert.equal(blocks[1].state, 'output-available')
  assert.equal(completePersonalBlocks(blocks, true)[2].text, 'After.\n\n')
  assert.match(completePersonalBlocks(blocks, false)[2].text, /```js/)
})

test('assistant shows exactly one bottom mark while active, none when settled or errored', () => {
  const { MessageBubble } = load('components/chat/MessageBubble.tsx', ui)
  for (const blocks of [undefined, [], [{ kind: 'text', text: 'First.\n\nPartial' }]]) {
    const message = { id: 'a', role: 'assistant', content: 'First.\n\nPartial', blocks, responses: [{ content: 'First.\n\nPartial', isLoading: true }] }
    const active = nodes(MessageBubble({ message, theme: {} }))
    assert.equal(active.filter(node => node.type === 'ResponseMark').length, 1)
    assert.equal(active.some(node => node.props.text === 'First.\n\nPartial'), false)
    const settled = nodes(MessageBubble({ message: { ...message, responses: [{ content: 'Done', isLoading: false }] }, theme: {} }))
    assert.equal(settled.filter(node => node.type === 'ResponseMark').length, 0)
  }
  const source = fs.readFileSync(path.join(root, 'components/chat/MessageBubble.tsx'), 'utf8')
  assert.doesNotMatch(source, /Thinking…|OVERLAY_LOGO|withRepeat|StreamingCursor/)
})

test('message action sheet keeps edit/delete own only; deleted and failed states are safe', () => {
  const { RoomMessageActions } = load('components/chat/RoomMessageActions.tsx', ui)
  const calls = [], props = { theme: {}, mine: false, onReact: value => calls.push(value), onAction: value => calls.push(value) }
  const other = RoomMessageActions(props)
  assert.doesNotMatch(texts(other), /Edit message|Delete message/)
  assert.match(texts(other), /Reply in thread.*Pin message.*Save message.*Copy text/)
  const own = RoomMessageActions({ ...props, mine: true })
  assert.match(texts(own), /Edit message.*Delete message/)
  nodes(own).find(node => node.props.accessibilityLabel === 'React 👍').props.onPress(); assert.deepEqual(calls, ['👍'])
  assert.equal(nodes(RoomMessageActions({ ...props, deleted: true })).filter(node => node.props.accessibilityRole === 'button').length, 0)
  assert.match(texts(RoomMessageActions({ ...props, failed: true })), /Retry send/)
  assert.match(texts(RoomMessageActions(props)), /Reply in thread/)
  const source = fs.readFileSync(path.join(root, 'components/chat/RoomScreen.tsx'), 'utf8')
  assert.match(source, /channelComposerPlaceholder\(state.title\)/)
  const { channelComposerPlaceholder } = load('lib/roomMessages.ts')
  assert.equal(channelComposerPlaceholder('product'), 'Message #product')
  assert.equal(channelComposerPlaceholder('#product'), 'Message #product')
  assert.equal(channelComposerPlaceholder(''), 'Message #…')
})
