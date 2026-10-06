import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'free-allowance-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

type Convex = ReturnType<typeof convexTest>
const recordBatch = makeFunctionReference<'mutation'>('platform/usage:recordBatch')
const getEntitlements = makeFunctionReference<'query'>('platform/usage:getEntitlementsByServer')

const askTurn = { type: 'ask' as const, modelId: 'm', cost: 0, timestamp: 1 }

async function setActiveWorkspace(convex: Convex, userId: string, activeWorkspaceId: string) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaceUserPreferences', { userId, activeWorkspaceId, updatedAt: 1 })
  })
}

const turn = (convex: Convex, userId: string, count = 1) => convex.mutation(recordBatch, {
  serverSecret: secret,
  userId,
  events: Array.from({ length: count }, () => askTurn),
})
const used = async (convex: Convex, userId: string) => {
  const entitlements = await convex.query(getEntitlements, { serverSecret: secret, userId })
  return entitlements.dailyUsage.ask as number
}

describe('the free allowance belongs to the workspace', () => {
  test('two free people in one workspace draw from the same count', async () => {
    const convex = convexTest(schema, modules)
    await setActiveWorkspace(convex, 'alice', 'ws-team')
    await setActiveWorkspace(convex, 'bob', 'ws-team')
    await turn(convex, 'alice', 9)
    await turn(convex, 'bob', 6)
    expect(await used(convex, 'alice')).toBe(15)
    expect(await used(convex, 'bob')).toBe(15)
    await expect(turn(convex, 'alice')).rejects.toThrow(/weekly ask limit/)
    await expect(turn(convex, 'bob')).rejects.toThrow(/weekly ask limit/)
  })

  test('the same person has a separate allowance in each workspace', async () => {
    const convex = convexTest(schema, modules)
    await setActiveWorkspace(convex, 'alice', 'ws-one')
    await turn(convex, 'alice', 15)
    await expect(turn(convex, 'alice')).rejects.toThrow(/weekly ask limit/)
    await convex.run(async (ctx) => {
      const preference = await ctx.db.query('workspaceUserPreferences').first()
      await ctx.db.patch(preference!._id, { activeWorkspaceId: 'ws-two' })
    })
    expect(await used(convex, 'alice')).toBe(0)
    await turn(convex, 'alice', 3)
    expect(await used(convex, 'alice')).toBe(3)
  })

  test('someone with no active workspace is counted on their own, as before', async () => {
    const convex = convexTest(schema, modules)
    await turn(convex, 'carol', 4)
    expect(await used(convex, 'carol')).toBe(4)
    const rows = await convex.run(async (ctx) => await ctx.db.query('dailyUsage').collect())
    expect(rows.map((row) => row.userId)).toEqual(['carol'])
  })

  test('a paid person is not held to the free count, and is counted under their own id', async () => {
    const convex = convexTest(schema, modules)
    await setActiveWorkspace(convex, 'dana', 'ws-team')
    await convex.run(async (ctx) => {
      await ctx.db.insert('subscriptions', {
        userId: 'dana', tier: 'pro', planKind: 'paid', status: 'active', creditsUsed: 0,
      })
    })
    await turn(convex, 'dana', 20)
    const rows = await convex.run(async (ctx) => await ctx.db.query('dailyUsage').collect())
    expect(rows.map((row) => row.userId)).toEqual(['dana'])
    // Dana's usage did not touch the workspace's free allowance, which a free teammate still has in full.
    await setActiveWorkspace(convex, 'erin', 'ws-team')
    expect(await used(convex, 'erin')).toBe(0)
  })
})
