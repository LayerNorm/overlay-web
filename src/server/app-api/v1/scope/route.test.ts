import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { deriveOverlayCapabilities } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'

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

function context(body: Record<string, unknown>, work: boolean): AppApiRouteContext {
  return {
    auth: { userId: 'user_1', accessToken: 'token', authType: 'session' },
    capabilities: { ...deriveOverlayCapabilities(), work },
    params: Promise.resolve({}),
    parsedFormData: null,
    parsedJson: body,
    parsedQuery: {},
    requestFingerprint: 'fp',
    requestIdempotencyKey: 'key',
    workspace: {
      workspace: { id: 'ws_1', kind: 'organization', name: 'Team', slug: 'team', status: 'active', createdAt: 0, updatedAt: 0 },
      principal: { id: 'principal_1', workspaceId: 'ws_1', type: 'human', displayName: 'Test', createdAt: 0, updatedAt: 0 },
      membership: { membershipId: 'm1', workspaceId: 'ws_1', principalId: 'principal_1', role: 'member', status: 'active', joinedAt: 0, updatedAt: 0 },
    },
  }
}

function post(body: Record<string, unknown>) {
  return new NextRequest('https://overlay.test/api/v1/scope', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

test('the shared scope route holds Work to the Work kill switch', async (t) => {
  const calls: string[] = []
  t.mock.method(convex, 'mutation', async (path: string) => { calls.push(path); return { ok: true } })
  const route = await import('./route')
  const body = { resource: 'work', id: 'item_1', action: 'archive' }

  const off = await route.POST(post(body), context(body, false))
  assert.equal(off.status, 403)
  assert.equal((await off.json() as { code: string }).code, 'capability_disabled')
  assert.deepEqual(calls, [])

  // Other resources are not affected by the Work switch.
  const fileBody = { resource: 'files', id: 'file_1', action: 'archive' }
  const files = await route.POST(post(fileBody), context(fileBody, false))
  assert.equal(files.status, 200)
  assert.ok(calls.includes('files/files:archive'))
  assert.equal(calls.some((path) => path.startsWith('work/')), false)
})

test('moves are one-way, and only an automation move can take its agent along', async (t) => {
  const calls: Array<{ path: string; args: Record<string, unknown> }> = []
  const outcomes: Record<string, unknown> = { 'skills:personal': { ok: false, reason: 'one_way' } }
  t.mock.method(convex, 'mutation', async (path: string, args: Record<string, unknown>) => {
    if (path.endsWith(':setScope')) calls.push({ path, args })
    return outcomes[`${path.split('/').at(-1)?.split(':')[0]}:${args.to}`] ?? { ok: true }
  })
  const route = await import('./route')

  const back = { resource: 'skills', id: 'skill_1', action: 'move', to: 'personal' }
  const refused = await route.POST(post(back), context(back, true))
  assert.equal(refused.status, 403)
  assert.deepEqual(await refused.json(), { error: "Items can't move back to Personal.", code: 'resource_scope_denied', reason: 'one_way' })

  const automation = { resource: 'automations', id: 'auto_1', action: 'move', to: 'workspace', withAgent: true }
  assert.equal((await route.POST(post(automation), context(automation, true))).status, 200)
  assert.equal(calls.at(-1)?.path, 'automations/automations:setScope')
  assert.equal(calls.at(-1)?.args.withAgent, true)

  // Other resources never pass it on.
  const file = { resource: 'files', id: 'file_1', action: 'move', to: 'workspace', withAgent: true }
  assert.equal((await route.POST(post(file), context(file, true))).status, 200)
  assert.equal('withAgent' in (calls.at(-1)?.args ?? {}), false)
})
