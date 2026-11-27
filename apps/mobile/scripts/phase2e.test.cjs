/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const clean = (value) => JSON.parse(JSON.stringify(value))
function load(file, mocks) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext('(function(require,module,exports){' + output + '\n})', {
    Error,
    console,
    setTimeout,
    clearTimeout,
  })(
    (id) => {
      assert.ok(Object.hasOwn(mocks, id), 'Unexpected import ' + id)
      return mocks[id]
    },
    loaded,
    loaded.exports,
  )
  return loaded.exports
}
function hooks() {
  const state = [],
    effects = []
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [
        state[index],
        (value) => {
          state[index] = typeof value === 'function' ? value(state[index]) : value
        },
      ]
    },
    useEffect(effect) {
      effects.push(effect)
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
  }
  react.default = react
  return {
    react,
    effects,
    render(component, props) {
      cursor = 0
      return component(props)
    },
  }
}
const native = new Proxy({}, { get: (_, key) => key })
function nodes(tree) {
  return !tree || typeof tree !== 'object'
    ? []
    : [tree, ...(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)]
}
function views(h) {
  return load('components/knowledge/ResourceViews.tsx', {
    react: h.react,
    'react-native': new Proxy(
      { useWindowDimensions: () => ({ width: 390, height: 844 }) },
      { get: (target, key) => (key in target ? target[key] : key) },
    ),
    'lucide-react-native': native,
    'react-native-enriched-markdown': { EnrichedMarkdownText: 'Markdown' },
    '../shell/primitives': { T: 'T', Button: 'Button', IconButton: 'IconButton' },
    '../shell/AgentAvatar': { AgentAvatar: 'Avatar' },
    '../../lib/activity': load('lib/activity.ts', {}),
    '../../lib/automationSchedule': load('lib/automationSchedule.ts', {}),
    '../ui/AppChrome': { BottomSheet: 'Sheet' },
    '../../services/noteContentFormat': { normalizeHtmlForMobileMarkdown: (value) => value },
    '../navigation/NativeSegmented': { NativeSegmented: 'NativeSegmented' },
    './FileActions': { FileContextMenu: 'FileContextMenu' },
    '../creatures/CreatureEmpty': { CreatureEmpty: 'CreatureEmpty' },
    'expo-router': { Stack: { Toolbar: Object.assign(() => null, { Button: 'ToolbarButton' }) } },
  })
}
function backend() {
  const calls = [],
    watches = []
  const api = {
    files: {
      browse: Object.fromEntries(
        ['list', 'get', 'children', 'rename', 'move', 'forConversation'].map((name) => [
          name,
          'files.' + name,
        ]),
      ),
    },
    automations: {
      browse: { list: 'auto.list', get: 'auto.get', runs: 'auto.runs' },
      workflowEvents: { watchWorkflowStepEvents: 'workflow.events' },
    },
  }
  const convex = {
    api,
    convexWorkspaceId: () => 'workspace',
    queryConvex: async (...args) => {
      calls.push(args)
      return convex.result
    },
    mutateConvex: async (...args) => {
      calls.push(args)
      if (convex.error) throw new Error(convex.error)
      return null
    },
    subscribeConvex: (...args) => {
      watches.push(args)
      return () => {
        calls.push('unsubscribed')
      }
    },
    result: [],
  }
  return { calls, watches, convex }
}

test('files use native list/get/tree/conversation reads and validated rename/move; empty/null/errors are preserved', async () => {
  const b = backend(),
    files = load('services/filesService.ts', { './convexClient': b.convex })
  assert.deepEqual(clean(await files.listFiles()), [])
  b.convex.result = null
  assert.equal(await files.getFile('missing'), null)
  await files.fileChildren(null, 'workspace')
  await files.conversationFiles('chat')
  await files.renameFile('file', '  New name ')
  await files.moveFile('file', null)
  assert.deepEqual(clean(b.calls.slice(2)), [
    ['files.children', { workspaceId: 'workspace', parentId: null, view: 'workspace' }],
    ['files.forConversation', { workspaceId: 'workspace', conversationId: 'chat' }],
    ['files.rename', { workspaceId: 'workspace', fileId: 'file', name: 'New name' }],
    ['files.move', { workspaceId: 'workspace', fileId: 'file', parentId: null }],
  ])
  await assert.rejects(files.renameFile('file', ' '), /Enter a file name/)
  b.convex.result = { files: [], complete: false }
  assert.deepEqual(clean(await files.fileChildren('folder', 'personal')), {
    files: [],
    complete: false,
  })
  b.convex.error = 'Permission denied'
  await assert.rejects(files.moveFile('file', 'folder'), /Permission denied/)
  const values = [],
    errors = [],
    stop = files.subscribeFiles(
      'workspace',
      (value) => values.push(value),
      (error) => errors.push(error),
    )
  b.watches[0][2]([])
  b.watches[0][3]('offline')
  stop()
  assert.deepEqual(clean(values), [[]])
  assert.deepEqual(errors, ['offline'])
  assert.equal(b.calls.at(-1), 'unsubscribed')
})

test('automation list/detail/runs and ordered workflow events are native; execution remains HTTP', async () => {
  const b = backend(),
    http = [],
    service = load('services/automationsService.ts', {
      '@overlay/api-client': { createIdempotencyKey: () => 'automation-request' },
      './convexClient': b.convex,
      './modeState': { getCurrentMode: () => 'personal' },
      './appApi': {
        appJson: async (...args) => {
          http.push(args)
          return { ok: true }
        },
        getRequestWorkspaceId: () => 'workspace',
      },
    })
  await service.listAutomations()
  await service.getAutomation('a')
  await service.listAutomationRuns('a')
  assert.deepEqual(clean(b.calls.map((call) => call[0])), ['auto.list', 'auto.get', 'auto.runs'])
  assert.equal(b.calls[0][1].view, 'personal')
  const values = [],
    errors = [],
    stop = service.subscribeWorkflowSteps(
      { userId: 'user', accessToken: 'fixture', workflowRunId: 'run' },
      (value) => values.push(value),
      (error) => errors.push(error),
    )
  b.watches[0][2]([])
  b.watches[0][2]([{ _id: '1', stepName: 'brief', stepStatus: 'step_started', createdAt: 0 }])
  b.watches[0][3]('offline')
  stop()
  assert.deepEqual(clean(values[0]), [])
  assert.equal(values[1][0].eventType, 'step_started')
  assert.equal(values[1][0].createdAt, '1970-01-01T00:00:00.000Z')
  assert.deepEqual(errors, ['offline'])
  await service.runAutomationNow('a')
  assert.equal(http[0][0], '/api/v1/automations/a/run')
  assert.equal(http[0][1].workspaceId, 'workspace')
  b.convex.result = null
  await assert.rejects(service.listAutomations(), /unavailable/)
})

test('notes read native metadata and storage bodies, guard workspace changes and return the saved CAS revision', async () => {
  let workspace = 'one',
    row = {
      _id: 'note',
      kind: 'note',
      name: 'Draft',
      textInObjectStore: true,
      textContent: '',
      content: '/api/v1/files/note/download',
      createdAt: 1,
      updatedAt: 2,
    },
    httpError
  const bodies = [],
    calls = []
  const saved = {
    _id: 'note',
    title: 'Saved',
    content: '<p>Body</p>',
    tags: [],
    createdAt: 1,
    updatedAt: 3,
  }
  const notes = load('services/noteStorage.ts', {
    './modeState': { getCurrentMode: () => 'personal' },
    './appApi': {
      getRequestWorkspaceId: () => workspace,
      appJson: async (...args) => {
        calls.push(args)
        if (httpError) throw httpError
        return { note: saved }
      },
    },
    './filesService': {
      getFile: async () => row,
      listFiles: async () => [],
      moveFile: async () => {},
      renameFile: async () => {},
    },
    './knowledgeService': {
      getKnowledgeFileContent: async (id) => {
        bodies.push(id)
        return '<p>Stored body</p>'
      },
    },
  })
  assert.deepEqual(clean(await notes.loadNotesIndex()), [])
  assert.equal((await notes.loadNote('note')).content, '<p>Stored body</p>')
  assert.deepEqual(bodies, ['note'])
  row.textContent = 'Only a truncated preview'
  assert.equal((await notes.loadNote('note')).content, '<p>Stored body</p>')
  const result = await notes.saveNote({
    id: 'note',
    title: 'Saved',
    content: '<p>Body</p>',
    createdAt: 1,
    updatedAt: 2,
  })
  assert.equal(result.updatedAt, 3)
  assert.equal(calls[0][1].workspaceId, 'one')
  assert.equal(calls[0][1].json.expectedUpdatedAt, 2)
  httpError = Error('Conflict: note was changed')
  await assert.rejects(notes.saveNote(result), /Conflict/)
  row = null
  assert.equal(await notes.loadNote('missing'), null)
  row = {
    get kind() {
      workspace = 'two'
      return 'note'
    },
    _id: 'old',
    updatedAt: 2,
  }
  await assert.rejects(notes.loadNote('old'), /Workspace changed/)
})

test('live resource hides stale workspace values, unsubscribes and exposes retryable errors', () => {
  const h = hooks(),
    watches = []
  const { useLiveResource } = load('hooks/useLiveResource.ts', {
    react: h.react,
    'convex/server': { getFunctionName: (value) => value, makeFunctionReference: (value) => value },
    '../services/convexClient': {
      subscribeConvex: (...args) => {
        watches.push(args)
        return () => watches.push('stop')
      },
    },
  })
  const render = (args) => h.render(() => useLiveResource('files:list', args))
  assert.equal(render({ workspaceId: 'one' }).loading, true)
  const stop = h.effects.pop()()
  watches[0][2](['private'])
  assert.deepEqual(clean(render({ workspaceId: 'one' }).data), ['private'])
  assert.equal(render({ workspaceId: 'two' }).data, undefined)
  stop()
  watches[0][2](['late'])
  assert.equal(render({ workspaceId: 'two' }).data, undefined)
  h.effects.pop()()
  watches.findLast((value) => Array.isArray(value))[3](new Error('Offline'))
  const state = render({ workspaceId: 'two' })
  assert.equal(state.error, 'Offline')
  state.retry()
  assert.equal(render({ workspaceId: 'two' }).error, undefined)
  assert.equal(render(null).loading, false)
})

test('activity filters and empty/error states retain web labels and public bug-report entry', () => {
  const h = hooks(),
    ui = views(h),
    items = [
      { id: 'm', title: 'Mention', type: 'mention', createdAt: 0 },
      { id: 't', title: 'Thread', type: 'thread', createdAt: 0, readAt: 1 },
    ]
  assert.deepEqual(clean(ui.ACTIVITY_FILTERS), [
    'all',
    'unread',
    'mentions',
    'threads',
    'reactions',
  ])
  for (const [filter, count] of [
    ['all', 2],
    ['unread', 1],
    ['mentions', 1],
    ['threads', 1],
    ['reactions', 0],
  ]) {
    const tree = ui.ActivityFeed({
      theme: {},
      items,
      filter,
      onFilter() {},
      onOpen() {},
      onReadAll() {},
      onBugReport() {},
    })
    assert.equal(
      nodes(tree).filter(
        (node) => node.type === ui.ResourceRow && node.props.title !== 'Submit a bug',
      ).length,
      count,
    )
    assert.ok(nodes(tree).some((node) => node.props.title === 'Submit a bug'))
  }
  const failed = ui.ResourceState({ theme: {}, error: 'Offline', onRetry() {} })
  assert.ok(nodes(failed).some((node) => node.props.accessibilityRole === 'alert'))
})

test('authenticated image preview preserves its source and exposes a retryable error', () => {
  const h = hooks(),
    ui = views(h),
    source = {
      uri: 'https://isolated.invalid/api/v1/files/image/download',
      headers: { Authorization: 'Bearer fixture' },
    }
  let tree = h.render(ui.FileImage, { theme: {}, source })
  assert.equal(tree.props.source, source)
  assert.equal(tree.props.alt, 'File preview')
  tree.props.onError()
  tree = h.render(ui.FileImage, { theme: {}, source })
  assert.equal(tree.props.error, 'Could not load this image.')
  tree.props.onRetry()
  assert.equal(
    h.render(ui.FileImage, { theme: {}, source }).props.accessibilityLabel,
    'File preview',
  )
})

test('files filter/folder actions, unsupported preview, automation empty/history/live and search groups', () => {
  const h = hooks(),
    ui = views(h),
    calls = [],
    files = [
      { _id: 'f', type: 'folder', name: 'Launch', parentId: null },
      { _id: 'n', kind: 'note', name: 'Plan', parentId: null, updatedAt: 0 },
    ]
  const tree = h.render(ui.FilesBrowser, {
    theme: {},
    files,
    parentId: null,
    onFolder: (id) => calls.push(id),
    onOpen() {},
    onAdd() {},
  })
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Launch')
    .props.onPress()
  assert.deepEqual(calls, ['f'])
  assert.equal(ui.fileMatches(files[1], ' PLAN '), true)
  assert.ok(
    nodes(
      ui.FilePaper({
        theme: {},
        file: {
          name: 'Binary',
          kind: 'upload',
          textContent: '',
          content: '/api/v1/files/x/download',
        },
        onDownload() {},
      }),
    ).some((node) => node.type === ui.ResourceState),
  )
  assert.ok(
    nodes(ui.AutomationList({ theme: {}, items: [], onOpen() {}, onNew() {} })).some(
      (node) => node.type === 'CreatureEmpty' && node.props.title === 'No automations yet',
    ),
  )
  assert.ok(
    nodes(
      ui.AutomationDetail({
        theme: {},
        item: { name: 'Brief' },
        runs: [{ _id: 'r', status: 'running', createdAt: 0 }],
        schedule: 'Daily',
      }),
    ).some((node) => node.props.accessibilityLabel === 'View live run'),
  )
  assert.ok(
    nodes(
      h.render(ui.SearchResults, {
        theme: {},
        query: 'none',
        onQuery() {},
        results: [],
        onOpen() {},
        onPerson() {},
      }),
    ).some((node) => node.props.empty === 'No results'),
  )
})

test('notes autosave after typing pauses, include the revision, keep the draft on failure and do not retry a conflict in a loop', async () => {
  const h = hooks(),
    ui = views(h),
    sent = [],
    props = {
      theme: {},
      file: { name: 'Plan', textContent: 'Original', updatedAt: 10 },
      onOptions() {},
      onSave: async (value) => {
        sent.push(value)
        throw new Error('Conflict; reopen before saving.')
      },
    }
  // NoteDocument registers three effects per render: autosave, draft ref, flush on leave.
  const autosave = () => h.effects[h.effects.length - 3]()
  const pause = () => new Promise((resolve) => setTimeout(resolve, ui.NOTE_AUTOSAVE_MS + 50))
  let tree = h.render(ui.NoteDocument, props)
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Edit note content')
    .props.onPress()
  tree = h.render(ui.NoteDocument, props)
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Note content')
    .props.onChangeText('Keep this draft')
  h.render(ui.NoteDocument, props)
  autosave()
  await pause()
  tree = h.render(ui.NoteDocument, props)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].expectedUpdatedAt, 10)
  assert.equal(sent[0].content, 'Keep this draft')
  assert.equal(
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Note content').props.value,
    'Keep this draft',
  )
  assert.ok(nodes(tree).some((node) => node.props.error?.includes('Conflict')))
  autosave()
  await pause()
  assert.equal(sent.length, 1, 'a failed draft waits for a new edit')
})

test('production paths have no run polling/SSE; fixture modules are not imported by application routes', () => {
  const run = fs.readFileSync(
    path.join(root, 'components/automations/AutomationRunSheet.tsx'),
    'utf8',
  )
  assert.doesNotMatch(run, /setInterval|getAutomationRunStatus|streamAutomationRunEvents/)
  for (const dir of ['app', 'components', 'hooks', 'services'])
    for (const file of fs
      .readdirSync(path.join(root, dir), { recursive: true })
      .filter((file) => /\.[jt]sx?$/.test(file)))
      assert.doesNotMatch(fs.readFileSync(path.join(root, dir, file), 'utf8'), /ResourceFixture/)
})
