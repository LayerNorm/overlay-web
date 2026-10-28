import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => vi.unstubAllEnvs())

test('durable terminal settlement atomically queues one webhook across retries and both runner paths', async () => {
  vi.stubEnv('INTERNAL_API_SECRET', 'terminal-webhook-test')
  const t = convexTest(schema, modules)
  const automationId = await t.run(async ctx => {
    const id = await ctx.db.insert('automations', { userId: 'owner', name: 'Test', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('webhookSubscriptions', { userId: 'owner', url: 'https://hooks.example.test/fixture',
      secret: 'fixture-only', events: ['automation.finished', 'automation.failed'], enabled: true, createdAt: 1, updatedAt: 1 })
    return id
  })
  for (const [method, eventType] of [
    ['markManualRunCompleted', 'automation.finished'], ['markManualRunFailed', 'automation.failed'],
    ['markRunCompleted', 'automation.finished'], ['markRunFailed', 'automation.failed'],
  ]) {
    const runId = await t.run(ctx => ctx.db.insert('automationRuns', {
      automationId, userId: 'owner', status: 'running', scheduledFor: 1, createdAt: 1,
    }))
    const ref = makeFunctionReference<'mutation'>(`automations/automations:${method}`)
    const args = { runId, now: 2, ...(method.includes('Manual') ? { userId: 'owner', serverSecret: 'terminal-webhook-test' } : {}),
      ...(eventType === 'automation.failed' ? { error: 'Synthetic test failure' } : {}) }
    await t.mutation(ref, args)
    await t.mutation(ref, args)
    const deliveries = await t.run(ctx => ctx.db.query('webhookDeliveries').collect())
    const own = deliveries.filter(row => row.eventId === `${eventType}:${runId}`)
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ status: 'pending', attemptCount: 0, eventType })
    expect(JSON.parse(own[0].payloadJson)).toMatchObject({ type: eventType, userId: 'owner',
      data: { automationId, runId, ...(eventType === 'automation.failed' ? { error: 'Synthetic test failure' } : {}) } })
  }
})
