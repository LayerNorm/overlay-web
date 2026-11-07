import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const bundle = makeFunctionReference<'query'>('agents/threads:bundle')
const archived = makeFunctionReference<'query'>('agents/threads:archived')
const resolveMain = makeFunctionReference<'mutation'>('agents/threads:resolveMain')
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
