import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const run = makeFunctionReference<'mutation'>('migrations/removeDaytonaData:run')

describe('Daytona data cleanup', () => {
  test('empties both tables in bounded batches and reports when done', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      for (let index = 0; index < 5; index += 1) {
        await ctx.db.insert('daytonaUsageLedger', {
          userId: 'user_1', sandboxId: `s${index}`, tier: 'pro', resourceProfile: 'pro',
          startedAt: 1, endedAt: 2, durationSeconds: 1, cpu: 1, memoryGiB: 1, diskGiB: 1,
          costUsd: 0, costCents: 0, reason: 'stop', createdAt: index,
        } as never)
      }
      await ctx.db.insert('daytonaWorkspaces', {
        userId: 'user_1', sandboxId: 's', sandboxName: 'n', volumeId: 'v', volumeName: 'vn', tier: 'pro',
        state: 'stopped', resourceProfile: 'pro', mountPath: '/x', createdAt: 1, updatedAt: 1,
      })
    })
    expect(await convex.mutation(run as never, { batch: 4 } as never)).toEqual({ deleted: 4, done: false })
    expect(await convex.mutation(run as never, { batch: 4 } as never)).toEqual({ deleted: 2, done: true })
    const remaining = await convex.run(async (ctx) => (await ctx.db.query('daytonaUsageLedger').collect()).length
      + (await ctx.db.query('daytonaWorkspaces').collect()).length)
    expect(remaining).toBe(0)
  })
})
