import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeCreateTask,
  executeListTasks,
  executeUpdateTask,
} from './work-executes'
import type { OverlayToolsOptions } from './types'

const baseOptions: OverlayToolsOptions = { userId: 'u1', workspaceId: 'ws1', baseUrl: 'https://overlay.test' }
const people = [
  { principalId: 'p-me', type: 'human', userId: 'u1', displayName: 'Me' },
  { principalId: 'p-agent', type: 'agent', userId: null, displayName: 'Researcher' },
  { principalId: 'p-alex-1', type: 'human', userId: 'u2', displayName: 'Alex' },
  { principalId: 'p-alex-2', type: 'human', userId: 'u3', displayName: 'Alex' },
]
const contextBody = { principalId: 'p-me', people }
const task = {
  id: 'task1', title: 'Draft', status: 'todo', priority: 2, scope: 'workspace', updatedAt: 10,
  assigneePrincipalId: null, reviewerUserId: null, dueDate: null,
}

function mockApi(handler: (url: URL, init: RequestInit, body: Record<string, unknown> | null) => unknown) {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; search: string; method: string; body: Record<string, unknown> | null }> = []
  globalThis.fetch = (async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    requests.push({ path: url.pathname, search: url.search, method, body })
    const result = handler(url, init, body)
    return result instanceof Response ? result : Response.json(result)
  }) as typeof fetch
  return { requests, restore: () => { globalThis.fetch = originalFetch } }
}

test('create resolves case-insensitive names, me, and priority labels, with conditional attribution', async () => {
  const api = mockApi((url, _init, body) => {
    if (url.pathname.endsWith('/context')) return contextBody
    return { item: { ...task, ...body, id: 'new-task', priority: body?.priority, assigneePrincipalId: body?.assigneePrincipalId } }
  })
  try {
    const result = await executeCreateTask(baseOptions, { title: 'Draft', assignee: 'researcher', reviewer: 'ME', priority: 'high' })
    assert.equal(result.success, true)
    const create = api.requests.find((request) => request.method === 'POST')!
    assert.equal(create.body?.assigneePrincipalId, 'p-agent')
    assert.equal(create.body?.reviewerUserId, 'u1')
    assert.equal(create.body?.priority, 3)
    assert.equal('actingAgentPrincipalId' in (create.body ?? {}), false)
  } finally {
    api.restore()
  }
})

test('ambiguous names return options without writing', async () => {
  const api = mockApi((url) => url.pathname.endsWith('/context') ? contextBody : {})
  try {
    const result = await executeCreateTask(baseOptions, { title: 'Draft', assignee: 'alex' })
    assert.equal(result.success, false)
    assert.match('error' in result ? result.error : '', /Ambiguous assignee.*p-alex-1.*p-alex-2/)
    assert.equal(api.requests.some((request) => request.method === 'POST'), false)
  } finally {
    api.restore()
  }
})

test('stale revisions conflict without writes', async () => {
  let stored = { ...task, title: 'Newer human edit' }
  const api = mockApi((url, init, body) => {
    if (url.pathname.endsWith('/context')) return contextBody
    if (init.method === 'PATCH') {
      if (body?.expectedUpdatedAt !== stored.updatedAt) return Response.json({ error: 'Read the task again.', code: 'work_conflict' }, { status: 409 })
      stored = { ...stored, ...body }
    }
    return { item: stored }
  })
  try {
    const result = await executeUpdateTask(baseOptions, { taskId: 'task1', revision: '9', title: 'Changed' })
    assert.deepEqual(result, { success: false, conflict: true, currentRevision: '10' })
    assert.equal(stored.title, 'Newer human edit')
    assert.equal(api.requests.find((request) => request.method === 'PATCH')?.body?.expectedUpdatedAt, 9)
  } finally {
    api.restore()
  }
})

test('fields, status, scope and agent attribution use one atomic update', async () => {
  const api = mockApi((url, init, body) => {
    if (url.pathname.endsWith('/context')) return contextBody
    if (url.pathname === '/api/v1/work/task1') return { item: { ...task, ...body, updatedAt: 11 } }
    return { item: { ...task, title: 'Changed', status: 'done', updatedAt: 12 } }
  })
  try {
    const result = await executeUpdateTask({ ...baseOptions, agentPrincipalId: 'p-agent' }, {
      taskId: 'task1', title: 'Changed', status: 'done', scope: 'workspace', revision: '10',
    })
    assert.equal(result.success, true)
    const writes = api.requests.filter((request) => request.method !== 'GET')
    assert.deepEqual(writes.map((request) => request.path), ['/api/v1/work/task1'])
    assert.equal(writes[0]?.body?.actingAgentPrincipalId, 'p-agent')
    assert.equal(writes[0]?.body?.status, 'done')
    assert.equal(writes[0]?.body?.scope, 'workspace')
    assert.equal(writes[0]?.body?.expectedUpdatedAt, 10)
    assert.ok(result.success)
    if (result.success) assert.equal(result.task.status, 'done')
  } finally {
    api.restore()
  }
})

test('list filters status, agent assignee, query and clamps limit', async () => {
  const items = Array.from({ length: 205 }, (_, index) => ({
    ...task,
    id: `task${index}`,
    title: `Needle ${index}`,
    status: 'todo',
    assigneePrincipalId: 'p-agent',
  }))
  const api = mockApi((url) => url.pathname.endsWith('/context') ? contextBody : { items })
  try {
    const result = await executeListTasks(baseOptions, {
      scope: 'workspace', status: 'todo', assignee: 'agents', query: 'needle', limit: 250,
    })
    assert.equal(result.success, true)
    if (result.success) {
      assert.equal(result.tasks.length, 200)
      assert.equal(result.truncated, true)
      assert.equal(result.tasks[0]?.assignee, 'Researcher')
    }
    const workSearch = api.requests.find((request) => request.path === '/api/v1/work')?.search
    assert.equal(new URLSearchParams(workSearch).get('view'), 'workspace')
  } finally {
    api.restore()
  }
})

test('lists archived tasks by requested scope and keeps done tasks', async () => {
  const items = [
    { ...task, id: 'personal-archived', title: 'Personal archive', scope: 'personal', status: 'done' },
    { ...task, id: 'workspace-archived', title: 'Workspace archive', scope: 'workspace', status: 'done' },
  ]
  const api = mockApi((url) => url.pathname.endsWith('/context') ? contextBody : { items })
  try {
    const result = await executeListTasks(baseOptions, { archived: true, scope: 'workspace' })
    assert.equal(result.success, true)
    if (result.success) {
      assert.deepEqual(result.tasks.map((item) => item.id), ['workspace-archived'])
      assert.equal(result.tasks[0]?.status, 'done')
    }
    const workSearch = api.requests.find((request) => request.path === '/api/v1/work')?.search
    assert.equal(new URLSearchParams(workSearch).get('view'), 'archived')
  } finally {
    api.restore()
  }
})

test('limits archived tasks to workspace scope in shared rooms', async () => {
  const items = [
    { ...task, id: 'personal-archived', title: 'Personal archive', scope: 'personal' },
    { ...task, id: 'workspace-archived', title: 'Workspace archive', scope: 'workspace' },
  ]
  const api = mockApi((url) => url.pathname.endsWith('/context') ? contextBody : { items })
  try {
    const result = await executeListTasks({ ...baseOptions, sharedRoom: true }, { archived: true })
    assert.equal(result.success, true)
    if (result.success) {
      assert.deepEqual(result.tasks.map((item) => item.id), ['workspace-archived'])
    }
    const workSearch = api.requests.find((request) => request.path === '/api/v1/work')?.search
    assert.equal(new URLSearchParams(workSearch).get('view'), 'archived')
  } finally {
    api.restore()
  }
})
