import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-idle-timer-secret'
const now = 1_900_000_000_000

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutation = (name: string) => makeFunctionReference<'mutation'>(`agents/connectedAgents:${name}`)
const query = (name: string) => makeFunctionReference<'query'>(`agents/connectedAgents:${name}`)

async function seedLease(convex: ReturnType<typeof convexTest>) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('agentSandboxLeases', {
      leaseId: 'lease-1', workspaceId: 'w1', environmentId: 'env-1', provider: 'box', providerReference: 'sandbox',
      status: 'running', reservedUntil: Number.MAX_SAFE_INTEGER, usage: {}, cleanupAttempts: 0, createdAt: now, updatedAt: now,
    })
  })
}
const readUsage = (convex: ReturnType<typeof convexTest>) => convex.run(async (ctx) =>
  (await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', 'lease-1')).unique())?.usage as Record<string, unknown>)

describe('Convex agent machine idle timer', () => {
  test('a patch with idleCheckInMs sets a fresh token and schedules one check; a null token cancels it', async () => {
    const convex = convexTest(schema, modules)
    await seedLease(convex)
    await convex.mutation(mutation('patchSandboxLeaseUsageByServer'), {
      serverSecret: secret, workspaceId: 'w1', leaseId: 'lease-1', patch: { lastActiveAt: now }, now, idleCheckInMs: 600_000,
    })
    const first = await readUsage(convex)
    expect(typeof first.idleToken).toBe('string')
    expect(first.idleCheckAt).toBe(now + 600_000)
    expect(first.lastActiveAt).toBe(now)
    const scheduled = await convex.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.args[0]).toMatchObject({ workspaceId: 'w1', leaseId: 'lease-1', token: first.idleToken })

    // A new timer replaces the token, so the first one finds itself stale.
    await convex.mutation(mutation('patchSandboxLeaseUsageByServer'), {
      serverSecret: secret, workspaceId: 'w1', leaseId: 'lease-1', patch: {}, now: now + 1_000, idleCheckInMs: 600_000,
    })
    const second = await readUsage(convex)
    expect(second.idleToken).not.toBe(first.idleToken)

    // A starting run clears the token without deleting anything.
    await convex.mutation(mutation('patchSandboxLeaseUsageByServer'), {
      serverSecret: secret, workspaceId: 'w1', leaseId: 'lease-1', patch: { idleToken: null, idleCheckAt: null }, now: now + 2_000,
    })
    expect((await readUsage(convex)).idleToken).toBeNull()
  })

  test('the run check sees a run that has not finished and ignores finished ones', async () => {
    const convex = convexTest(schema, modules)
    const session = (status: string, id: string) => convex.run(async (ctx) => {
      await ctx.db.insert('agentRemoteSessions', {
        sessionId: id, workspaceId: 'w1', environmentId: 'env-1', bindingId: 'b', runId: id, status,
        commandCursor: 0, eventCursor: 0, capabilitySnapshot: {}, createdAt: now, updatedAt: now,
      })
    })
    const has = () => convex.query(query('environmentHasActiveRunsByServer'), { serverSecret: secret, environmentId: 'env-1' })
    expect(await has()).toBe(false)
    await session('completed', 's1')
    await session('failed', 's2')
    expect(await has()).toBe(false)
    await session('waiting_for_approval', 's3')
    expect(await has()).toBe(true)
  })
})
