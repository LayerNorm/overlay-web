/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, mocks = {}, cache = new Map()) {
  const absolute = path.resolve(root, file)
  if (cache.has(absolute)) return cache.get(absolute)
  const source = fs.readFileSync(absolute, 'utf8')
  const result = { exports: {} }
  cache.set(absolute, result.exports)
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext('(function(require,module,exports){' + compiled + '\n})', {
    Error,
    Date,
    Map,
    Set,
  })(
    (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      assert.ok(id.startsWith('.'), 'Unexpected runtime dependency: ' + id)
      return load(path.resolve(path.dirname(absolute), id + '.ts'), mocks, cache)
    },
    result,
    result.exports,
  )
  return result.exports
}
const clean = (value) => JSON.parse(JSON.stringify(value))
function service() {
  const watches = [],
    calls = []
  let result = { id: 'task' },
    failure = null,
    failSubscribe = null
  const api = {
    work: {
      browse: Object.fromEntries(
        [
          'list',
          'context',
          'get',
          'events',
          'linkedThread',
          'create',
          'update',
          'move',
          'addComment',
        ].map((name) => [name, name]),
      ),
    },
    collaboration: { directory: { policy: 'policy' } },
  }
  const adapter = load('services/workService.ts', {
    './convexClient': {
      api,
      subscribeConvex(query, args, value, error) {
        if (query === failSubscribe) throw new Error('subscription failed')
        const watch = { query, args: clean(args), value, error, stopped: false }
        watches.push(watch)
        return () => {
          watch.stopped = true
        }
      },
      async mutateConvex(query, args) {
        calls.push(['convex', query, clean(args)])
        if (failure) throw failure
        return result
      },
    },
    './appApi': {
      async appJson(url, args) {
        calls.push(['http', url, clean(args)])
        if (failure) throw failure
        return { item: result }
      },
    },
  })
  return {
    module: adapter,
    watches,
    calls,
    result: (value) => {
      result = value
    },
    fail: (error) => {
      failure = error
    },
    failSubscribe: (query) => {
      failSubscribe = query
    },
  }
}

test('Work list/context/policy subscriptions preserve empty versus denied and clean up', () => {
  const s = service(),
    values = [],
    errors = []
  const stop = s.module.subscribeWorkList(
    'workspace',
    'personal',
    (value) => values.push(value),
    () => {},
    (error) => errors.push(error),
  )
  assert.deepEqual(
    s.watches.map((watch) => [watch.query, watch.args]),
    [
      ['list', { workspaceId: 'workspace', view: 'personal' }],
      ['context', { workspaceId: 'workspace' }],
      ['policy', { workspaceId: 'workspace' }],
    ],
  )
  s.watches[0].value([])
  s.watches[0].value(null)
  assert.deepEqual(values, [[], null])
  const denied = new Error('denied')
  s.watches[1].error(denied)
  assert.equal(errors[0], denied)
  stop()
  assert.ok(s.watches.every((watch) => watch.stopped))
})
test('task, events and linked thread have canonical args and independent cleanup', () => {
  const s = service(),
    items = [],
    events = [],
    threads = [],
    errors = []
  const stop = s.module.subscribeWorkTask(
    'w',
    'task',
    (value) => items.push(value),
    (value) => events.push(value),
    (value) => threads.push(value),
    (error) => errors.push(error),
  )
  assert.deepEqual(
    s.watches.map((watch) => [watch.query, watch.args]),
    [
      ['get', { workspaceId: 'w', id: 'task' }],
      ['events', { workspaceId: 'w', workItemId: 'task' }],
      ['linkedThread', { workspaceId: 'w', id: 'task' }],
    ],
  )
  s.watches[0].value(null)
  s.watches[1].value([])
  s.watches[2].value({ visible: false })
  s.watches[2].value(null)
  assert.deepEqual(items, [null])
  assert.deepEqual(events, [[]])
  assert.deepEqual(threads, [{ visible: false }, null])
  const failure = new Error('offline')
  s.watches[2].error(failure)
  assert.equal(errors[0], failure)
  stop()
  assert.ok(s.watches.every((watch) => watch.stopped))
})
test('partially opened subscriptions close if a later subscription cannot start', () => {
  const s = service()
  s.failSubscribe('policy')
  assert.throws(
    () =>
      s.module.subscribeWorkList(
        'w',
        'workspace',
        () => {},
        () => {},
        () => {},
      ),
    /subscription failed/,
  )
  assert.ok(s.watches.every((watch) => watch.stopped))
  const task = service()
  task.failSubscribe('linkedThread')
  assert.throws(
    () =>
      task.module.subscribeWorkTask(
        'w',
        'task',
        () => {},
        () => {},
        () => {},
        () => {},
      ),
    /subscription failed/,
  )
  assert.ok(task.watches.every((watch) => watch.stopped))
})
test('unassigned create and ordinary edits persist through generated Convex references', async () => {
  const s = service()
  await s.module.createWork('w', {
    title: 'Task',
    scope: 'personal',
    blockedBy: ['dependency'],
    dueDate: '2026-10-20',
  })
  await s.module.updateWork('w', 'task', { description: null, expectedUpdatedAt: 123 })
  assert.deepEqual(s.calls, [
    [
      'convex',
      'create',
      {
        title: 'Task',
        scope: 'personal',
        blockedBy: ['dependency'],
        dueDate: '2026-10-20',
        workspaceId: 'w',
      },
    ],
    [
      'convex',
      'update',
      { description: null, expectedUpdatedAt: 123, id: 'task', workspaceId: 'w' },
    ],
  ])
})
test('assigned creates, reassignment, clearing assignment and scope changes stay atomic HTTP commands', async () => {
  const s = service()
  await s.module.createWork('w', {
    title: 'Task',
    assigneePrincipalId: 'agent',
    blockedBy: ['dependency'],
  })
  await s.module.updateWork('w', 'task/id', { assigneePrincipalId: null, expectedUpdatedAt: 12 })
  await s.module.updateWork('w', 'task', { assigneePrincipalId: 'human' })
  await s.module.updateWork('w', 'task', { scope: 'workspace' })
  assert.deepEqual(s.calls[0], [
    'http',
    '/api/v1/work',
    {
      method: 'POST',
      workspaceId: 'w',
      json: { title: 'Task', assigneePrincipalId: 'agent', blockedBy: ['dependency'] },
    },
  ])
  assert.deepEqual(s.calls[1], [
    'http',
    '/api/v1/work/task%2Fid',
    {
      method: 'PATCH',
      workspaceId: 'w',
      json: { assigneePrincipalId: null, expectedUpdatedAt: 12 },
    },
  ])
  assert.ok(s.calls.every((call) => call[0] === 'http'))
})
test('moves use server neighbour ranking; comments persist with the canonical workItemId', async () => {
  const s = service()
  await s.module.moveWork('w', { id: 'task', status: 'done', afterId: null })
  await s.module.commentWork('w', 'task', '  Looks good.  ')
  assert.deepEqual(s.calls, [
    ['convex', 'move', { id: 'task', status: 'done', afterId: null, workspaceId: 'w' }],
    ['convex', 'addComment', { workspaceId: 'w', workItemId: 'task', body: 'Looks good.' }],
  ])
  await assert.rejects(s.module.commentWork('w', 'task', ' '), /Write a comment/)
  assert.equal(s.calls.length, 2)
})
test('null mutation results and backend refusals never pretend to save', async () => {
  const s = service()
  s.result(null)
  await assert.rejects(s.module.createWork('w', { title: 'Task' }), /no longer available/)
  await assert.rejects(
    s.module.createWork('w', { title: 'Task', assigneePrincipalId: 'agent' }),
    /no longer available/,
  )
  await assert.rejects(
    s.module.updateWork('w', 'task', { title: 'Changed' }),
    /no longer available/,
  )
  await assert.rejects(
    s.module.moveWork('w', { id: 'task', status: 'done' }),
    /no longer available/,
  )
  s.fail(new Error('WORK_INVALID:conflict'))
  await assert.rejects(
    s.module.updateWork('w', 'task', { title: 'Changed' }),
    /WORK_INVALID:conflict/,
  )
  await assert.rejects(
    s.module.updateWork('w', 'task', { assigneePrincipalId: 'agent' }),
    /WORK_INVALID:conflict/,
  )
  await assert.rejects(s.module.commentWork('w', 'task', 'Comment'), /WORK_INVALID:conflict/)
})

const work = load('lib/work.ts')
const item = {
  id: 'task',
  title: 'Task',
  description: null,
  status: 'review',
  createdBy: 'viewer',
  reviewerUserId: null,
  assigneePrincipalId: 'agent',
  blocked: false,
  archivedAt: null,
  rank: 'A',
  createdAt: 1,
}
test('web Needs you and Assigned to me semantics are reused, including reviewer fallback', () => {
  const items = [
    item,
    {
      ...item,
      id: 'mine',
      status: 'progress',
      assigneePrincipalId: 'principal',
      createdBy: 'someone',
    },
    { ...item, id: 'reviewer', status: 'todo', createdBy: 'someone', reviewerUserId: 'viewer' },
    { ...item, id: 'blocked', status: 'todo', blocked: true },
    { ...item, id: 'done', status: 'done' },
    { ...item, id: 'archived', archivedAt: 1 },
  ]
  const options = { query: '', viewer: { userId: 'viewer', principalId: 'principal' } }
  assert.deepEqual(
    Array.from(work.filterWork(items, { ...options, filter: 'needs-you' }), (value) => value.id),
    ['task', 'blocked'],
  )
  assert.deepEqual(
    Array.from(work.filterWork(items, { ...options, filter: 'mine' }), (value) => value.id),
    ['mine', 'reviewer'],
  )
  assert.equal(work.filterWork([], { ...options, filter: 'all' }).length, 0)
  assert.equal(work.filterWork(items, { query: '', filter: 'needs-you', viewer: null }).length, 0)
})
test('web status groups preserve rank order, no duplicate rows or invented blocked status', () => {
  const groups = work.groupByStatus([
    { ...item, id: 'b', rank: 'B' },
    item,
    { ...item, id: 'progress', status: 'progress', blocked: true },
    { ...item, id: 'done', status: 'done' },
  ])
  assert.deepEqual(
    clean(groups.map((group) => [group.status, group.items.map((task) => task.id)])),
    [
      ['review', ['task', 'b']],
      ['progress', ['progress']],
      ['done', ['done']],
    ],
  )
  assert.equal(work.groupByStatus([]).length, 0)
})
test('composer normalizes multiline text and validates web title/date limits before submission', () => {
  assert.deepEqual(
    clean(
      work.workRequest('  Launch checklist  \r\nA good result.', {
        scope: 'workspace',
        blockedBy: ['a'],
        startDate: '2026-10-16',
        dueDate: '2026-10-17',
      }),
    ),
    {
      scope: 'workspace',
      blockedBy: ['a'],
      startDate: '2026-10-16',
      dueDate: '2026-10-17',
      title: 'Launch checklist',
      description: 'A good result.',
    },
  )
  assert.throws(() => work.workRequest(' ', {}), /Give the task a title/)
  assert.throws(() => work.workRequest('x'.repeat(201), {}), /Titles can be up to/)
  assert.throws(() => work.workRequest('Task', { startDate: '2026-02-30' }), /not a valid date/)
  assert.throws(
    () => work.workRequest('Task', { startDate: '2026-10-17', dueDate: '2026-10-16' }),
    /before the due date/,
  )
  assert.throws(
    () => work.workRequest('Task\n' + 'x'.repeat(20001), {}),
    /Descriptions can be up to/,
  )
})
test('assignee picker respects web creator-agent and personal human restrictions', () => {
  const people = [
    { principalId: 'self', type: 'human' },
    { principalId: 'other', type: 'human' },
    { principalId: 'private', type: 'agent', agentVisibility: 'creator' },
    { principalId: 'shared', type: 'agent', agentVisibility: 'workspace' },
  ]
  assert.deepEqual(
    Array.from(work.availableWorkPeople(people, 'personal', 'self'), (value) => value.principalId),
    ['self', 'private', 'shared'],
  )
  assert.deepEqual(
    Array.from(work.availableWorkPeople(people, 'workspace', 'self'), (value) => value.principalId),
    ['self', 'other', 'shared'],
  )
  assert.equal(work.availableWorkPeople([], 'workspace', 'self').length, 0)
  assert.deepEqual(
    Array.from(
      work.dependencyChoices(
        [{ ...item, id: 'self' }, { ...item, id: 'archived', archivedAt: 123 }, item],
        'self',
      ),
      (value) => value.id,
    ),
    ['task'],
  )
})

test('work date and dependency helpers behind the native task forms', () => {
  const date = work.fromWorkDate('2026-03-08')
  assert.equal(work.toWorkDate(date), '2026-03-08')
  assert.equal(date.getHours(), 12)
  assert.deepEqual([...work.toggleDependency(['a', 'b'], 'a')], ['b'])
  assert.deepEqual([...work.toggleDependency(['a'], 'b')], ['a', 'b'])
  assert.equal(work.toggleDependency(Array.from({ length: 50 }, (_, index) => String(index)), 'new'), null)
})
