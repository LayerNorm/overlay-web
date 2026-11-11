import assert from 'node:assert/strict'
import test from 'node:test'
import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import { WorkspaceBillingRequestService } from '@/server/billing/WorkspaceBillingRequestService'
import { BillingServiceError } from '@/server/billing/BillingCustomerService'

import * as route from './[workspaceId]/billing/request/route'

process.env.NEXT_PHASE = 'phase-production-build'
process.env.NEXT_PUBLIC_CONVEX_URL = 'https://fixture.convex.cloud'
process.env.INTERNAL_API_SECRET = 'billing-request-test-secret'
process.env.OVERLAY_DEPLOYMENT_ENV = 'test'
function context(authType = 'session'): AccountAppApiRouteContext {
  return { auth: { userId: 'member-1', authType }, params: Promise.resolve({ workspaceId: 'team-a' }) } as AccountAppApiRouteContext
}

test('billing request route returns 202 and delegates session member identity', async (t) => {
  t.mock.method(WorkspaceBillingRequestService.prototype, 'request', async (args: unknown) => {
    assert.deepEqual(args, { actorUserId: 'member-1', workspaceId: 'team-a' })
    return { requested: true }
  })
  const response = await route.POST(new Request('https://getoverlay.io/api/v1/workspaces/team-a/billing/request', { method: 'POST' }), context())
  assert.equal(response.status, 202)
  assert.deepEqual(await response.json(), { requested: true })
})

test('billing request route rejects programmatic callers and serializes service errors', async (t) => {
  const request = new Request('https://getoverlay.io/api/v1/workspaces/team-a/billing/request', { method: 'POST' })
  assert.equal((await route.POST(request, context('api-key'))).status, 403)
  for (const status of [400, 403, 409]) {
    const mock = t.mock.method(WorkspaceBillingRequestService.prototype, 'request', async () => { throw new BillingServiceError({ error: 'Not eligible' }, status) })
    const response = await route.POST(request, context())
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: 'Not eligible' })
    mock.mock.restore()
  }
})
