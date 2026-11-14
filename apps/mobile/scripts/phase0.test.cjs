/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const loaded = { exports: {} }
  const requireMock = (id) => {
    if (id === '@overlay/api-client') return { createIdempotencyKey: () => 'search-request' }
    if (id === './filesService') return {}
    if (id === './settingsNativeService') return {}
    assert.ok(Object.hasOwn(dependencies, id), 'Unexpected dependency: ' + id)
    return dependencies[id]
  }
  vm.runInNewContext('(function(require, module, exports) {' + outputText + '\n})')(requireMock, loaded, loaded.exports)
  return loaded.exports
}

test('navigation has current scope, order and optional Extensions', () => {
  const { resolveNavDestinations } = load('lib/destinations.ts')
  const destinations = ['files', 'projects', 'knowledge', 'chat', 'agents', 'extensions', 'automations'].map((id) => ({ id }))
  const session = { capabilities: { chat: true, files: true }, isFeatureEnabled: () => true }
  assert.equal(resolveNavDestinations(destinations, session).map((item) => item.id).join(','), 'work,agents,chat,files,automations,extensions')
  session.isFeatureEnabled = (id) => id !== 'extensions'
  assert.equal(resolveNavDestinations(destinations, session).some((item) => item.id === 'extensions'), false)
})

test('empty and disabled navigation retain a usable Work placeholder', () => {
  const { resolveNavDestinations, isDestinationEnabled } = load('lib/destinations.ts')
  const session = { capabilities: { chat: false, files: false }, isFeatureEnabled: () => false }
  assert.equal(resolveNavDestinations([], session).map((item) => item.id).join(','), 'work')
  assert.equal(isDestinationEnabled('projects', session), false)
  assert.equal(isDestinationEnabled('unknown', session), false)
})

test('knowledge search uses the current POST contract for files and memories', async () => {
  const calls = []
  const response = { chunks: [{ sourceId: 'file-1', sourceKind: 'file', chunkIndex: 0, text: 'Roadmap', score: 1 }] }
  const api = load('services/knowledgeService.ts', { './appApi': { appJson: async (...args) => { calls.push(args); return response } } })
  assert.equal(await api.searchKnowledge(' roadmap ', 'file'), response)
  assert.equal(await api.searchKnowledge(' launch ', 'memory'), response)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['/api/v1/knowledge/search', { method: 'POST', headers: { 'Idempotency-Key': 'search-request' }, json: { query: 'roadmap', sourceKind: 'file' } }],
    ['/api/v1/knowledge/search', { method: 'POST', headers: { 'Idempotency-Key': 'search-request' }, json: { query: 'launch', sourceKind: 'memory' } }],
  ])
})

test('empty knowledge queries do not request; empty results and errors propagate', async () => {
  let requests = 0
  const emptyApi = load('services/knowledgeService.ts', { './appApi': { appJson: async () => { requests++; return { chunks: [] } } } })
  assert.equal((await emptyApi.searchKnowledge('  ', 'file')).chunks.length, 0)
  assert.equal(requests, 0)
  assert.equal((await emptyApi.searchKnowledge('no match', 'file')).chunks.length, 0)
  assert.equal(requests, 1)
  const error = new Error('HTTP 503')
  const failingApi = load('services/knowledgeService.ts', { './appApi': { appJson: async () => { throw error } } })
  await assert.rejects(failingApi.searchKnowledge('roadmap', 'memory'), (actual) => actual === error)
})

test('restored collaboration and search do not bring back retired HTTP endpoints', () => {
  const source = ['services/collaborationService.ts', 'services/searchService.ts', 'services/conversationActionsService.ts']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
  assert.doesNotMatch(source, /unavailable until Phase 1|Workspace search will be available/)
  assert.match(source, /api\.collaboration\.rooms\.setReaction/)
  assert.match(source, /api\.search\.browse\.mentions/)
})

test('Hermes is not offered by built-in or environment-advertised adapters', () => {
  const api = load('lib/agentByo.ts', { './agentToolGroups': {} })
  assert.equal(api.BUILT_IN_BYO_HARNESSES.map((item) => item.id).join(','), 'codex,claude-code')
  assert.equal(api.acpAdaptersForEnvironment({ capabilities: { adapters: [] } }).length, 0)
  const environment = { capabilities: { adapters: [{ protocol: 'acp', id: 'hermes' }, { protocol: 'acp', id: 'custom-acp' }] } }
  assert.equal(api.acpAdaptersForEnvironment(environment).length, 0)
})

test('retired routes and endpoint calls are absent', () => {
  for (const file of ['app/(tabs)/projects.tsx', 'app/knowledge-base/[id].tsx', 'services/projectsService.ts', 'services/knowledgeBasesService.ts']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file)
  }
  const sourceFiles = ['services/collaborationService.ts', 'services/searchService.ts', 'services/conversationActionsService.ts'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
  assert.doesNotMatch(sourceFiles, /\/api\/v1\/(?:search|mention-search|conversations\/notification-preferences)\b/)
  assert.doesNotMatch(sourceFiles, /\.conversations\.(?:notifications|reactions|setReaction|pins|setPinned|presence|updatePresence|savedMessages|setSaved|threadFollow|setThreadFollow|editCollaborativeMessage|deleteCollaborativeMessage|channels)\(/)
  for (const file of ['components/chat/MessageBubble.tsx', 'components/chat/RoomMessageItem.tsx', 'lib/chatTools.ts', 'services/aiService.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /browserUse|(?:case |=== )'browser'|id: 'browser'/, file)
  }
})
