import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const connect = makeFunctionReference<'mutation'>('sync/links:connect')
const disconnect = makeFunctionReference<'mutation'>('sync/links:disconnect')
const setAutoLink = makeFunctionReference<'mutation'>('sync/links:setAutoLink')
const linkChannel = makeFunctionReference<'mutation'>('sync/links:linkChannel')
const updateLinkState = makeFunctionReference<'mutation'>('sync/links:updateLinkState')
const take = makeFunctionReference<'mutation'>('sync/rateBudgets:take')
const block = makeFunctionReference<'mutation'>('sync/rateBudgets:block')
const claimWork = makeFunctionReference<'mutation'>('sync/history:claimWork')
const updateWork = makeFunctionReference<'mutation'>('sync/history:updateWork')
const markCatchingUp = makeFunctionReference<'mutation'>('sync/history:markCatchingUp')
const prioritize = makeFunctionReference<'mutation'>('sync/history:prioritize')
const channelCreated = makeFunctionReference<'mutation'>('sync/autoLink:channelCreated')

const serverSecret = 'sync-test-secret'
process.env.INTERNAL_API_SECRET = serverSecret

afterEach(() => { vi.useRealTimers() })

type Work = { mode: 'history' | 'repair'; link: { linkId: string; workspaceId: string; externalChannelId: string } }

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    for (const workspaceId of ['ws1', 'ws2', 'ws3']) {
      await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: workspaceId, slug: workspaceId, status: 'active', createdAt: 1, updatedAt: 1 })
      for (const [userId, role] of [['owner', 'owner'], ['member', 'member']] as const) {
        const principalId = workspaceId + '-' + userId
        await ctx.db.insert('workspacePrincipals', { workspaceId, principalId, userId, type: 'human', displayName: userId, email: userId + '@' + workspaceId + '.test', createdAt: 1, updatedAt: 1 })
        await ctx.db.insert('workspaceMemberships', { workspaceId, principalId, membershipId: 'm-' + principalId, role, status: 'active', joinedAt: 1, updatedAt: 1 })
      }
    }
  })
  for (const workspaceId of ['ws1', 'ws2', 'ws3']) {
    await t.mutation(connect, { serverSecret, actorUserId: 'owner', workspaceId, provider: 'slack', externalOrgId: 'T-' + workspaceId })
  }
  const link = async (workspaceId: string, channelId: string) => await t.mutation(linkChannel, {
    serverSecret, actorUserId: 'owner', workspaceId, provider: 'slack', externalChannelId: channelId, externalChannelName: channelId, externalChannelKind: 'public',
  }) as { linkId: string; conversationId: string }
  return { t, link }
}

const budget = { serverSecret, key: 'slack:T1:conversations.history', capacity: 1, refillPerMinute: 1 }

test('the bucket refills over time and Retry-After holds every priority', async () => {
  const { t } = await fixture()
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  expect(await t.mutation(take, { ...budget, priority: 'history' })).toEqual({ granted: true, waitMs: 0 })
  expect(await t.mutation(take, { ...budget, priority: 'history' })).toMatchObject({ granted: false, waitMs: 60_000 })
  vi.setSystemTime(1_060_000)
  expect(await t.mutation(take, { ...budget, priority: 'history' })).toMatchObject({ granted: true })
  await t.mutation(block, { ...budget, retryAfterMs: 120_000 })
  vi.setSystemTime(1_120_000)
  expect(await t.mutation(take, { ...budget, priority: 'live' })).toMatchObject({ granted: false, waitMs: 60_000 })
  vi.setSystemTime(1_180_001)
  expect(await t.mutation(take, { ...budget, priority: 'live' })).toMatchObject({ granted: true })
})

test('a denied repair or outbound call reserves the next token so history cannot starve it', async () => {
  const { t } = await fixture()
  vi.useFakeTimers()
  vi.setSystemTime(2_000_000)
  await t.mutation(take, { ...budget, priority: 'history' })
  expect(await t.mutation(take, { ...budget, priority: 'repair' })).toMatchObject({ granted: false })
  vi.setSystemTime(2_060_000)
  expect(await t.mutation(take, { ...budget, priority: 'history' })).toMatchObject({ granted: false })
  expect(await t.mutation(take, { ...budget, priority: 'repair' })).toMatchObject({ granted: true })
  vi.setSystemTime(2_120_000)
  expect(await t.mutation(take, { ...budget, priority: 'history' })).toMatchObject({ granted: true })
})

test('claimWork leases one link per workspace, honours the cap and skips busy workspaces', async () => {
  const { t, link } = await fixture()
  await link('ws1', 'C1')
  await link('ws1', 'C2')
  await link('ws2', 'C3')
  await link('ws3', 'C4')
  const first = await t.mutation(claimWork, { serverSecret, maxWorkspaces: 2 }) as Work[]
  expect(first.map(item => item.mode)).toEqual(['history', 'history'])
  expect(new Set(first.map(item => item.link.workspaceId)).size).toBe(2)
  const second = await t.mutation(claimWork, { serverSecret, maxWorkspaces: 2 }) as Work[]
  expect(second).toEqual([])
  const third = await t.mutation(claimWork, { serverSecret, maxWorkspaces: 3 }) as Work[]
  expect(third.map(item => item.link.workspaceId)).toEqual(['ws3'])
  for (const item of [...first, ...third]) await t.mutation(updateWork, { serverSecret, linkId: item.link.linkId, release: true })
  const again = await t.mutation(claimWork, { serverSecret, maxWorkspaces: 3 }) as Work[]
  expect(again).toHaveLength(3)
})

test('the channel a member scrolls in goes first, and only members can raise it', async () => {
  const { t, link } = await fixture()
  await link('ws1', 'C1')
  const later = await link('ws1', 'C2')
  await expect(t.mutation(prioritize, { workspaceId: 'ws1', conversationId: later.conversationId })).rejects.toThrow('UNAUTHENTICATED')
  await expect(t.withIdentity({ subject: 'stranger' }).mutation(prioritize, { workspaceId: 'ws1', conversationId: later.conversationId })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await t.withIdentity({ subject: 'member' }).mutation(prioritize, { workspaceId: 'ws1', conversationId: later.conversationId })
  const work = await t.mutation(claimWork, { serverSecret }) as Work[]
  expect(work.map(item => item.link.externalChannelId)).toEqual(['C2'])
})

test('a finished import starts syncing with its first repair due, unless it was paused meanwhile', async () => {
  const { t, link } = await fixture()
  const done = await link('ws1', 'C1')
  const paused = await link('ws2', 'C2')
  await t.mutation(disconnect, { serverSecret, actorUserId: 'owner', workspaceId: 'ws2', provider: 'slack' })
  await t.mutation(updateLinkState, { serverSecret, linkId: done.linkId, historyCursor: null, historyCompletedAt: 5, historyOldestAt: 4 })
  await t.mutation(updateWork, { serverSecret, linkId: done.linkId, completeHistory: true, release: true })
  await t.mutation(updateWork, { serverSecret, linkId: paused.linkId, completeHistory: true, release: true })
  const rows = await t.run(async ctx => [await ctx.db.get(done.linkId as never), await ctx.db.get(paused.linkId as never)]) as Array<{ status: string }>
  expect(rows.map(row => row.status)).toEqual(['syncing', 'paused'])
  const work = await t.mutation(claimWork, { serverSecret }) as Work[]
  expect(work).toEqual([expect.objectContaining({ mode: 'repair', link: expect.objectContaining({ externalChannelId: 'C1' }) })])
})

test('repair runs once per night and goes before history in the same workspace', async () => {
  const { t, link } = await fixture()
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 10, 12, 12))
  const syncing = await link('ws1', 'C1')
  await link('ws1', 'C2')
  await t.mutation(updateWork, { serverSecret, linkId: syncing.linkId, completeHistory: true })
  expect((await t.mutation(claimWork, { serverSecret }) as Work[])[0]?.mode).toBe('repair')
  await t.mutation(updateWork, { serverSecret, linkId: syncing.linkId, repairedAt: Date.now(), release: true })
  const history = await t.mutation(claimWork, { serverSecret }) as Work[]
  expect(history.map(item => [item.mode, item.link.externalChannelId])).toEqual([['history', 'C2']])
  await t.mutation(updateWork, { serverSecret, linkId: history[0]!.link.linkId, release: true })
  vi.setSystemTime(Date.UTC(2026, 10, 13, 9, 59))
  expect((await t.mutation(claimWork, { serverSecret }) as Work[])[0]?.mode).toBe('history')
  await t.mutation(updateWork, { serverSecret, linkId: history[0]!.link.linkId, release: true })
  vi.setSystemTime(Date.UTC(2026, 10, 13, 10, 1))
  expect((await t.mutation(claimWork, { serverSecret }) as Work[])[0]?.mode).toBe('repair')
})

test('app_rate_limited marks live links catching up, and they resume with a repair once the window passes', async () => {
  const { t, link } = await fixture()
  vi.useFakeTimers()
  vi.setSystemTime(3_000_000)
  const syncing = await link('ws1', 'C1')
  const importing = await link('ws1', 'C2')
  await t.mutation(updateWork, { serverSecret, linkId: syncing.linkId, completeHistory: true, repairedAt: 3_000_000 })
  await t.mutation(updateLinkState, { serverSecret, linkId: syncing.linkId, historyCompletedAt: 3_000_000 })
  expect(await t.mutation(markCatchingUp, { serverSecret, provider: 'slack', externalOrgId: 'T-ws1', catchUpUntil: 3_060_000 })).toBe(2)
  const states = async () => await t.run(async ctx => [await ctx.db.get(syncing.linkId as never), await ctx.db.get(importing.linkId as never)]) as Array<{ status: string; repairedAt?: number }>
  expect((await states()).map(row => row.status)).toEqual(['catching_up', 'catching_up'])
  expect(await t.mutation(claimWork, { serverSecret })).toEqual([])
  vi.setSystemTime(3_060_001)
  const work = await t.mutation(claimWork, { serverSecret }) as Work[]
  expect((await states()).map(row => [row.status, row.repairedAt])).toEqual([['syncing', undefined], ['history', undefined]])
  expect(work.map(item => item.mode)).toEqual(['repair'])
})

test('auto-link links new public channels only when the connection has it on', async () => {
  const { t } = await fixture()
  const created = { serverSecret, provider: 'slack', externalOrgId: 'T-ws1', externalChannelId: 'C77', externalChannelName: 'launch-room' }
  expect(await t.mutation(channelCreated, created)).toBeNull()
  await t.mutation(setAutoLink, { serverSecret, actorUserId: 'owner', workspaceId: 'ws1', provider: 'slack', enabled: true })
  const linked = await t.mutation(channelCreated, created) as { conversationId: string }
  const conversation = await t.run(async ctx => await ctx.db.get(linked.conversationId as never)) as { channelSlug: string; channelVisibility: string; workspaceId: string }
  expect([conversation.workspaceId, conversation.channelSlug, conversation.channelVisibility]).toEqual(['ws1', 'launch-room', 'public'])
  expect(await t.mutation(channelCreated, created)).toBeNull()
  await t.run(async ctx => {
    const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'ws1').eq('principalId', 'ws1-owner')).unique()
    await ctx.db.patch(membership!._id, { role: 'member' })
  })
  expect(await t.mutation(channelCreated, { ...created, externalChannelId: 'C78' })).toBeNull()
})
