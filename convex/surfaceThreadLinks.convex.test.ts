import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'surface-thread-links-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const ensure = makeFunctionReference<'mutation'>('surfaces/surfaces:ensureSurfaceConversation')

async function fixture() {
  const convex = convexTest(schema, modules)
  await convex.run(async ctx => {
    for (const [id, team] of [['connection', 'T'], ['other', 'T2']]) {
      await ctx.db.insert('surfaceConnections', { id: id!, externalTeamId: team!, platform: 'slack', workspaceId: 'workspace',
        status: 'active', installedByUserId: 'alice', createdAt: 1, updatedAt: 1 })
    }
    for (const [id, connectionId, channelId, agentId] of [
      ['original', 'connection', 'C', 'first'], ['rebound', 'connection', 'C', 'second'],
      ['channel', 'connection', 'C2', 'first'], ['team', 'other', 'C', 'first'],
    ]) {
      await ctx.db.insert('surfaceBindings', { id: id!, connectionId: connectionId!, channelId: channelId!, agentId: agentId!,
        channelName: 'general', status: 'active', createdByUserId: 'alice', createdAt: 1, updatedAt: 1 })
    }
  })
  const input = { serverSecret: secret, userId: 'alice', workspaceId: 'workspace', title: 'Thread',
    askModelIds: [], actModelId: 'openrouter/free', conversationType: 'channel' as const,
    externalPlatform: 'slack', externalChannelId: 'C', externalThreadId: 'thread', surfaceBindingId: 'original' }
  return { convex, input }
}

test('thread replay and rebinding reuse one conversation, scoped to connection, team, channel and thread', async () => {
  const { convex, input } = await fixture()
  const original = await convex.mutation(ensure, input)
  expect(await convex.mutation(ensure, input)).toBe(original)
  expect(await convex.mutation(ensure, { ...input, surfaceBindingId: 'rebound' })).toBe(original)
  const others = await Promise.all([
    convex.mutation(ensure, { ...input, externalThreadId: 'other-thread' }),
    convex.mutation(ensure, { ...input, surfaceBindingId: 'channel', externalChannelId: 'C2' }),
    convex.mutation(ensure, { ...input, surfaceBindingId: 'team' }),
  ])
  expect(new Set([original, ...others]).size).toBe(4)
  await expect(convex.mutation(ensure, { ...input, workspaceId: 'other-workspace' })).rejects.toThrow('SURFACE_THREAD_SCOPE_DENIED')
  await expect(convex.mutation(ensure, { ...input, externalChannelId: 'forged' })).rejects.toThrow('SURFACE_THREAD_SCOPE_DENIED')
  await convex.run(async ctx => {
    const links = await ctx.db.query('surfaceThreadLinks').collect()
    expect(links).toHaveLength(4)
    expect(links.find(link => link.conversationId === original)).toMatchObject({ connectionId: 'connection', externalTeamId: 'T', originalBindingId: 'original' })
    const connection = await ctx.db.query('surfaceConnections').withIndex('by_entityId', q => q.eq('id', 'connection')).unique()
    await ctx.db.patch(connection!._id, { externalTeamId: 'new-team' })
  })
  expect(await convex.mutation(ensure, input)).not.toBe(original)
})

test('adopts an unambiguous legacy thread across old bindings and refuses ambiguous history without unioning participants', async () => {
  const { convex, input } = await fixture()
  const legacy = await convex.run(async ctx => ctx.db.insert('conversations', {
    userId: 'alice', workspaceId: 'workspace', title: 'Legacy', lastModified: 1, createdAt: 1, updatedAt: 1,
    lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free', conversationType: 'channel',
    externalPlatform: 'slack', externalChannelId: 'C', externalThreadId: 'thread', surfaceBindingId: 'original',
  }))
  expect(await convex.mutation(ensure, { ...input, surfaceBindingId: 'rebound' })).toBe(legacy)
  await convex.run(async ctx => {
    for (const surfaceBindingId of ['original', 'rebound']) {
      await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'workspace', title: 'Ambiguous',
        lastModified: 1, createdAt: 1, updatedAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free',
        externalPlatform: 'slack', externalChannelId: 'C', externalThreadId: 'ambiguous', surfaceBindingId })
    }
  })
  await expect(convex.mutation(ensure, { ...input, externalThreadId: 'ambiguous' })).rejects.toThrow('SURFACE_THREAD_LEGACY_AMBIGUOUS')
  await convex.run(async ctx => {
    expect(await ctx.db.query('surfaceThreadLinks').collect()).toHaveLength(1)
    expect(await ctx.db.query('conversationParticipants').collect()).toHaveLength(0)
    await ctx.db.patch(legacy, { deletedAt: Date.now() })
  })
  const replacement = await convex.mutation(ensure, input)
  expect(replacement).not.toBe(legacy)
  expect(await convex.mutation(ensure, { ...input, surfaceBindingId: 'rebound' })).toBe(replacement)
  await convex.run(async ctx => {
    expect((await ctx.db.get(legacy))?.deletedAt).toBeDefined()
    expect(await ctx.db.query('surfaceThreadLinks').collect()).toHaveLength(1)
  })
})
