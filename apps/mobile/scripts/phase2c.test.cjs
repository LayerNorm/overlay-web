/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const clean = value => JSON.parse(JSON.stringify(value))

function load(file, dependencies = {}, globals = {}) {
  const filename = path.resolve(root, file)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.React } })
  const loaded = { exports: {} }
  const requireMock = id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id]
    if (id === '@overlay/chat-core') return load('../packages/overlay-chat-core/src/visual-sequence.ts')
    assert.ok(id.startsWith('.'), 'Unexpected dependency: ' + id)
    const base = path.resolve(path.dirname(filename), id)
    return load(fs.existsSync(base) && fs.statSync(base).isFile() ? base : base + '.ts', dependencies, globals)
  }
  vm.runInNewContext('(function(require,module,exports){' + outputText + '\n})', { ...globals })(requireMock, loaded, loaded.exports)
  return loaded.exports
}

function service() {
  const watches = [], calls = []
  let workspace = 'ws', failure, result = { success: true, ok: true }, failQuery
  const api = { agents: { directory: { get: 'get' }, threads: { bundle: 'bundle', activity: 'activity', setArchived: 'archive', remove: 'remove' } }, files: { browse: { forConversation: 'files' } }, computers: { browse: { list: 'computers' } }, collaboration: { rooms: { compatibility: 'compatibility', messages: 'messages', activePublicStreams: 'streams' } } }
  const adapter = load('services/agentThreadService.ts', {
    './convexClient': {
      api,
      subscribeConvex(query, args, value, error) { if (query === failQuery) throw new Error('subscription failed'); const watch = { query, args: clean(args), value, error, stopped: false }; watches.push(watch); return () => { watch.stopped = true } },
      async mutateConvex(query, args) { calls.push([query, clean(args)]); if (failure) throw failure; return result },
    },
    './appApi': { getRequestWorkspaceId: () => workspace },
    './overlayClient': { mobileOverlayAppClient: { conversations: Object.fromEntries(['addMessage', 'stopResponse', 'submitRunApproval', 'submitRunInput', 'resolveRemoteRequest'].map(name => [name, async (...args) => { calls.push([name, ...clean(args)]); if (failure) throw failure; return result }])) } },
  })
  return { adapter, watches, calls, workspace: value => { workspace = value }, result: value => { result = value }, fail: value => { failure = value }, failQuery: value => { failQuery = value } }
}

test('agent bundle and activity are typed Convex subscriptions with null and error propagation', () => {
  const s = service(), values = [], errors = []
  const stop = s.adapter.watchAgentThreads('ws', 'agent', value => values.push(value), value => values.push(value), reason => errors.push(reason))
  assert.equal(s.watches.map(watch => watch.query).join(','), 'bundle,activity')
  assert.deepEqual(s.watches[0].args, { workspaceId: 'ws', agentId: 'agent' })
  s.watches[0].value(null); s.watches[1].value([]); s.watches[0].error('denied')
  assert.deepEqual(values, [null, []]); assert.deepEqual(errors, ['denied'])
  stop(); assert.ok(s.watches.every(watch => watch.stopped))
  const failing = service(); failing.failQuery('activity')
  assert.throws(() => failing.adapter.watchAgentThreads('ws', 'a', () => {}, () => {}, () => {}), /subscription failed/)
  assert.equal(failing.watches[0].stopped, true)
})

test('directory, compatibility, files and computer subscriptions preserve exact scopes', () => {
  const s = service(), values = []
  const stops = [s.adapter.watchAgent('ws', 'a', value => values.push(value), () => {}), s.adapter.watchThreadCompatibility('ws', 'c', () => {}, () => {}), s.adapter.watchAgentComputers('ws', () => {}, () => {}), s.adapter.watchAgentFiles('ws', 'c', () => {}, () => {})]
  assert.deepEqual(s.watches.map(watch => watch.args), [{ workspaceId: 'ws', agentId: 'a' }, { workspaceId: 'ws', conversationId: 'c' }, { workspaceId: 'ws' }, { workspaceId: 'ws', conversationId: 'c' }])
  s.watches[0].value(null); assert.deepEqual(values, [null]); stops.forEach(stop => stop()); assert.ok(s.watches.every(watch => watch.stopped))
})

test('agent message pages subscribe only active messages to public streams and release old streams', () => {
  const s = service(), values = [], errors = []
  const stop = s.adapter.watchAgentMessages('ws', 'c', null, (rows, cursor) => values.push([rows, cursor]), error => errors.push(error))
  assert.deepEqual(s.watches[0].args, { workspaceId: 'ws', conversationId: 'c', paginationOpts: { numItems: 50, cursor: null } })
  s.watches[0].value({ page: [], isDone: true, continueCursor: 'unused' }); assert.deepEqual(clean(values.pop()), [[], null])
  const row = { id: 'reply', authorKind: 'agent', content: '', status: 'generating', parts: [] }
  s.watches[0].value({ page: [row], isDone: false, continueCursor: 'next' })
  assert.deepEqual(s.watches[1].args.messageIds, ['reply'])
  s.watches[1].value([{ assistantMessageId: 'reply', runId: 'run', executionGeneration: 1, receiptId: 'receipt', invocation: 1, sequence: 1, text: 'Complete paragraph.\n\n', status: 'streaming' }])
  assert.match(values.at(-1)[0][0].content, /Complete paragraph/); assert.equal(values.at(-1)[1], 'next')
  s.watches[0].value({ page: [{ ...row, status: 'completed', content: 'Done' }], isDone: true })
  assert.equal(s.watches[1].stopped, true)
  s.watches[0].error('offline'); assert.deepEqual(errors, ['offline']); stop(); assert.ok(s.watches.every(watch => watch.stopped))
})

test('archive/remove use Convex mutations and preserve backend errors', async () => {
  const s = service()
  await s.adapter.archiveAgentThread('ws', 'a', 'c', true); await s.adapter.removeAgentThread('ws', 'a', 'c')
  assert.deepEqual(s.calls, [['archive', { workspaceId: 'ws', agentId: 'a', conversationId: 'c', archived: true }], ['remove', { workspaceId: 'ws', agentId: 'a', conversationId: 'c' }]])
  s.fail(new Error('denied')); await assert.rejects(s.adapter.archiveAgentThread('ws', 'a', 'c', false), /denied/)
  const source = fs.readFileSync(path.join(root, 'services/shellService.ts'), 'utf8')
  assert.match(source, /api\.agents\.threads\.create/); assert.match(source, /api\.agents\.threads\.resolveMain/)
})

test('send and stop preserve web HTTP commands, stable nonce, empty and failure behavior', async () => {
  const s = service()
  await s.adapter.sendAgentMessage('ws', 'c', ' hello ', 'nonce'); await s.adapter.stopAgentReply('ws', 'c', 'reply')
  assert.deepEqual(s.calls[0], ['addMessage', { conversationId: 'c', content: 'hello', turnId: 'nonce', clientNonce: 'nonce', role: 'user', mode: 'act', contentType: 'text', mentionedPrincipalIds: [], memoryEnabled: true }, { headers: { 'x-overlay-workspace-id': 'ws' } }])
  assert.deepEqual(s.calls[1][1], { conversationId: 'c', messageId: 'reply' })
  await assert.rejects(s.adapter.sendAgentMessage('ws', 'c', ' ', 'nonce'), /Write a message/)
  s.result({ success: false, ok: false }); await assert.rejects(s.adapter.sendAgentMessage('ws', 'c', 'hello', 'nonce'), /Could not send/); await assert.rejects(s.adapter.stopAgentReply('ws', 'c', 'reply'), /may still be running/)
  s.workspace('changed'); await assert.rejects(s.adapter.sendAgentMessage('ws', 'c', 'hello', 'nonce'), /Workspace changed/)
})

test('approval, denial and ask answers enforce request owner/conversation and web run payloads', async () => {
  const s = service(), request = { conversationId: 'c', userId: 'u', runId: 'run', token: 'request' }
  await s.adapter.decideAgentApproval('ws', 'c', 'u', request, true); await s.adapter.decideAgentApproval('ws', 'c', 'u', request, false); await s.adapter.answerAgentQuestion('ws', 'c', 'u', request, ' answer ')
  assert.deepEqual(s.calls.map(call => call[1]), [{ conversationId: 'c', agentRunId: 'run', token: 'request', approved: true }, { conversationId: 'c', agentRunId: 'run', token: 'request', approved: false }, { conversationId: 'c', agentRunId: 'run', token: 'request', text: 'answer' }])
  await assert.rejects(s.adapter.decideAgentApproval('ws', 'c', 'other', request, true), /person who started/)
  await assert.rejects(s.adapter.answerAgentQuestion('ws', 'other', 'u', request, 'answer'), /person who started/)
  await assert.rejects(s.adapter.answerAgentQuestion('ws', 'c', 'u', request, ' '), /Write an answer/)
  s.result({ success: false }); await assert.rejects(s.adapter.decideAgentApproval('ws', 'c', 'u', request, false), /Could not send/); await assert.rejects(s.adapter.answerAgentQuestion('ws', 'c', 'u', request, 'answer'), /Could not send/)
  await s.adapter.resolveAgentRemoteRequest('ws', 'c', 'run', 'key', 'accept', { required: false })
  assert.deepEqual(s.calls.at(-1), ['resolveRemoteRequest', { workspaceId: 'ws', conversationId: 'c', runId: 'run', requestKey: 'key', decision: 'accept', response: { required: false } }])
  s.workspace('changed'); assert.throws(() => s.adapter.resolveAgentRemoteRequest('ws', 'c', 'run', 'key', 'deny'), /Workspace changed/)
})

test('markdown streaming emits complete paragraphs/fences and terminal tails without character churn', () => {
  const { completeMarkdown } = load('lib/agentThread.ts')
  assert.equal(completeMarkdown('', true), '')
  assert.equal(completeMarkdown('Partial **bold', true), '')
  assert.equal(completeMarkdown('# Heading\n\nFirst **bold** paragraph.\n\npartial', true), '# Heading\n\nFirst **bold** paragraph.\n\n')
  assert.equal(completeMarkdown('Intro\n\n```ts\nconst x = 1\n\n', true), 'Intro\n\n')
  assert.equal(completeMarkdown('```ts\nconst x = 1\n```\npartial', true), '```ts\nconst x = 1\n```\n')
  assert.equal(completeMarkdown('~~~\ncode\n~~~\n', true), '~~~\ncode\n~~~\n')
  assert.equal(completeMarkdown('tail', false), 'tail')
})

test('agent projection preserves sequential text/tool/reasoning and holds only the live tail', () => {
  const { agentMessageProjection } = load('lib/agentThread.ts')
  const message = { content: '', status: 'generating', parts: [{ type: 'text', text: 'Before tool' }, { type: 'tool-search', toolCallId: 'tool', state: 'output-available', input: {}, output: 'done' }, { type: 'reasoning', text: 'Reasoning' }, { type: 'text', text: 'Complete.\n\npartial' }] }
  const projection = agentMessageProjection(message)
  assert.equal(projection.blocks.map(block => block.kind).join(','), 'text,tool,reasoning,text')
  assert.equal(projection.blocks[0].text, 'Before tool'); assert.equal(projection.blocks.at(-1).text, 'Complete.')
  const ended = agentMessageProjection({ content: '', status: 'generating', parts: [{ type: 'text', text: 'First.\n\nSecond.\n\n' }] })
  assert.match(ended.blocks[0].text, /Second\.$/)
  const pending = agentMessageProjection({ ...message, parts: [{ type: 'text', text: 'Before' }, { type: 'data-remote-agent-request', data: { state: 'pending', requestKey: 'key' } }, { type: 'text', text: 'Hidden' }] })
  assert.equal(pending.remoteRequest.requestKey, 'key'); assert.equal(pending.blocks.length, 1)
  assert.equal(agentMessageProjection({ content: '', parts: [] }).blocks.length, 0)
})

test('eye motion is periodic, eyes-only, and reduced-motion/settled replies release timers', async () => {
  const { agentEyePosition } = load('lib/agentEyes.ts')
  assert.equal(agentEyePosition(0), 0); assert.equal(agentEyePosition(3500), 0); assert.ok(agentEyePosition(1100) < -6); assert.ok(agentEyePosition(2400) > 6)
  const states = [], effects = [], timers = new Set(); let stateIndex = 0, effectIndex = 0, change, removed = false
  const hook = load('hooks/useAgentEyes.ts', {
    react: { useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value }] }, useEffect(fn, deps) { const index = effectIndex++, old = effects[index]; if (!old || deps.some((dep, i) => dep !== old.deps[i])) { old?.cleanup?.(); effects[index] = { deps, cleanup: fn() } } } },
    'react-native': { AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener(_, fn) { change = fn; return { remove() { removed = true } } } } },
  }, { Date, setInterval: fn => { timers.add(fn); return fn }, clearInterval: timer => timers.delete(timer) })
  const render = (working, reduced) => { stateIndex = 0; effectIndex = 0; return hook.useAgentEyes(working, reduced) }
  assert.deepEqual(clean(render(true)), { x: 0, y: 0 }); assert.equal(timers.size, 0)
  await Promise.resolve(); render(true); assert.equal(timers.size, 1)
  change(true); assert.deepEqual(clean(render(true)), { x: 0, y: 0 }); assert.equal(timers.size, 0)
  change(false); render(true, true); assert.equal(timers.size, 0)
  render(true, false); assert.equal(timers.size, 1); render(false); assert.equal(timers.size, 0)
  effects.forEach(effect => effect.cleanup?.()); assert.equal(removed, true)
})

test('external adapters allow Claude Code/Codex only and default identity uses isDefault', () => {
  const api = load('lib/agentByo.ts', { './agentToolGroups': {} })
  const adapters = api.acpAdaptersForEnvironment({ capabilities: { adapters: ['codex', 'claude-code', 'hermes', 'custom-acp'].map(id => ({ id, protocol: 'acp' })) } })
  assert.equal(adapters.map(adapter => adapter.id).join(','), 'codex,claude-code')
  assert.equal(api.isDefaultMasterAgent({ name: 'Renamed', isDefault: true }), true)
  assert.equal(api.isDefaultMasterAgent({ name: 'Overlay', isDefault: false }), false)
})

test('agent editor reads are Convex projections, enum narrowing fails closed, and writes retain web endpoints', async () => {
  const contract = { ...load('../packages/overlay-workspace-contracts/src/types.ts'), ...load('../packages/overlay-workspace-contracts/src/connected-agents.ts') }
  let result, failure
  const calls = []
  const api = load('services/agentsService.ts', {
    '@overlay/workspace-contracts': contract,
    './appApi': {},
    './convexClient': { api: { agents: { directory: { list: 'list', get: 'get' }, environmentsBrowse: { list: 'environments', bindings: 'bindings' } }, computers: { browse: { list: 'computers' } } }, async queryConvex(reference, args) { calls.push([reference, clean(args)]); if (failure) throw failure; return result } },
    './overlayClient': { mobileOverlayAppClient: { agents: { async create(workspace, input) { calls.push(['create', workspace, clean(input)]); return { agent: input } }, async update(workspace, id, input) { calls.push(['update', workspace, id, clean(input)]); if (failure) throw failure; return { agent: input } } } } },
  })
  result = { agents: [], canCreate: false }; assert.equal((await api.listAgents('ws')).agents.length, 0)
  result = { id: 'agent', name: 'Scout', avatarShape: 'unknown', canEdit: false }; assert.equal((await api.getAgent('ws', 'agent')).avatarShape, 'circle'); assert.equal((await api.getAgent('ws', 'agent')).canEdit, false)
  result = [{ status: 'online', kind: 'local', capabilities: {} }]; assert.equal((await api.listAgentEnvironments('ws'))[0].status, 'online')
  result = [{ status: 'unsupported', kind: 'local' }]; await assert.rejects(api.listAgentEnvironments('ws'), /not supported/)
  result = [{ protocolAdapter: 'acp' }]; assert.equal((await api.listAgentBindings('ws', 'agent'))[0].protocolAdapter, 'acp')
  result = [{ protocolAdapter: 'unsupported' }]; await assert.rejects(api.listAgentBindings('ws'), /not supported/)
  result = null; await assert.rejects(api.getAgent('ws', 'missing'), /unavailable/); await assert.rejects(api.listAgents('ws'), /unavailable/); assert.equal((await api.listAgentEnvironments('ws')).length, 0)
  await api.createAgent('ws', { name: 'Scout' }); await api.updateAgent('ws', 'agent', { name: 'Edited' }); assert.deepEqual(calls.slice(-2), [['create', 'ws', { name: 'Scout' }], ['update', 'ws', 'agent', { name: 'Edited' }]])
  failure = new Error('denied'); await assert.rejects(api.getAgent('ws', 'agent'), /denied/); await assert.rejects(api.updateAgent('ws', 'agent', {}), /denied/)
})

test('Computer tab renders only status and Open on web with accurate loading/empty/error states', () => {
  const element = (type, props, ...children) => ({ type, props, children })
  const dependencies = {
    react: { default: { createElement: element }, memo: fn => fn, useRef: value => ({ current: value }), useState: () => ['Computer', () => {}] },
    'react-native': Object.fromEntries(['View', 'Pressable', 'ScrollView', 'TextInput', 'Switch', 'KeyboardAvoidingView'].map(key => [key, key])),
    'lucide-react-native': {}, '../shell/primitives': { T: 'T', Button: 'Button', IconButton: 'IconButton' }, '../shell/AgentAvatar': {}, '../work/WorkMarkdown': {},
  }
  const { AgentDetailsView } = load('components/agents/AgentThreadViews.tsx', dependencies)
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.children)] : []
  const props = { agent: { name: 'Overlay' }, theme: {}, dark: false }
  for (const [computer, computerError, expected] of [[undefined, false, 'Loading computer status…'], [null, false, 'No computer connected'], [{ status: 'running' }, false, 'Computer running'], [null, true, 'Computer status unavailable']]) {
    const tree = nodes(AgentDetailsView({ ...props, computer, computerError }))
    assert.ok(tree.some(node => node.type === 'T' && node.children.includes(expected)))
    const buttons = tree.filter(node => node.type === 'Button'); assert.equal(buttons.length, 1); assert.deepEqual(buttons[0].children, ['Open on web'])
    assert.ok(!tree.some(node => ['WebView', 'Image', 'Video'].includes(node.type)))
  }
})
