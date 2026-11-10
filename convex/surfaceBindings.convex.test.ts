import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'surface-bindings-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const m = (name: string) => makeFunctionReference<'mutation'>(`surfaces/surfaces:${name}`)
const q = (name: string) => makeFunctionReference<'query'>(`surfaces/surfaces:${name}`)

const row = (id: string, agentId: string) => ({
  serverSecret: secret,
  id,
  connectionId: 'conn_1',
  agentId,
  channelId: 'C1',
  channelName: 'general',
  status: 'active' as const,
  createdByUserId: 'user_1',
  createdAt: 1,
  updatedAt: 1,
})

test('live binding affordances allow only workspace managers and only the Chief', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: role, userId: role, type: 'human', displayName: role, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: role, membershipId: role, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    for (const agentRole of ['workspace_chief', 'agent'] as const) {
      await ctx.db.insert('workspaceAgentDefinitions', { agentId: agentRole, agentRole, workspaceId: 'ws', principalId: agentRole,
        name: agentRole, visibility: 'workspace', instructions: '', harness: 'overlay', modelId: 'model', allowedToolIds: [],
        invocationPolicy: 'mention', createdByPrincipalId: 'owner', createdAt: 1, updatedAt: 1 })
    }
  })
  const query = makeFunctionReference<'query'>('surfaces/browse:forAgent')
  for (const role of ['owner', 'admin', 'member', 'guest']) {
    const viewer = convex.withIdentity({ subject: role })
    expect(await viewer.query(query, { workspaceId: 'ws', agentId: 'workspace_chief' })).toMatchObject({ canBind: role === 'owner' || role === 'admin' })
    expect(await viewer.query(query, { workspaceId: 'ws', agentId: 'agent' })).toMatchObject({ canBind: false })
  }
  expect(await convex.query(query, { workspaceId: 'ws', agentId: 'workspace_chief' })).toBeNull()
})

describe('surface bindings', () => {
  test('only workspace Chiefs bind; re-binding reactivates the Chief row without deleting legacy bindings', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async ctx => {
      await ctx.db.insert('surfaceConnections', { id: 'conn_1', workspaceId: 'ws', platform: 'slack',
        externalTeamId: 'T', status: 'active', installedByUserId: 'user_1', createdAt: 1, updatedAt: 1 })
      for (const [agentId, agentRole, workspaceId] of [
        ['agent_pr', 'workspace_chief', 'ws'], ['agent_product', 'agent', 'ws'], ['foreign', 'workspace_chief', 'other'],
      ] as const) {
        await ctx.db.insert('workspaceAgentDefinitions', { agentId, agentRole, workspaceId, principalId: agentId,
          name: agentId, instructions: '', harness: 'overlay', modelId: 'model', allowedToolIds: [],
          invocationPolicy: 'mention', createdByPrincipalId: 'human', createdAt: 1, updatedAt: 1 })
      }
      const { serverSecret: _secret, ...legacy } = row('legacy', 'agent_product')
      expect(_secret).toBe(secret)
      await ctx.db.insert('surfaceBindings', legacy)
    })
    expect(await convex.mutation(m('createBinding'), row('b_pr', 'agent_pr'))).toBe('b_pr')
    for (const agentId of ['agent_product', 'foreign', 'missing']) {
      await expect(convex.mutation(m('createBinding'), row('denied', agentId))).rejects.toThrow('Only the workspace Chief')
    }

    const listed = await convex.query(q('listBindingsByChannel'), { serverSecret: secret, connectionId: 'conn_1', channelId: 'C1' })
    expect(listed.map((binding: { id: string; agentId: string }) => [binding.id, binding.agentId]).sort())
      .toEqual([['b_pr', 'agent_pr'], ['legacy', 'agent_product']])

    await convex.mutation(m('updateBinding'), { serverSecret: secret, id: 'b_pr', status: 'removed', updatedAt: 2 })
    // A fresh id for the same agent reuses (and reactivates) its removed row.
    expect(await convex.mutation(m('createBinding'), row('b_pr_again', 'agent_pr'))).toBe('b_pr')
    const reactivated = await convex.query(q('getBinding'), { serverSecret: secret, id: 'b_pr' })
    expect(reactivated?.status).toBe('active')
    expect(reactivated?.agentId).toBe('agent_pr')

    // Pre-multi-agent callers still get one active row instead of an error.
    const first = await convex.query(q('findBindingByChannel'), { serverSecret: secret, connectionId: 'conn_1', channelId: 'C1' })
    expect(first?.status).toBe('active')
  })
})
