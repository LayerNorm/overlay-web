import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'rename-secret'
const now = 1_900_000_000_000
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const rename = makeFunctionReference<'mutation'>('migrations/renameGenericWorkspaces:renameGenericWorkspacesByServer')

test('stand-in workspace names become "<name>’s workspace"; chosen names and organizations are untouched; a dry run changes nothing', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    const add = async (workspaceId: string, kind: 'personal' | 'organization', name: string, owner?: { userId: string; displayName: string; email?: string }) => {
      await ctx.db.insert('workspaces', {
        workspaceId, kind, name, slug: workspaceId, status: 'active', createdAt: now, updatedAt: now,
        ...(owner ? { personalOwnerUserId: owner.userId } : {}),
      })
      if (owner) await ctx.db.insert('workspacePrincipals', { principalId: `p-${workspaceId}`, workspaceId, type: 'human', userId: owner.userId, displayName: owner.displayName, email: owner.email, createdAt: now, updatedAt: now })
    }
    await add('w1', 'personal', 'Personal', { userId: 'u1', displayName: 'Maya Chen' })
    await add('w2', 'personal', 'Personal’s workspace', { userId: 'u2', displayName: 'Personal', email: 'sam.ortiz@example.com' })
    await add('w3', 'personal', 'My studio', { userId: 'u3', displayName: 'Lee Park' })
    await add('w4', 'organization', 'Personal')
    await add('w5', 'personal', 'Personal')
  })
  const run = (dryRun: boolean) => convex.mutation(rename, { serverSecret: secret, dryRun, paginationOpts: { numItems: 100, cursor: null } }) as Promise<{ changes: Array<{ workspaceId: string; from: string; to: string }> }>
  const names = async () => (await convex.run(async (ctx) => (await ctx.db.query('workspaces').collect()).map((w) => [w.workspaceId, w.name]))).sort()

  const dry = await run(true)
  expect(dry.changes.map((c) => [c.workspaceId, c.to]).sort()).toEqual([['w1', 'Maya’s workspace'], ['w2', 'Sam’s workspace'], ['w5', 'My workspace']])
  expect((await names()).map(([, name]) => name)).toEqual(['Personal', 'Personal’s workspace', 'My studio', 'Personal', 'Personal'])

  await run(false)
  expect(await names()).toEqual([['w1', 'Maya’s workspace'], ['w2', 'Sam’s workspace'], ['w3', 'My studio'], ['w4', 'Personal'], ['w5', 'My workspace']])
  expect((await run(false)).changes).toEqual([])
})
