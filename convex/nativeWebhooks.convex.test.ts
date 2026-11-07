import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const fn = {
  subscriptions: makeFunctionReference<'query'>('webhooks/browse:subscriptions'),
  deliveries: makeFunctionReference<'query'>('webhooks/browse:deliveries'),
}
const backendUrl = 'https://fixture.convex.cloud'

afterEach(() => { vi.unstubAllEnvs() })

async function fixture(options: { webhooks?: boolean } = {}) {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 600_000,
      snapshot: {
        version: 1, backendUrl, revision: 'a'.repeat(64), features: { webhooks: options.webhooks ?? true },
        rollout: { stage: 'general', internalWorkspaceIds: '', invitedWorkspaceIds: '' },
      },
    } as never)
    await ctx.db.insert('authorizationRoles', { roleId: 'hooks', name: 'Hooks', capabilities: ['webhooks.manage'], isSystem: false, createdAt: 1, updatedAt: 1 })
    for (const ws of ['ws', 'other']) {
      await ctx.db.insert('workspaces', { workspaceId: ws, kind: 'organization', name: ws, slug: ws, status: 'active', createdAt: 1, updatedAt: 1 })
    }
    for (const userId of ['alice', 'bob']) {
      for (const ws of ['ws', 'other']) {
        await ctx.db.insert('workspacePrincipals', { workspaceId: ws, principalId: `${ws}-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
        await ctx.db.insert('workspaceMemberships', { workspaceId: ws, principalId: `${ws}-${userId}`, membershipId: `m-${ws}-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
      }
    }
    // Bob is a member without the webhooks capability.
    await ctx.db.insert('authorizationUserRoles', { roleId: 'hooks', userId: 'alice', createdAt: 1 })
    const sub = (workspaceId: string, url: string) => ctx.db.insert('webhookSubscriptions', {
      userId: 'alice', workspaceId, url, secret: 'whsec_TOP_SECRET', events: ['chat.completed'], enabled: true, createdAt: 1, updatedAt: 1,
    } as never)
    const here = await sub('ws', 'https://hooks.example/here')
    const elsewhere = await sub('other', 'https://hooks.example/elsewhere')
    const delivery = (subscriptionId: typeof here, status: 'pending' | 'dead', createdAt: number) => ctx.db.insert('webhookDeliveries', {
      userId: 'alice', subscriptionId, eventId: `e-${createdAt}`, eventType: 'chat.completed', payloadJson: '{"private":"PAYLOAD"}',
      status, attemptCount: 0, nextAttemptAt: 0, createdAt, updatedAt: createdAt,
    })
    return { here, pending: await delivery(here, 'pending', 2), dead: await delivery(here, 'dead', 1), elsewhere: await delivery(elsewhere, 'pending', 3) }
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }), ids }
}

test('webhook managers see their endpoints and deliveries in this workspace, never secrets or payloads', async () => {
  const { as, ids } = await fixture()
  const subs = await as('alice').query(fn.subscriptions, { workspaceId: 'ws' }) as Array<{ url: string }>
  expect(subs.map(row => row.url)).toEqual(['https://hooks.example/here'])
  const deliveries = await as('alice').query(fn.deliveries, { workspaceId: 'ws' }) as Array<{ _id: string; status: string }>
  expect(deliveries.map(row => [row._id, row.status])).toEqual([[ids.pending, 'pending'], [ids.dead, 'dead_letter']])
  expect(JSON.stringify([subs, deliveries])).not.toMatch(/TOP_SECRET|PAYLOAD|secret|payload/)
})

test('delivery transitions from the runner show live', async () => {
  const { t, as, ids } = await fixture()
  await t.run(async ctx => { await ctx.db.patch(ids.pending, { status: 'delivered', deliveredAt: 5, lastStatusCode: 200 }) })
  const deliveries = await as('alice').query(fn.deliveries, { workspaceId: 'ws' }) as Array<{ _id: string; status: string; lastStatusCode?: number }>
  expect(deliveries[0]).toMatchObject({ _id: ids.pending, status: 'delivered', lastStatusCode: 200 })
})

test('members without the webhooks capability, strangers and deployments without webhooks get nothing', async () => {
  const { as } = await fixture()
  expect(await as('bob').query(fn.subscriptions, { workspaceId: 'ws' })).toBeNull()
  expect(await as('bob').query(fn.deliveries, { workspaceId: 'ws' })).toBeNull()
  expect(await as('stranger').query(fn.subscriptions, { workspaceId: 'ws' })).toBeNull()
  const off = await fixture({ webhooks: false })
  expect(await off.as('alice').query(fn.subscriptions, { workspaceId: 'ws' })).toBeNull()
})
