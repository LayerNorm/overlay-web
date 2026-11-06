import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const args = { workspaceId: 'threads', agentId: 'agent' }
const pageArgs = { ...args, archived: false, paginationOpts: { numItems: 2, cursor: null } }
const now = 1_900_000_000_000
beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', 'threads-test')
  vi.stubEnv('OVERLAY_BFF_URL', 'https://threads.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://threads.convex.cloud')
})
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', { key: 'web', sequence: 1, challenge: 'test', sourceOrigin: 'https://threads.example.test', expiresAt: Date.now() + 3_600_000,
      snapshot: { version: 1, backendUrl: 'https://threads.convex.cloud', revision: 'a'.repeat(64), features: { chat: true }, rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } } })
    await ctx.db.insert('workspaces', { workspaceId: args.workspaceId, kind: 'organization', name: 'Threads', slug: 'threads', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('authorizationRoles', { roleId: 'thread-user', name: 'Threads', isSystem: false, capabilities: ['conversations.read', 'conversations.create', 'conversations.edit'], createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: args.workspaceId, principalId: userId, userId, type: 'human', displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { workspaceId: args.workspaceId, membershipId: userId, principalId: userId, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
      await ctx.db.insert('authorizationUserRoles', { userId, roleId: 'thread-user', createdAt: now })
    }
    await ctx.db.insert('workspacePrincipals', { workspaceId: args.workspaceId, principalId: 'agent-p', agentId: args.agentId, type: 'agent', displayName: 'Agent', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { workspaceId: args.workspaceId, membershipId: 'agent', principalId: 'agent-p', role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', { ...args, principalId: 'agent-p', name: 'Agent', instructions: '', harness: 'overlay', modelId: 'test', allowedToolIds: [], invocationPolicy: 'mention', visibility: 'workspace', createdByPrincipalId: 'alice', createdAt: now, updatedAt: now })
  })
  const alice = t.withIdentity({ subject: 'alice' }), bob = t.withIdentity({ subject: 'bob' })
  return { t, alice, bob }
}

describe('identity-authenticated agent threads', () => {
  test('concurrent main resolution has one stable conversation; create replay preserves its id and title', async () => {
    const f = await fixture()
    expect((await f.alice.query(api.agents.nativeThreads.listThreads, pageArgs)).page).toEqual([])
    const [first, second] = await Promise.all([f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args), f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)])
    expect(first.conversationId).toBe(second.conversationId)
    const create = { ...args, clientRequestId: 'request', title: 'Original' }
    const thread = await f.alice.mutation(api.agents.nativeThreads.createThread, create)
    expect(await f.alice.mutation(api.agents.nativeThreads.createThread, { ...create, title: 'Changed' })).toEqual(thread)
    expect(await f.alice.query(api.agents.nativeThreads.getThread, { ...args, conversationId: first.conversationId })).toMatchObject({ isMain: true })
    expect((await f.t.run(ctx => ctx.db.query('conversations').collect()))).toHaveLength(2)
    await expect(f.alice.mutation(api.agents.nativeThreads.createThread, { ...create, clientRequestId: '' })).rejects.toThrow('INVALID_REQUEST_ID')
  })

  test('exact deep links reject anonymous, foreign, nonparticipant and removed-participant access', async () => {
    const f = await fixture()
    const thread = await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)
    const exact = { ...args, conversationId: thread.conversationId }
    expect(await f.t.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    expect(await f.bob.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    expect(await f.alice.query(api.agents.nativeThreads.getThread, { ...exact, workspaceId: 'foreign' })).toBeNull()
    expect(await f.alice.query(api.agents.nativeThreads.getThread, { ...exact, agentId: 'other' })).toBeNull()
    await expect(f.alice.query(api.agents.nativeThreads.getThread, { ...exact, actorUserId: 'bob' } as never)).rejects.toThrow()
    await f.t.run(async ctx => {
      const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', exact.conversationId).eq('principalId', 'alice')).unique()
      await ctx.db.patch(participant!._id, { status: 'removed', removedAt: now })
    })
    expect(await f.alice.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    expect((await f.alice.query(api.agents.nativeThreads.listThreads, pageArgs)).page).toEqual([])
    await expect(f.alice.mutation(api.agents.nativeThreads.setThreadArchived, { ...exact, archived: true })).rejects.toThrow('ROOM_ACCESS_DENIED')
    const fresh = await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)
    expect(fresh.conversationId).not.toBe(exact.conversationId)
    await f.t.run(async ctx => {
      const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', fresh.conversationId).eq('principalId', 'agent-p')).unique()
      await ctx.db.patch(participant!._id, { status: 'removed', removedAt: now })
    })
    expect(await f.alice.query(api.agents.nativeThreads.getThread, { ...args, conversationId: fresh.conversationId })).toBeNull()
    expect((await f.alice.query(api.agents.nativeThreads.listThreads, pageArgs)).page).toEqual([])
    expect((await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)).conversationId).not.toBe(fresh.conversationId)
  })

  test('live definition, private-agent visibility, agent principal and agent membership are rechecked', async () => {
    const f = await fixture()
    const thread = await f.bob.mutation(api.agents.nativeThreads.resolveMainThread, args)
    const exact = { ...args, conversationId: thread.conversationId }
    await f.t.run(async ctx => {
      const agent = await ctx.db.query('workspaceAgentDefinitions').unique()
      await ctx.db.patch(agent!._id, { visibility: 'creator' })
    })
    expect(await f.bob.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    await f.t.run(async ctx => {
      const agent = await ctx.db.query('workspaceAgentDefinitions').unique()
      await ctx.db.patch(agent!._id, { visibility: 'workspace', archivedAt: now })
    })
    expect(await f.bob.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    await expect(f.bob.mutation(api.agents.nativeThreads.resolveMainThread, args)).rejects.toThrow('AGENT_ARCHIVED')
    await f.t.run(async ctx => {
      const agent = await ctx.db.query('workspaceAgentDefinitions').unique()
      await ctx.db.patch(agent!._id, { archivedAt: undefined })
      const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', 'agent-p')).unique()
      await ctx.db.patch(principal!._id, { archivedAt: now })
    })
    expect(await f.bob.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    await f.t.run(async ctx => {
      const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', q => q.eq('principalId', 'agent-p')).unique()
      await ctx.db.patch(principal!._id, { archivedAt: undefined })
      const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', 'agent-p')).unique()
      await ctx.db.patch(membership!._id, { status: 'suspended' })
    })
    expect(await f.bob.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
  })

  test('adopts legacy DM identity and skips a caller-archived main without unarchiving it', async () => {
    const f = await fixture()
    const dm = await f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId: args.workspaceId, principalIds: ['agent-p'] })
    await f.t.run(ctx => ctx.db.patch(dm.conversationId, { agentId: undefined }))
    const adopted = await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)
    expect(adopted.conversationId).toBe(dm.conversationId)
    await f.alice.mutation(api.agents.nativeThreads.setThreadArchived, { ...args, conversationId: adopted.conversationId, archived: true })
    const fresh = await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)
    expect(fresh.conversationId).not.toBe(adopted.conversationId)
    expect((await f.alice.query(api.agents.nativeThreads.listThreads, { ...pageArgs, archived: true })).page.map(row => row.conversationId)).toEqual([adopted.conversationId])
    await f.alice.mutation(api.agents.nativeThreads.setThreadArchived, { ...args, conversationId: adopted.conversationId, archived: false })
    expect((await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)).conversationId).toBe(adopted.conversationId)
  })

  test('caller archive does not archive other participants; deletion is global and protects the last active thread', async () => {
    const f = await fixture()
    const thread = await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)
    const exact = { ...args, conversationId: thread.conversationId }
    await expect(f.alice.mutation(api.agents.nativeThreads.deleteThread, exact)).rejects.toThrow('AGENT_LAST_THREAD')
    await f.t.run(ctx => ctx.db.insert('conversationParticipants', { workspaceId: args.workspaceId, conversationId: thread.conversationId, principalId: 'bob', principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now }))
    await f.alice.mutation(api.agents.nativeThreads.setThreadArchived, { ...exact, archived: true })
    const bobView = await f.bob.query(api.agents.nativeThreads.getThread, exact)
    expect(bobView).not.toBeNull()
    expect(bobView?.archivedAt).toBeUndefined()
    await f.alice.mutation(api.agents.nativeThreads.deleteThread, exact)
    expect(await f.alice.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    expect(await f.bob.query(api.agents.nativeThreads.getThread, exact)).toBeNull()
    expect((await f.t.run(ctx => ctx.db.get(thread.conversationId)))?.deletedAt).toBeTypeOf('number')
  })

  test('main derivation fails closed beyond its related traversal bound', async () => {
    const f = await fixture()
    const thread = await f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)
    await f.t.run(async ctx => {
      for (let i = 0; i < 200; i++) await ctx.db.insert('conversations', { ...args, userId: 'alice', title: 'Thread', conversationType: 'dm', scope: 'workspace',
        createdAt: now, lastModified: now, lastMode: 'act', askModelIds: [], actModelId: 'test' })
    })
    await expect(f.alice.query(api.agents.nativeThreads.listThreads, pageArgs)).rejects.toThrow('THREAD_LIMIT_EXCEEDED')
    await expect(f.alice.query(api.agents.nativeThreads.getThread, { ...args, conversationId: thread.conversationId })).rejects.toThrow('THREAD_LIMIT_EXCEEDED')
    await expect(f.alice.mutation(api.agents.nativeThreads.resolveMainThread, args)).rejects.toThrow('THREAD_LIMIT_EXCEEDED')
    await expect(f.alice.mutation(api.agents.nativeThreads.deleteThread, { ...args, conversationId: thread.conversationId })).rejects.toThrow('THREAD_LIMIT_EXCEEDED')
  })

  test('compound pagination loses no equal-timestamp rows and enforces chat policy', async () => {
    const f = await fixture()
    const ids = []
    for (let i = 0; i < 7; i++) {
      const thread = await f.alice.mutation(api.agents.nativeThreads.createThread, { ...args, clientRequestId: `r-${i}` })
      ids.push(thread.conversationId)
      await f.t.run(ctx => ctx.db.patch(thread.conversationId, { lastModified: now, createdAt: now }))
    }
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const page = await f.alice.query(api.agents.nativeThreads.listThreads, { ...pageArgs, paginationOpts: { numItems: 2, cursor } })
      seen.push(...page.page.map(row => row.conversationId))
      if (page.isDone) break
      cursor = page.continueCursor
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen)).toEqual(new Set(ids))
    await f.t.run(async ctx => {
      const policy = await ctx.db.query('nativeDeploymentPolicies').unique()
      await ctx.db.patch(policy!._id, { snapshot: { ...policy!.snapshot!, features: { chat: false } } })
    })
    expect(await f.alice.query(api.agents.nativeThreads.getThread, { ...args, conversationId: ids[0] })).toBeNull()
    await expect(f.alice.mutation(api.agents.nativeThreads.createThread, { ...args, clientRequestId: 'denied' })).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  })
})
