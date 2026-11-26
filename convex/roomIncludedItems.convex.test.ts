import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'room-included-items-test'
const mutation = (path: string) => makeFunctionReference<'mutation'>(path)
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

test('a room message keeps the Personal items its author included, at most ten', async () => {
  const t = convexTest(schema, modules)
  const conversationId = await t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'WS', slug: 'ws', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'human', workspaceId: 'ws', type: 'human', userId: 'owner', displayName: 'Owner', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'm', workspaceId: 'ws', principalId: 'human', role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    const id = await ctx.db.insert('conversations', { userId: 'owner', workspaceId: 'ws', conversationType: 'channel', title: 'Room',
      lastModified: now, createdAt: now, updatedAt: now, lastMode: 'act', askModelIds: [], actModelId: 'model' })
    await ctx.db.insert('conversationParticipants', { conversationId: id, workspaceId: 'ws', principalId: 'human', principalType: 'human',
      role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now })
    return id
  })
  const includedItems = Array.from({ length: 12 }, (_, i) => ({ type: 'file' as const, id: `f_${i}`, name: `Note ${i}` }))
  const messageId = await t.mutation(mutation('collaboration/directMessages:addMessage'), {
    actorUserId: 'owner', conversationId, workspaceId: 'ws', serverSecret: secret,
    turnId: 't', content: 'see @Note 0', includedItems,
  })
  const plain = await t.mutation(mutation('collaboration/directMessages:addMessage'), {
    actorUserId: 'owner', conversationId, workspaceId: 'ws', serverSecret: secret, turnId: 't2', content: 'hi',
  })
  await t.run(async ctx => {
    const stored = await ctx.db.get(messageId as never) as { includedItems?: unknown[] } | null
    expect(stored?.includedItems).toHaveLength(10)
    const other = await ctx.db.get(plain as never) as { includedItems?: unknown[] } | null
    expect(other?.includedItems).toBeUndefined()
  })
})
