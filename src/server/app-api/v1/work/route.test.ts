import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import { ConvexError } from 'convex/values'
import { createWorkHandlers, workError } from './route'
import { WorkService, type WorkRepository } from '@/server/work/WorkService'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { WorkItem } from '@overlay/app-core/work'

const task: WorkItem = {
  _id: 'task-1',
  _creationTime: 1,
  userId: 'alice',
  workspaceId: 'ws-1',
  scope: 'personal',
  title: 'Ship',
  description: '',
  status: 'todo',
  blocked: false,
  priority: 2,
  rank: 'i',
  createdAt: 1,
  updatedAt: 1,
}
// Only authenticated fields consumed by the domain handlers; the BFF supplies the complete context.
const context = {
  auth: { userId: 'alice' },
  workspace: { workspace: { id: 'ws-1' } },
  params: Promise.resolve({ id: task._id }),
} as AppApiRouteContext
const request = (path: string, method = 'GET', body?: unknown) =>
  new NextRequest(`https://preview.example.test/api/v1/work${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
function fixture() {
  const calls: unknown[] = []
  const repository: WorkRepository = {
    context: async () => [],
    people: async () => [],
    list: async (...args) => {
      calls.push(args)
      return { data: [task], hasMore: false, nextCursor: null }
    },
    get: async (...args) => {
      calls.push(args)
      return task
    },
    create: async (...args) => {
      calls.push(args)
      return task
    },
    update: async (...args) => {
      calls.push(args)
      return task
    },
    events: async (...args) => {
      calls.push(args)
      return []
    },
    action: async (...args) => {
      calls.push(args)
    },
  }
  return { calls, handlers: createWorkHandlers(new WorkService(repository)) }
}
test('scope list uses authenticated user/workspace and rejects unknown query fields', async () => {
  const { calls, handlers } = fixture()
  assert.equal((await handlers.list(request('?view=workspace'), context)).status, 200)
  assert.deepEqual(calls, [[{ userId: 'alice', workspaceId: 'ws-1' }, 'workspace', {}]])
  assert.equal((await handlers.list(request('?workspaceId=other'), context)).status, 400)
})
test('create validates bodies before persistence and cannot impersonate a creator', async () => {
  const { handlers, calls } = fixture()
  assert.equal(
    (await handlers.create(request('', 'POST', { title: 'Ship', scope: 'personal' }), context))
      .status,
    201,
  )
  assert.deepEqual(calls[0], [
    { userId: 'alice', workspaceId: 'ws-1' },
    { title: 'Ship', scope: 'personal' },
  ])
  for (const body of [
    { title: '' },
    { title: 'x', userId: 'bob' },
    { title: 'x', startDate: '2026-02-30' },
    { title: 'x', priority: 0 },
  ]) {
    assert.equal((await handlers.create(request('', 'POST', body), context)).status, 400)
  }
  assert.equal(calls.length, 1)
})
test('detail, revision-checked patch, comments and archive use resolved route IDs', async () => {
  const { handlers, calls } = fixture()
  const detail = await handlers.get(request('/task-1'), context)
  assert.deepEqual(await detail.json(), { item: task, events: [] })
  assert.equal(
    (
      await handlers.update(
        request('/task-1', 'PATCH', { expectedUpdatedAt: 1, patch: { title: 'Ship now' } }),
        context,
      )
    ).status,
    200,
  )
  assert.equal(
    (
      await handlers.update(
        request('/task-1', 'PATCH', { patch: { title: 'No revision' } }),
        context,
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await handlers.action(
        request('/task-1', 'POST', { action: 'comment', text: 'Ready' }),
        context,
      )
    ).status,
    200,
  )
  assert.equal((await handlers.archive(request('/task-1', 'DELETE'), context)).status, 200)
  assert.deepEqual(calls.at(-1), [
    { userId: 'alice', workspaceId: 'ws-1' },
    'task-1',
    { action: 'archived' },
  ])
})
test('Convex structured failures preserve HTTP 400/403/404/409 on hosted backends', async () => {
  for (const [code, status] of [
    ['INVALID', 400],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
  ] as const) {
    const response = workError(new ConvexError({ code, message: 'Expected failure' }))
    assert.equal(response.status, status)
    assert.equal((await response.json()).error, 'Expected failure')
  }
})

test('disabled rollout gate hides every Work HTTP export', async () => {
  const { GET, POST, getWork, updateWork, actionWork, archiveWork, peopleWork, contextWork } =
    await import('./route')
  const { publicEnv } = await import('@/shared/env/public-env')
  const previous = publicEnv.workEnabled
  Object.assign(publicEnv, { workEnabled: false })
  try {
    for (const handler of [
      GET,
      POST,
      getWork,
      updateWork,
      actionWork,
      archiveWork,
      peopleWork,
      contextWork,
    ]) {
      assert.equal((await handler(request(''), context)).status, 404)
    }
  } finally {
    Object.assign(publicEnv, { workEnabled: previous })
  }
})

test('malformed Convex references/cursors are client errors without exposing validator arguments', () => {
  assert.equal(
    workError(new Error('ArgumentValidationError: private backend arguments')).status,
    400,
  )
  assert.equal(workError(new Error('InvalidCursor: bad cursor')).status, 400)
})
