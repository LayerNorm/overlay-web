import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('knowledge/memoryBrowse:list')

type Row = { memoryId: string; content: string; creatorName: string; canDelete: boolean }

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob', 'left']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', {
        workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member',
        status: userId === 'left' ? 'suspended' : 'active', joinedAt: 1, updatedAt: 1,
      } as never)
    }
    const agent = async (agentId: string, visibility: 'workspace' | 'creator') => {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `ap-${agentId}`, agentId, type: 'agent', displayName: agentId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId: 'ws', principalId: `ap-${agentId}`, name: `Agent ${agentId}`, instructions: 'Help.', harness: 'overlay',
        modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice', visibility, createdAt: 1, updatedAt: 1,
      } as never)
    }
    await agent('shared', 'workspace')
    await agent('private', 'creator')
    const memory = (userId: string, content: string, fields: Record<string, unknown> = {}) => ctx.db.insert('memories', {
      workspaceId: 'ws', userId, content, source: 'manual', createdAt: 1, ...fields,
    } as never)
    await memory('alice', 'alice shared')
    await memory('alice', 'alice private', { visibility: 'owner' })
    await memory('bob', 'bob shared')
    await memory('left', 'from a former member')
    await memory('agent-memory:shared', 'shared agent fact')
    await memory('agent-memory:private', 'private agent fact')
    await memory('alice', 'deleted', { deletedAt: 2 })
    await ctx.db.insert('memories', { workspaceId: 'elsewhere', userId: 'alice', content: 'other workspace', source: 'manual', createdAt: 1 } as never)
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as }
}

const byContent = (rows: unknown) => new Map((rows as Row[]).map(row => [row.content, row]))

test('members see shared memories plus their own owner-only ones, attributed as they may know them', async () => {
  const { as } = await fixture()
  const alice = byContent(await as('alice').query(list, { workspaceId: 'ws' }))
  expect([...alice.keys()].sort()).toEqual(['alice private', 'alice shared', 'bob shared', 'from a former member', 'private agent fact', 'shared agent fact'])
  expect(alice.get('alice shared')).toMatchObject({ creatorName: 'alice', canDelete: true })
  expect(alice.get('bob shared')).toMatchObject({ creatorName: 'bob', canDelete: false })
  expect(alice.get('from a former member')?.creatorName).toBe('Former member')
  expect(alice.get('private agent fact')?.creatorName).toBe('Agent private')
  expect(alice.get('shared agent fact')).toMatchObject({ creatorName: 'Agent shared', canDelete: true })

  const bob = byContent(await as('bob').query(list, { workspaceId: 'ws' }))
  expect(bob.has('alice private')).toBe(false)
  // Bob cannot see the creator-only agent, so its name is not revealed to him.
  expect(bob.get('private agent fact')?.creatorName).toBe('Former member')
})

test('the list narrows to one member or visible agent', async () => {
  const { as } = await fixture()
  const contents = async (subject: string, ownerPrincipalId: string) =>
    (await as(subject).query(list, { workspaceId: 'ws', ownerPrincipalId }) as Row[]).map(row => row.content).sort()
  expect(await contents('bob', 'p-alice')).toEqual(['alice shared'])
  expect(await contents('alice', 'p-alice')).toEqual(['alice private', 'alice shared'])
  expect(await contents('bob', 'ap-shared')).toEqual(['shared agent fact'])
  expect(await contents('bob', 'ap-private')).toEqual([])
  expect(await contents('alice', 'unknown')).toEqual([])
})

test('outsiders and signed-out callers read nothing', async () => {
  const { t, as } = await fixture()
  expect(await as('stranger').query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await as('left').query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(list, { workspaceId: 'ws' })).toBeNull()
})
