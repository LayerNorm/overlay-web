/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const clean = value => JSON.parse(JSON.stringify(value))
function loadCode(source, mocks = {}, globals = {}) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { Error, Date, ...globals })(id => {
    assert.ok(Object.hasOwn(mocks, id), 'Unexpected import ' + id)
    return mocks[id]
  }, loaded, loaded.exports)
  return loaded.exports
}
function callback(name, globals) {
  const file = ts.createSourceFile('ChatScreen.tsx', fs.readFileSync(path.join(root, 'components/chat/ChatScreen.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) expression = node.initializer.arguments[0].getText()
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(expression, `Missing ${name} callback`)
  return loadCode(`exports.callback = ${expression}`, {}, globals).callback
}
function storage() {
  const calls = []
  let failure = false
  const service = loadCode(fs.readFileSync(path.join(root, 'services/chatStorage.ts'), 'utf8'), {
    '@react-native-async-storage/async-storage': {}, '@overlay/chat-core': {},
    './appApi': {}, '../../src/shared/chat/public-stream-projection': {}, './convexPagination': { queryAllPages: async () => [] }, '../lib/agentThread': {},
    './chatTypes': { generateChatId: () => 'chat-generated' },
    './convexClient': {
      api: { chat: { personal: { rename: 'rename', setPreferences: 'preferences', create: 'create', getSummary: 'summary', getMessages: 'messages' } } },
      convexWorkspaceId: () => 'workspace',
      async mutateConvex(reference, args) {
        calls.push([reference, clean(args)])
        if (failure) throw new Error('Backend unavailable')
        assert.equal(args.conversationId?.startsWith('chat-') ?? false, false, 'Draft ID must never reach a Convex ID argument')
        return reference === 'create' ? 'durable-conversation' : null
      },
      async queryConvex(reference) {
        if (reference === 'summary') return { _id: 'durable-conversation', title: 'New chat', askModelIds: ['picked'], actModelId: 'picked', lastMode: 'act', createdAt: 1, lastModified: 1 }
        return { page: [] }
      },
    },
  })
  return { service, calls, fail: () => { failure = true } }
}

test('new-chat model selection stays local and never renames or sets preferences using a draft ID', async () => {
  const backend = storage(), events = []
  const chatRef = { current: { id: 'chat-local-draft', title: 'New chat', modelId: 'old', messages: [] } }
  const globals = {
    chatRef, selectedModel: { id: 'old' }, setChatTitle: title => events.push(['title', title]),
    saveChat: backend.service.saveChat, refreshHistory: async () => events.push(['history']),
  }
  const syncConversationMeta = callback('syncConversationMeta', globals)
  const select = callback('handleModelSelect', {
    syncConversationMeta, setSelectedModel: model => events.push(['selected', model.id]),
    setModelPickerVisible: visible => events.push(['picker', visible]), setLastSelectedModelId: async id => events.push(['last-model', id]),
  })
  await select({ id: 'picked' })
  assert.equal(chatRef.current.modelId, 'picked')
  assert.equal(chatRef.current.actModelId, 'picked')
  assert.deepEqual(clean(chatRef.current.askModelIds), ['picked'])
  assert.deepEqual(backend.calls, [])
  assert.equal(events.some(event => event[0] === 'history'), false)
  assert.ok(events.some(event => event[0] === 'selected' && event[1] === 'picked'))
})

test('first persistence carries the selected model and later preference writes use the durable conversation ID', async () => {
  const backend = storage()
  const draft = { id: 'chat-local-draft', title: 'New chat', modelId: 'picked', actModelId: 'picked', askModelIds: ['picked'], messages: [] }
  await backend.service.saveChat(draft)
  assert.deepEqual(backend.calls, [])
  const created = await backend.service.createNewChat(draft.modelId, { clientId: draft.id, title: draft.title })
  assert.equal(backend.calls[0][0], 'create')
  assert.equal(backend.calls[0][1].actModelId, 'picked')
  assert.equal(backend.calls[0][1].clientId, draft.id)
  await backend.service.saveChat({ ...draft, id: created.id, clientId: draft.id })
  assert.equal(backend.calls.at(-1)[0], 'preferences')
  assert.equal(backend.calls.at(-1)[1].conversationId, 'durable-conversation')
  assert.equal(backend.calls.at(-1)[1].actModelId, 'picked')
})

test('absent chats do nothing and failed preference writes on durable chats still reject', async () => {
  const sync = callback('syncConversationMeta', { chatRef: { current: null } })
  await sync({ modelId: 'picked' })
  const backend = storage()
  backend.fail()
  await assert.rejects(backend.service.saveChat({ id: 'durable', title: 'Existing', modelId: 'picked' }), /Backend unavailable/)
})
