import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { GET as events } from '@/server/app-api/v1/automations/[runId]/events/route'
import { GET as status } from '@/server/app-api/v1/automations/[runId]/stream/route'

function context(): AppApiRouteContext {
  return {
    params: Promise.resolve({ id: 'other-workflow' }),
    auth: { userId: 'outsider', accessToken: 'test', authType: 'session' },
    parsedQuery: {}, parsedJson: {}, parsedFormData: null,
    capabilities: DEFAULT_OVERLAY_CAPABILITIES, appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES,
    requestFingerprint: 'test', requestIdempotencyKey: null,
    workspace: {
      workspace: { id: 'outsider-workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
      principal: { id: 'outsider', userId: 'outsider', workspaceId: 'outsider-workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
      membership: { workspaceId: 'outsider-workspace', principalId: 'outsider', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
    },
  }
}

for (const [name, handler] of [['events', events], ['status', status]] as const) {
  test(`${name} refuses inaccessible workflows before reading Workflow SDK data`, async () => {
    let checked = false
    const response = await handler(new NextRequest('https://example.test/api/v1/automations/other-workflow/events'),
      context(), async args => {
        checked = true
        assert.deepEqual(args, { workflowRunId: 'other-workflow', userId: 'outsider', workspaceId: 'outsider-workspace' })
        return false
      })
    assert.equal(checked, true)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Not found' })
  })

  test(`${name} requires authentication before checking workflow access`, async () => {
    const response = await handler(new NextRequest('https://example.test/api/v1/automations/other-workflow/events'),
      { ...context(), auth: { userId: '', accessToken: '', authType: 'session' } },
      async () => assert.fail('Unauthenticated requests must not read workflow access'))
    assert.equal(response.status, 401)
  })
}
