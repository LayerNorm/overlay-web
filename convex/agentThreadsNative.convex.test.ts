import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from 'convex/values'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const bundle = makeFunctionReference<'query'>('agents/threads:bundle')
const archived = makeFunctionReference<'query'>('agents/threads:archived')
const resolveMain = makeFunctionReference<'mutation'>('agents/threads:resolveMain')
const resolveLatestActivity = makeFunctionReference<'mutation'>('agents/threads:resolveLatestActivity')
const create = makeFunctionReference<'mutation'>('agents/threads:create')
const setArchived = makeFunctionReference<'mutation'>('agents/threads:setArchived')
const remove = makeFunctionReference<'mutation'>('agents/threads:remove')

type Bundle = { threads: Array<{ conversationId: string; isMain: boolean; archivedAt?: number }> } | null

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'other', kind: 'organization', name: 'Other', slug: 'other', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    for (const [agentId, visibility] of [['shared', 'workspace'], ['private', 'creator']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `ap-${agentId}`, agentId, type: 'agent', displayName: agentId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId: 'ws', principalId: `ap-${agentId}`, name: agentId, instructions: 'Help.', harness: 'overlay',
        modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', visibility, createdByPrincipalId: 'p-alice', createdAt: 1, updatedAt: 1,
      } as never)
    }
  })
  return { t, as: (subject: string) => t.withIdentity({ subject }) }
}

const shared = { workspaceId: 'ws', agentId: 'shared' }

test('opening an agent resolves one main thread, even when asked twice', async () => {
  const { as } = await fixture()
  const [first, second] = await Promise.all([
    as('alice').mutation(resolveMain, shared),
    as('alice').mutation(resolveMain, shared),
  ]) as Array<{ conversationId: string }>
  expect(second!.conversationId).toBe(first!.conversationId)
  const threads = (await as('alice').query(bundle, shared) as Bundle)!.threads
  expect(threads).toHaveLength(1)
  expect(threads[0]).toMatchObject({ conversationId: first!.conversationId, isMain: true })
  // Bob gets his own main thread with the same agent, and never sees Alice's.
  const bobs = await as('bob').mutation(resolveMain, shared) as { conversationId: string }
  expect(bobs.conversationId).not.toBe(first!.conversationId)
  expect((await as('bob').query(bundle, shared) as Bundle)!.threads.map(row => row.conversationId)).toEqual([bobs.conversationId])
})

test('implicit Agents landing selects latest activity without changing main-thread ordering', async () => {
  const { t, as } = await fixture()
  const oldest = await as('alice').mutation(resolveMain, shared) as { conversationId: string }
  const recent = await as('alice').mutation(create, { ...shared, title: 'Recent' }) as { conversationId: string }
  await t.run(async ctx => {
    await ctx.db.patch(oldest.conversationId as Id<'conversations'>, { createdAt: 1, lastModified: 10 })
    await ctx.db.patch(recent.conversationId as Id<'conversations'>, { createdAt: 2, lastModified: 20 })
  })

  const landed = await as('alice').mutation(resolveLatestActivity, shared) as { conversationId: string }
  const main = await as('alice').mutation(resolveMain, shared) as { conversationId: string }
  const threads = (await as('alice').query(bundle, shared) as Bundle)!.threads
  expect(landed.conversationId).toBe(recent.conversationId)
  expect(main.conversationId).toBe(oldest.conversationId)
  expect(threads.find(row => row.isMain)?.conversationId).toBe(oldest.conversationId)

  await t.run(async ctx => {
    await ctx.db.patch(oldest.conversationId as Id<'conversations'>, { lastModified: 30 })
  })
  const reactivated = await as('alice').mutation(resolveLatestActivity, shared) as { conversationId: string }
  const updatedThreads = (await as('alice').query(bundle, shared) as Bundle)!.threads
  expect(reactivated.conversationId).toBe(oldest.conversationId)
  expect(updatedThreads.find(row => row.isMain)?.conversationId).toBe(oldest.conversationId)
})

test('implicit landing skips archived, deleted, automation, and another member’s newer threads', async () => {
  const { t, as } = await fixture()
  const oldest = await as('alice').mutation(resolveMain, shared) as { conversationId: string }
  const recent = await as('alice').mutation(create, { ...shared, title: 'Recent' }) as { conversationId: string }
  const archivedThread = await as('alice').mutation(create, { ...shared, title: 'Archived' }) as { conversationId: string }
  const deletedThread = await as('alice').mutation(create, { ...shared, title: 'Deleted' }) as { conversationId: string }
  const automationThread = await as('alice').mutation(create, { ...shared, title: 'Automation' }) as { conversationId: string }
  const anotherMember = await as('bob').mutation(resolveMain, shared) as { conversationId: string }
  await as('alice').mutation(setArchived, { ...shared, conversationId: archivedThread.conversationId, archived: true })
  await t.run(async ctx => {
    await ctx.db.patch(oldest.conversationId as Id<'conversations'>, { createdAt: 1, lastModified: 100 })
    await ctx.db.patch(recent.conversationId as Id<'conversations'>, { createdAt: 2, lastModified: 200 })
    await ctx.db.patch(archivedThread.conversationId as Id<'conversations'>, { createdAt: 3, lastModified: 300 })
    await ctx.db.patch(deletedThread.conversationId as Id<'conversations'>, { createdAt: 4, lastModified: 400, deletedAt: 400 })
    await ctx.db.patch(automationThread.conversationId as Id<'conversations'>, { createdAt: 5, lastModified: 500, isAutomation: true })
    await ctx.db.patch(anotherMember.conversationId as Id<'conversations'>, { createdAt: 6, lastModified: 600 })
  })

  const landed = await as('alice').mutation(resolveLatestActivity, shared) as { conversationId: string }
  expect(landed.conversationId).toBe(recent.conversationId)
})

test('implicit landing creates a fresh thread when no active thread or legacy DM exists', async () => {
  const { as } = await fixture()
  const first = await as('alice').mutation(resolveLatestActivity, shared) as { conversationId: string; title: string }
  const second = await as('alice').mutation(resolveLatestActivity, shared) as { conversationId: string; title: string }

  expect(first.title).toBe('shared')
  expect(second.conversationId).toBe(first.conversationId)
})

test('implicit landing adopts an eligible legacy DM when no agent thread exists', async () => {
  const { t, as } = await fixture()
  const legacyConversationId = await t.run(async ctx => {
    const now = 1
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'alice', workspaceId: 'ws', conversationType: 'dm', dmIdentityKey: 'ap-shared:p-alice',
      title: 'Legacy DM', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'model',
    })
    for (const [principalId, principalType] of [['p-alice', 'human'], ['ap-shared', 'agent']] as const) {
      await ctx.db.insert('conversationParticipants', {
        conversationId, workspaceId: 'ws', principalId, principalType, role: 'member', status: 'active',
        notificationLevel: 'all', joinedAt: now, updatedAt: now,
      })
    }
    return conversationId
  })

  const landed = await as('alice').mutation(resolveLatestActivity, shared) as { conversationId: string; title: string }
  const adopted = await t.run(ctx => ctx.db.get(legacyConversationId))
  expect(landed).toEqual({ conversationId: legacyConversationId, title: 'Legacy DM' })
  expect(adopted?.agentId).toBe('shared')
})

test('a creator-only agent and its threads are invisible to other members', async () => {
  const { as } = await fixture()
  const args = { workspaceId: 'ws', agentId: 'private' }
  await as('alice').mutation(resolveMain, args)
  expect(await as('bob').query(bundle, args)).toBeNull()
  await expect(as('bob').mutation(resolveMain, args)).rejects.toThrow('AGENT_NOT_FOUND')
  await expect(as('bob').mutation(create, args)).rejects.toThrow('AGENT_NOT_FOUND')
  expect(await as('alice').query(bundle, { workspaceId: 'other', agentId: 'shared' })).toBeNull()
})

test('archive and Undo move a thread in and out of Archived, and the main pointer follows', async () => {
  const { as } = await fixture()
  const main = await as('alice').mutation(resolveMain, shared) as { conversationId: string }
  const extra = await as('alice').mutation(create, { ...shared, title: 'Second' }) as { conversationId: string }
  await as('alice').mutation(setArchived, { ...shared, conversationId: main.conversationId, archived: true })
  let threads = (await as('alice').query(bundle, shared) as Bundle)!.threads
  expect(threads.find(row => row.conversationId === extra.conversationId)?.isMain).toBe(true)
  expect((await as('alice').query(archived, { workspaceId: 'ws' }) as Array<{ conversationId: string }>).map(row => row.conversationId))
    .toEqual([main.conversationId])
  await as('alice').mutation(setArchived, { ...shared, conversationId: main.conversationId, archived: false })
  threads = (await as('alice').query(bundle, shared) as Bundle)!.threads
  expect(threads.find(row => row.conversationId === main.conversationId)?.isMain).toBe(true)
  await expect(as('bob').mutation(setArchived, { ...shared, conversationId: main.conversationId, archived: true }))
    .rejects.toThrow('THREAD_ACCESS_DENIED')
})

test('the last active thread cannot be deleted, and a thread in another workspace is refused', async () => {
  const { as } = await fixture()
  const main = await as('alice').mutation(resolveMain, shared) as { conversationId: string }
  await expect(as('alice').mutation(remove, { ...shared, conversationId: main.conversationId })).rejects.toThrow('AGENT_LAST_THREAD')
  const extra = await as('alice').mutation(create, shared) as { conversationId: string }
  await as('alice').mutation(remove, { ...shared, conversationId: extra.conversationId })
  expect((await as('alice').query(bundle, shared) as Bundle)!.threads).toHaveLength(1)
  await expect(as('alice').mutation(remove, { workspaceId: 'other', agentId: 'shared', conversationId: main.conversationId }))
    .rejects.toThrow()
})
