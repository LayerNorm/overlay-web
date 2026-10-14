import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { deriveOverlayCapabilities } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { AppDataCapabilities } from '@/server/app-data/capabilities'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getAuthorizationRoutePolicy } from '@/server/authorization/authorization-route-policy'

const originalNextPhase = process.env.NEXT_PHASE
const originalInternalApiSecret = process.env.INTERNAL_API_SECRET
process.env.NEXT_PHASE = 'phase-production-build'
process.env.INTERNAL_API_SECRET = 'test-internal-secret'
test.after(() => {
  if (originalNextPhase === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = originalNextPhase
  if (originalInternalApiSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = originalInternalApiSecret
})

const CAPABILITIES = { provider: 'convex' } as unknown as AppDataCapabilities

function request(path: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`https://overlay.test${path}`, {
    method: init.method,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
  })
}

function context(params: Record<string, string> = {}, parsedJson: Record<string, unknown> = {}): AppApiRouteContext {
  return {
    auth: { userId: 'user_1', accessToken: 'token', authType: 'session' },
    capabilities: deriveOverlayCapabilities(),
    params: Promise.resolve(params),
    parsedFormData: null,
    parsedJson,
    parsedQuery: {},
    appDataCapabilities: CAPABILITIES,
    requestFingerprint: 'fp',
    requestIdempotencyKey: 'key',
    workspace: {
      workspace: { id: 'ws_1', kind: 'organization', name: 'Team', slug: 'team', status: 'active', createdAt: 0, updatedAt: 0 },
      principal: { id: 'principal_1', workspaceId: 'ws_1', type: 'human', displayName: 'Test', createdAt: 0, updatedAt: 0 },
      membership: { membershipId: 'm1', workspaceId: 'ws_1', principalId: 'principal_1', role: 'member', status: 'active', joinedAt: 0, updatedAt: 0 },
    },
  }
}

const doc = {
  _id: 'item_1',
  _creationTime: 1,
  scope: 'workspace',
  workspaceId: 'ws_1',
  userId: 'user_1',
  title: 'Write the plan',
  status: 'todo',
  blocked: false,
  priority: 2,
  rank: 'M',
  createdAt: 10,
  updatedAt: 20,
}

function mockConvex(t: test.TestContext, handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: Array<{ path: string; args: Record<string, unknown> }> = []
  const run = async (path: string, args: Record<string, unknown>) => {
    calls.push({ path, args })
    const handler = handlers[path]
    if (!handler) throw new Error(`Unexpected Convex call ${path}`)
    return handler(args)
  }
  t.mock.method(convex, 'query', run)
  t.mock.method(convex, 'mutation', run)
  return calls
}

test('GET /api/v1/work lists tasks as clean JSON for the active workspace and view', async (t) => {
  const calls = mockConvex(t, { 'work/workItems:list': () => [doc, { ...doc, _id: 'item_2', archivedAt: 5, archivedFromScope: 'personal', scope: 'workspace', description: '# Hi', blockedBy: ['item_1'] }] })
  const route = await import('./route')
  const response = await route.GET(request('/api/v1/work?view=workspace'), context())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json() as { items: Array<Record<string, unknown>> }
  assert.equal(body.items.length, 2)
  assert.deepEqual(body.items[0], {
    id: 'item_1', workspaceId: 'ws_1', scope: 'workspace', createdBy: 'user_1', title: 'Write the plan', description: null,
    status: 'todo', blocked: false, priority: 2, rank: 'M', assigneePrincipalId: null, reviewerUserId: null, startDate: null,
    dueDate: null, parentId: null, blockedBy: [], doneWhen: [], context: [], archivedAt: null, archivedFromScope: null,
    createdAt: 10, updatedAt: 20,
  })
  // An archived task reports the scope it came from.
  assert.equal(body.items[1].scope, 'personal')
  assert.deepEqual(body.items[1].blockedBy, ['item_1'])
  assert.equal(calls[0].args.workspaceId, 'ws_1')
  assert.equal(calls[0].args.userId, 'user_1')
  assert.equal(calls[0].args.view, 'workspace')
  assert.equal(typeof calls[0].args.serverSecret, 'string')
})

test('GET /api/v1/work ignores an unknown view', async (t) => {
  const calls = mockConvex(t, { 'work/workItems:list': () => [] })
  const route = await import('./route')
  await route.GET(request('/api/v1/work?view=everything'), context())
  assert.equal('view' in calls[0].args, false)
})

test('POST /api/v1/work creates a task (201) and validates the body (400)', async (t) => {
  const calls = mockConvex(t, { 'work/workItems:create': () => doc })
  const route = await import('./route')
  const created = await route.POST(request('/api/v1/work', { method: 'POST', body: { title: 'Write the plan', scope: 'workspace' } }), context({}, { title: 'Write the plan', scope: 'workspace' }))
  assert.equal(created.status, 201)
  assert.equal((await created.json() as { item: { id: string } }).item.id, 'item_1')
  assert.equal(calls[0].args.title, 'Write the plan')
  assert.equal(calls[0].args.scope, 'workspace')

  const bad = await route.POST(request('/api/v1/work', { method: 'POST', body: {} }), context())
  assert.equal(bad.status, 400)
  assert.equal((await bad.json() as { code: string }).code, 'validation_error')
  assert.equal(calls.length, 1)
})

test('Convex refusals come back with plain messages and the right status', async (t) => {
  mockConvex(t, {
    'work/workItems:create': () => { throw new Error('Uncaught Error: WORK_INVALID:date_order') },
    'work/workItems:update': () => { throw new Error('Uncaught Error: Unauthorized') },
    'work/workItems:move': () => { throw new Error('Uncaught Error: WORK_INVALID:archived') },
  })
  const list = await import('./route')
  const refusedCreate = await list.POST(request('/api/v1/work', { method: 'POST', body: { title: 'x' } }), context({}, { title: 'x' }))
  assert.equal(refusedCreate.status, 400)
  assert.match((await refusedCreate.json() as { error: string }).error, /start date/)

  const item = await import('./[id]/route')
  const forbidden = await item.PATCH(request('/api/v1/work/item_1', { method: 'PATCH', body: { title: 'y' } }), context({ id: 'item_1' }, { title: 'y' }))
  assert.equal(forbidden.status, 403)

  const move = await import('./[id]/move/route')
  const archived = await move.POST(request('/api/v1/work/item_1/move', { method: 'POST', body: { status: 'done' } }), context({ id: 'item_1' }, { status: 'done' }))
  assert.equal(archived.status, 409)
})

test('GET and PATCH /api/v1/work/{id}', async (t) => {
  const calls = mockConvex(t, {
    'work/workItems:get': (args) => (args.id === 'missing' ? null : doc),
    'work/workItems:update': (args) => ({ ...doc, title: args.title }),
  })
  const route = await import('./[id]/route')
  const found = await route.GET(request('/api/v1/work/item_1'), context({ id: 'item_1' }))
  assert.equal(found.status, 200)
  assert.equal((await found.json() as { item: { title: string } }).item.title, 'Write the plan')

  const missing = await route.GET(request('/api/v1/work/missing'), context({ id: 'missing' }))
  assert.equal(missing.status, 404)

  const patched = await route.PATCH(
    request('/api/v1/work/item_1', { method: 'PATCH', body: { title: 'Renamed', dueDate: null } }),
    context({ id: 'item_1' }, { title: 'Renamed', dueDate: null }),
  )
  assert.equal((await patched.json() as { item: { title: string } }).item.title, 'Renamed')
  const update = calls.find((call) => call.path === 'work/workItems:update')
  assert.equal(update?.args.id, 'item_1')
  assert.equal(update?.args.dueDate, null)
  assert.equal('status' in (update?.args ?? {}), false)

  const bad = await route.PATCH(request('/api/v1/work/item_1', { method: 'PATCH', body: { status: 'canceled' } }), context({ id: 'item_1' }, { status: 'canceled' }))
  assert.equal(bad.status, 400)
})

test('DELETE /api/v1/work/{id} removes an archived task and explains a refusal', async (t) => {
  const outcomes: Record<string, unknown> = {
    gone: { ok: true },
    active: { ok: false, reason: 'not_archived' },
    other: { ok: false, reason: 'forbidden' },
    missing: { ok: false, reason: 'not_found' },
  }
  mockConvex(t, { 'work/workItems:remove': (args) => outcomes[String(args.id)] })
  const route = await import('./[id]/route')
  const remove = (id: string) => route.DELETE(request(`/api/v1/work/${id}`, { method: 'DELETE' }), context({ id }))
  assert.equal((await remove('gone')).status, 200)
  const active = await remove('active')
  assert.equal(active.status, 409)
  assert.match((await active.json() as { error: string }).error, /Archive the task/)
  assert.equal((await remove('other')).status, 403)
  assert.equal((await remove('missing')).status, 404)
})

test('POST /api/v1/work/{id}/move places a task between neighbours', async (t) => {
  const calls = mockConvex(t, { 'work/workItems:move': () => ({ ...doc, status: 'review', rank: 'T' }) })
  const route = await import('./[id]/move/route')
  const response = await route.POST(
    request('/api/v1/work/item_1/move', { method: 'POST', body: { status: 'review', afterId: 'a', beforeId: null } }),
    context({ id: 'item_1' }, { status: 'review', afterId: 'a', beforeId: null }),
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { item: { status: string } }).item.status, 'review')
  assert.deepEqual({ id: calls[0].args.id, status: calls[0].args.status, afterId: calls[0].args.afterId, beforeId: calls[0].args.beforeId }, { id: 'item_1', status: 'review', afterId: 'a', beforeId: null })
})

test('GET and POST /api/v1/work/{id}/events', async (t) => {
  const calls = mockConvex(t, {
    'work/workItems:get': (args) => (args.id === 'hidden' ? null : doc),
    'work/workItemEvents:list': () => [{ _id: 'e1', workItemId: 'item_1', actorPrincipalId: 'principal_1', kind: 'comment', data: { body: 'hi' }, createdAt: 30 }],
    'work/workItemEvents:addComment': () => null,
  })
  const route = await import('./[id]/events/route')
  const events = await route.GET(request('/api/v1/work/item_1/events'), context({ id: 'item_1' }))
  assert.deepEqual((await events.json() as { events: unknown[] }).events, [{ id: 'e1', workItemId: 'item_1', actorPrincipalId: 'principal_1', kind: 'comment', data: { body: 'hi' }, createdAt: 30 }])

  const hidden = await route.GET(request('/api/v1/work/hidden/events'), context({ id: 'hidden' }))
  assert.equal(hidden.status, 404)

  const comment = await route.POST(request('/api/v1/work/item_1/events', { method: 'POST', body: { body: 'hi' } }), context({ id: 'item_1' }, { body: 'hi' }))
  assert.equal(comment.status, 201)
  assert.equal(calls.find((call) => call.path === 'work/workItemEvents:addComment')?.args.body, 'hi')

  const empty = await route.POST(request('/api/v1/work/item_1/events', { method: 'POST', body: {} }), context({ id: 'item_1' }))
  assert.equal(empty.status, 400)
})

test('GET /api/v1/work/context returns the picker context, or 403 outside the workspace', async (t) => {
  let allowed = true
  mockConvex(t, {
    'work/workItems:context': () => (allowed ? { principalId: 'principal_1', role: 'member', canCreateInWorkspace: true, assignees: [
      { principalId: 'principal_1', type: 'human', userId: 'user_1', displayName: 'Test' },
      { principalId: 'p-agent', type: 'agent', userId: null, displayName: 'Researcher' },
      { principalId: 'p-svc', type: 'service', userId: null, displayName: 'Service' },
    ] } : null),
  })
  const route = await import('./context/route')
  const ok = await route.GET(request('/api/v1/work/context'), context())
  assert.deepEqual(await ok.json(), {
    principalId: 'principal_1', role: 'member', canCreateInWorkspace: true,
    people: [
      { principalId: 'principal_1', type: 'human', userId: 'user_1', displayName: 'Test' },
      { principalId: 'p-agent', type: 'agent', userId: null, displayName: 'Researcher' },
    ],
  })
  allowed = false
  assert.equal((await route.GET(request('/api/v1/work/context'), context())).status, 403)
})

test('every Work route requires the work.use capability', () => {
  for (const [method, path] of [
    ['GET', '/api/v1/work'], ['POST', '/api/v1/work'], ['GET', '/api/v1/work/context'],
    ['GET', '/api/v1/work/abc'], ['PATCH', '/api/v1/work/abc'], ['DELETE', '/api/v1/work/abc'], ['POST', '/api/v1/work/abc/move'],
    ['GET', '/api/v1/work/abc/events'], ['POST', '/api/v1/work/abc/events'],
  ] as const) {
    assert.deepEqual(getAuthorizationRoutePolicy(method, path), { access: 'capability', capabilities: ['work.use'] }, `${method} ${path}`)
  }
  assert.equal(getAuthorizationRoutePolicy('PUT', '/api/v1/work/abc'), null)
})
