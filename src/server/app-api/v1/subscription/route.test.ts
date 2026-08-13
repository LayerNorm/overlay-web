import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { GET } from './route'

test('workspace members receive the workspace payer subscription', async () => {
  const calls: Array<{ billingAccountId?: string; userId: string }> = []
  const response = await GET(
    new Request('https://example.test/api/v1/subscription') as never,
    routeContext('member_1', 'workspace_1'),
    {
      resolvePayer: async () => ({
        billingAccountId: 'ba_workspace',
        scope: 'workspace',
        subject: { id: 'member_1', kind: 'member' },
        workspaceId: 'workspace_1',
      }),
      getAppSubscription: async (args) => {
        calls.push(args)
        return { planKind: 'paid', budgetRemainingCents: 700 }
      },
    } as never,
  )

  assert.equal(response.status, 200)
  assert.deepEqual(calls, [{ billingAccountId: 'ba_workspace', userId: 'member_1' }])
  assert.deepEqual(await response.json(), { planKind: 'paid', budgetRemainingCents: 700 })
})

test('personal workspaces keep personal subscription reads', async () => {
  const calls: Array<{ billingAccountId?: string; userId: string }> = []
  const response = await GET(
    new Request('https://example.test/api/v1/subscription') as never,
    routeContext('user_1', 'personal_1'),
    {
      resolvePayer: async () => ({
        billingAccountId: 'ba_personal',
        scope: 'personal',
        subject: { id: 'user_1', kind: 'member' },
        userId: 'user_1',
      }),
      getAppSubscription: async (args) => {
        calls.push(args)
        return { planKind: 'free', budgetRemainingCents: 0 }
      },
    } as never,
  )

  assert.equal(response.status, 200)
  assert.deepEqual(calls, [{ userId: 'user_1' }])
})

function routeContext(userId: string, workspaceId: string): AppApiRouteContext {
  return {
    auth: { userId },
    workspace: {
      workspace: { id: workspaceId },
    },
  } as AppApiRouteContext
}
