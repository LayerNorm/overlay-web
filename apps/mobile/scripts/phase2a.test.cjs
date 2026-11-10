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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  })
  const loaded = { exports: {} }
  vm.runInNewContext('(function(require,module,exports){' + outputText + '\n})', { Error })(
    (id) => {
      assert.ok(Object.hasOwn(dependencies, id), 'Unexpected dependency: ' + id)
      return dependencies[id]
    },
    loaded,
    loaded.exports,
  )
  return loaded.exports
}

const entry = load('lib/mobileEntryState.ts').mobileEntryState
const extensions = load('lib/shellNavigation.ts').showShellExtensions
const unreadChats = load('lib/sidebarChats.ts').withUnreadActivity

test('Extensions requires an explicit enabled flag and its capability permission', () => {
  assert.equal(extensions(undefined, true), false)
  assert.equal(extensions(null, true), false)
  assert.equal(extensions([], true), false)
  assert.equal(extensions([{ id: 'agents', enabled: true }], true), false)
  assert.equal(extensions([{ id: 'extensions', enabled: false }], true), false)
  assert.equal(extensions([{ id: 'extensions', enabled: true }], false), false)
  assert.equal(extensions([{ id: 'extensions', enabled: true }], true), true)
})
const member = {
  boot: false,
  authLoading: false,
  authenticated: true,
  membershipsLoading: false,
  membershipError: null,
  membershipCount: 1,
}

test('entry opens existing memberships, and lets signed-out users reach sign-in', () => {
  assert.equal(entry(member), 'ready')
  assert.equal(
    entry({ ...member, authenticated: false, membershipCount: 0, membershipsLoading: true }),
    'ready',
  )
})
test('entry waits for real memberships, then shows the empty-membership gate', () => {
  assert.equal(entry({ ...member, membershipCount: 0, membershipsLoading: true }), 'boot')
  assert.equal(entry({ ...member, membershipCount: 0 }), 'workspace-required')
  assert.equal(entry({ ...member, boot: true }), 'boot')
  assert.equal(entry({ ...member, authLoading: true }), 'boot')
})
test('membership failures show retry, not the no-workspace gate', () => {
  assert.equal(
    entry({ ...member, membershipCount: 0, membershipError: 'Connection failed' }),
    'error',
  )
  assert.equal(entry({ ...member, membershipError: 'Switch failed' }), 'ready')
})

test('room badges track unread notification activity while personal chats retain canonical unread state', () => {
  const chats = [
    { id: 'personal', kind: 'personal', title: 'Chat', unread: true },
    { id: 'room', kind: 'channel', title: 'Room' },
  ]
  let rows = unreadChats(chats, [
    { conversationId: 'room' },
    { conversationId: 'room' },
    { conversationId: 'room', readAt: 123 },
    {},
  ])
  assert.equal(rows[0].unread, true)
  assert.equal(rows[1].unreadCount, 2)
  rows = unreadChats(chats, [])
  assert.equal(rows[1].unreadCount, 0)
  assert.equal(unreadChats([], [{ conversationId: 'unknown' }]).length, 0)
})

function shell() {
  const watches = []
  const mutations = []
  const api = {
    agents: {
      directory: { list: 'directory' },
      threads: { bundle: 'threads', activity: 'activity', create: 'create', resolveMain: 'main' },
    },
  }
  const service = load('services/shellService.ts', {
    './convexClient': {
      api,
      subscribeConvex: (reference, args, onValue, onError) => {
        const watch = { reference, args, onValue, onError, stopped: false }
        watches.push(watch)
        return () => {
          watch.stopped = true
        }
      },
      mutateConvex: (reference, args) => {
        mutations.push({ reference, args })
        return Promise.resolve({ conversationId: 'thread-1' })
      },
    },
  })
  return { service, watches, mutations }
}
test('agent directory subscribes to the selected workspace, handles empty/access loss and errors', () => {
  const { service, watches } = shell()
  const values = []
  const errors = []
  const stop = service.subscribeAgents(
    'workspace-1',
    (value) => values.push(value),
    (error) => errors.push(error),
  )
  assert.equal(watches[0].reference, 'directory')
  assert.equal(watches[0].args.workspaceId, 'workspace-1')
  watches[0].onValue({ agents: [{ id: 'agent-1', name: 'Renamed default', isDefault: true }] })
  watches[0].onValue({ agents: [] })
  watches[0].onValue(null)
  assert.equal(values[0][0].isDefault, true)
  assert.equal(values[1].length, 0)
  assert.equal(values[2].length, 0)
  const failure = new Error('Offline')
  watches[0].onError(failure)
  assert.equal(errors[0], failure)
  stop()
  assert.equal(watches[0].stopped, true)
})
test('thread list and statuses are live, omit archives, forward errors and unsubscribe together', () => {
  const { service, watches } = shell()
  const threads = []
  const activity = []
  const errors = []
  const stop = service.subscribeAgentThreads(
    'workspace-1',
    'agent-1',
    (value) => threads.push(value),
    (value) => activity.push(value),
    (error) => errors.push(error),
  )
  assert.equal(watches[0].reference, 'threads')
  assert.equal(watches[1].reference, 'activity')
  for (const watch of watches) {
    assert.equal(watch.args.workspaceId, 'workspace-1')
    assert.equal(watch.args.agentId, 'agent-1')
  }
  watches[0].onValue({
    threads: [
      { conversationId: 'open', title: 'Open' },
      { conversationId: 'archived', archivedAt: 1 },
    ],
  })
  assert.equal(threads[0].length, 1)
  watches[1].onValue([{ conversationId: 'open', status: 'needs_input' }])
  assert.equal(activity[0][0].status, 'needs_input')
  watches[0].onValue(null)
  watches[1].onValue(null)
  assert.equal(threads[1].length, 0)
  assert.equal(activity[1].length, 0)
  const failure = new Error('Revoked')
  watches[1].onError(failure)
  assert.equal(errors[0], failure)
  stop()
  assert.ok(watches.every((watch) => watch.stopped))
})
test('agent clicks resolve an existing main thread and plus creates a new native thread', async () => {
  const { service, mutations } = shell()
  assert.equal((await service.openAgentThread('workspace-1', 'agent-1')).conversationId, 'thread-1')
  await service.openAgentThread('workspace-1', 'agent-1', true)
  assert.equal(mutations[0].reference, 'main')
  assert.equal(mutations[1].reference, 'create')
  assert.equal(mutations[1].args.workspaceId, 'workspace-1')
  assert.equal(mutations[1].args.agentId, 'agent-1')
})

test('default agent identity uses the record flag, never the agent name', () => {
  const mark = Symbol('OverlayMark')
  const svg = Symbol('Svg')
  const createElement = (type, props, ...children) => ({ type, props, children })
  const { AgentAvatar } = load('components/shell/AgentAvatar.tsx', {
    react: { default: { createElement } },
    'react-native-svg': { default: svg, Circle: 'Circle', G: 'G', Path: 'Path', Rect: 'Rect' },
    '../../../src/shared/agents/agent-creature': {
      creatureEyeColor: () => '#000000',
      normalizeCreatureShape: (shape) => shape ?? 'circle',
      themeCreatureFills: (color) => ({ light: color, dark: color }),
    },
    './Brand': { OverlayMark: mark },
  })
  assert.equal(
    AgentAvatar({
      agent: { name: 'Renamed chief', isDefault: true },
      foreground: '#111111',
      dark: false,
    }).type,
    mark,
  )
  assert.equal(
    AgentAvatar({ agent: { name: 'Overlay', isDefault: false }, foreground: '#ffffff', dark: true })
      .type,
    svg,
  )
})

test('shell typography selects real Geist weights without Android font padding', () => {
  const { T } = load('components/shell/primitives.tsx', {
    react: { default: { createElement: (type, props) => ({ type, props }) } },
    'react-native': { Text: 'Text', StyleSheet: { flatten: (style) => style } },
  })
  for (const [fontWeight, family] of [
    ['400', 'Geist'],
    ['500', 'GeistMedium'],
    ['600', 'GeistSemibold'],
    ['bold', 'GeistSemibold'],
  ]) {
    const defaults = T({ style: { fontWeight } }).props.style[0]
    assert.equal(defaults.fontFamily, family)
    assert.equal(defaults.includeFontPadding, false)
  }
})
