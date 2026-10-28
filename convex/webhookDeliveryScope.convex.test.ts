import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.unstubAllEnvs())

test('delivery history and redrive accept the app workspace and enforce the parent subscription scope', async () => {
  vi.stubEnv('INTERNAL_API_SECRET', 'webhook-scope-test')
  const t = convexTest(schema, modules)
  const first = await t.run(async ctx => {
    const ids = []
    for (const workspaceId of ['workspace-a', 'workspace-b']) {
      const subscriptionId = await ctx.db.insert('webhookSubscriptions', { userId: 'owner', workspaceId,
        url: 'https://hooks.example.test/fixture', secret: 'test-only', events: ['automation.finished'],
        enabled: true, createdAt: 1, updatedAt: 1 })
      ids.push(await ctx.db.insert('webhookDeliveries', { userId: 'owner', subscriptionId,
        eventId: `event-${workspaceId}`, eventType: 'automation.finished', payloadJson: '{}', status: 'dead',
        attemptCount: 5, nextAttemptAt: 1, createdAt: 1, updatedAt: 1 }))
    }
    return ids[0]
  })
  const list = makeFunctionReference<'query'>('webhooks/deliveries:listByServer')
  const redrive = makeFunctionReference<'mutation'>('webhooks/deliveries:redriveByServer')
  const args = { serverSecret: 'webhook-scope-test', userId: 'owner' }
  expect(await t.query(list, args)).toHaveLength(2)
  expect(await t.query(list, { ...args, workspaceId: 'workspace-a' })).toMatchObject([{ eventId: 'event-workspace-a' }])
  expect(await t.query(list, { ...args, workspaceId: 'other' })).toEqual([])
  expect(await t.query(list, { ...args, userId: 'outsider', workspaceId: 'workspace-a' })).toEqual([])
  expect(await t.mutation(redrive, { ...args, deliveryId: first, workspaceId: 'workspace-b' })).toEqual({ deliveryId: null })
  const retried = await t.mutation(redrive, { ...args, deliveryId: first, workspaceId: 'workspace-a' })
  expect(retried.deliveryId).toBeTruthy()
  expect(await t.query(list, { ...args, workspaceId: 'workspace-a' })).toHaveLength(2)
})
