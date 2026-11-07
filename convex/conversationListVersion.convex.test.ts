import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const listVersion = makeFunctionReference<'query'>('collaboration/activity:listVersion')

async function setup() {
  const convex = convexTest(schema, modules)
  const conversationId = await convex.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'workspace', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { principalId: 'principal', workspaceId: 'workspace',
      userId: 'user', type: 'human', displayName: 'Test', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'membership', principalId: 'principal', workspaceId: 'workspace',
      role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
    return ctx.db.insert('conversations', { userId: 'user', workspaceId: 'workspace',
      title: 'Test', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'test' })
  })
  const user = convex.withIdentity({ subject: 'user' })
  const read = () => user.query(listVersion, { workspaceId: 'workspace' }) as Promise<number | null>
  const insert = (type: string, workspaceId = 'workspace', userId = 'user', count = 1) => convex.run(async ctx => {
    for (let i = 0; i < count; i++) await ctx.db.insert('conversationEvents', {
      conversationId, workspaceId, userId, type, createdAt: Date.now(),
    })
  })
  return { convex, user, read, insert }
}

describe('room list invalidation', () => {
  test('long text streams never advance or regress the list version; semantic events do', async () => {
    const { read, insert } = await setup()
    expect(await read()).toBe(0)
    for (const type of ['conversation.created', 'conversation.updated', 'message.created',
      'message.completed', 'message.failed', 'conversation.deleted']) {
      const previous = await read()
      await insert(type)
      const next = await read()
      expect(next!).toBeGreaterThan(previous!)
      await insert('message.delta', 'workspace', 'user', 500)
      expect(await read()).toBe(next)
    }
  })

  test('the version is scoped to the workspace and requires membership', async () => {
    const { convex, user, read, insert } = await setup()
    await insert('message.created', 'foreign-workspace', 'foreign-user')
    expect(await read()).toBe(0)
    await insert('message.completed', 'workspace', 'foreign-user')
    expect(await read()).toBeGreaterThan(0)
    expect(await user.query(listVersion, { workspaceId: 'foreign-workspace' })).toBeNull()
    expect(await convex.query(listVersion, { workspaceId: 'workspace' })).toBeNull()
  })
})
