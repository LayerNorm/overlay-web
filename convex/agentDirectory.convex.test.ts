import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('agents/directory:list')
const get = makeFunctionReference<'query'>('agents/directory:get')
const ensureChiefs = makeFunctionReference<'mutation'>('agents/directory:ensureChiefs')

type Listed = { agents: Array<{ id: string; canEdit: boolean; createdByDisplayName?: string }>; canCreate: boolean }

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    const members: Array<[string, 'owner' | 'member' | 'guest']> = [['owner', 'owner'], ['alice', 'member'], ['bob', 'member'], ['guest', 'guest']]
    for (const [userId, role] of members) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const agent = (agentId: string, fields: Record<string, unknown>) => ctx.db.insert('workspaceAgentDefinitions', {
      agentId, workspaceId: 'ws', principalId: `ap-${agentId}`, name: agentId, instructions: 'Help.', harness: 'overlay',
      modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice',
      createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await agent('shared', { visibility: 'workspace' })
    await agent('private', { visibility: 'creator' })
    await agent('archived', { visibility: 'workspace', archivedAt: 2 })
    await agent('deleted', { visibility: 'workspace', archivedAt: 2, deletedAt: 3 })
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as }
}

const ids = (value: Listed) => value.agents.map(agent => agent.id)

test('members see shared agents, and only the creator sees a creator-only agent', async () => {
  const { as } = await fixture()
  expect(ids(await as('alice').query(list, { workspaceId: 'ws' }) as Listed)).toEqual(['private', 'shared'])
  expect(ids(await as('bob').query(list, { workspaceId: 'ws' }) as Listed)).toEqual(['shared'])
  expect(ids(await as('owner').query(list, { workspaceId: 'ws' }) as Listed)).toEqual(['shared'])
  expect(await as('bob').query(get, { workspaceId: 'ws', agentId: 'private' })).toBeNull()
  expect(ids(await as('alice').query(list, { workspaceId: 'ws', includeArchived: true }) as Listed))
    .toEqual(['archived', 'private', 'shared'])
  expect(await as('alice').query(get, { workspaceId: 'ws', agentId: 'archived' })).toBeNull()
})

test('edit rights follow the creator and workspace managers, and guests cannot create', async () => {
  const { as } = await fixture()
  const canEdit = async (subject: string) =>
    (await as(subject).query(list, { workspaceId: 'ws' }) as Listed).agents.find(agent => agent.id === 'shared')?.canEdit
  expect(await canEdit('alice')).toBe(true)
  expect(await canEdit('owner')).toBe(true)
  expect(await canEdit('bob')).toBe(false)
  expect((await as('guest').query(list, { workspaceId: 'ws' }) as Listed).canCreate).toBe(false)
  expect((await as('bob').query(list, { workspaceId: 'ws' }) as Listed).agents[0]?.createdByDisplayName).toBe('alice')
})

test('non-members and signed-out callers read nothing and cannot provision chiefs', async () => {
  const { t, as } = await fixture()
  expect(await as('stranger').query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await as('alice').query(list, { workspaceId: 'other' })).toBeNull()
  expect(await as('stranger').query(get, { workspaceId: 'ws', agentId: 'shared' })).toBeNull()
  await expect(as('stranger').mutation(ensureChiefs, { workspaceId: 'ws' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('ensureChiefs provisions the chiefs once and the guest call is a no-op', async () => {
  const { as } = await fixture()
  await as('guest').mutation(ensureChiefs, { workspaceId: 'ws' })
  expect(ids(await as('alice').query(list, { workspaceId: 'ws' }) as Listed)).toEqual(['private', 'shared'])
  await as('alice').mutation(ensureChiefs, { workspaceId: 'ws' })
  const first = ids(await as('alice').query(list, { workspaceId: 'ws' }) as Listed)
  await as('alice').mutation(ensureChiefs, { workspaceId: 'ws' })
  expect(ids(await as('alice').query(list, { workspaceId: 'ws' }) as Listed)).toEqual(first)
  expect(first).toContain('workspace-chief-ws')
  expect(first.length).toBeGreaterThan(2)
})
