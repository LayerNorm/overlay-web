import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const fn = {
  list: makeFunctionReference<'query'>('work/browse:list'),
  get: makeFunctionReference<'query'>('work/browse:get'),
  context: makeFunctionReference<'query'>('work/browse:context'),
  events: makeFunctionReference<'query'>('work/browse:events'),
  create: makeFunctionReference<'mutation'>('work/browse:create'),
  update: makeFunctionReference<'mutation'>('work/browse:update'),
  move: makeFunctionReference<'mutation'>('work/browse:move'),
  addComment: makeFunctionReference<'mutation'>('work/browse:addComment'),
}
const backendUrl = 'https://fixture.convex.cloud'

type Item = { id: string; title: string; status: string; rank: string; createdBy: string; archivedAt: number | null }

afterEach(() => { vi.unstubAllEnvs() })

async function fixture(options: { workFeature?: boolean } = {}) {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 600_000,
      snapshot: {
        version: 1, backendUrl, revision: 'a'.repeat(64), features: { work: options.workFeature ?? true },
        rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' },
      },
    } as never)
    await ctx.db.insert('authorizationRoles', { roleId: 'worker', name: 'Worker', capabilities: ['work.use'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    // Carol is a member whose role does not include Work.
    for (const userId of ['alice', 'bob', 'carol']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
      if (userId !== 'carol') await ctx.db.insert('authorizationUserRoles', { roleId: 'worker', userId, createdAt: 1 })
    }
    const task = (fields: Record<string, unknown>) => ctx.db.insert('workItems', {
      workspaceId: 'ws', userId: 'alice', scope: 'personal', status: 'todo', blocked: false, priority: 2, createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    return {
      first: await task({ title: 'First', rank: 'a' }),
      second: await task({ title: 'Second', rank: 'b' }),
      shared: await task({ title: 'Shared', rank: 'c', scope: 'workspace' }),
      archived: await task({ title: 'Old', rank: 'd', archivedAt: 5, archivedFromScope: 'personal' }),
    }
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as, ids }
}

const titles = (items: unknown) => (items as Item[]).map(item => item.title)

async function assignmentFixture() {
  const data = await fixture()
  const assignment = await data.t.run(async ctx => {
    const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', 'worker')).unique()
    await ctx.db.patch(role!._id, { capabilities: ['work.use', 'conversations.read'] })
    for (const agentId of ['chief', 'specialist']) await ctx.db.insert('workspaceAgentDefinitions', {
      agentId, workspaceId: 'ws', principalId: agentId, name: agentId, instructions: '', harness: 'overlay',
      modelId: 'openrouter/free', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice', createdAt: 1, updatedAt: 1,
    })
    const parent = await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'ws', conversationType: 'dm', title: 'Outcome', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    const child = await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'ws', conversationType: 'dm', title: 'Specialist result', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
    for (const conversationId of [parent, child]) await ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'ws', principalId: 'p-alice', principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('agentAssignments', { workspaceId: 'ws', assignmentId: 'assignment', idempotencyKey: 'key', parentConversationId: parent,
      parentRunId: 'parent', rootRunId: 'parent', callerAgentId: 'chief', assignedAgentId: 'specialist', requesterUserId: 'alice', conversationId: child,
      brief: 'Do work', questionTurnId: 'question', createdAt: 1 })
    return { parent, child }
  })
  const read = (userId = 'alice', view: 'personal' | 'workspace' = 'workspace') => data.as(userId).query(makeFunctionReference<'query'>('work/browse:assignments'), {
    workspaceId: 'ws', view, paginationOpts: { numItems: 25, cursor: null },
  }) as Promise<{ page: Array<{ assignmentId: string; title: string; origin?: { channelName?: string }; status: string }> }>
  return { ...data, ...assignment, read }
}

test('Work projects assignment executions without creating tasks and requires both conversation ACLs', async () => {
  const data = await assignmentFixture()
  expect((await data.read()).page).toMatchObject([{ assignmentId: 'assignment', title: 'Specialist result', status: 'queued' }])
  expect((await data.read('alice', 'workspace')).page).toHaveLength(1)
  expect((await data.read('alice', 'personal')).page).toEqual([])
  expect((await data.read('bob')).page).toEqual([])
  expect((await data.read('carol')).page).toEqual([])
  expect(await data.t.run(ctx => ctx.db.query('workItems').collect())).toHaveLength(4)
  await data.t.run(async ctx => {
    const parent = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parent).eq('principalId', 'p-alice')).unique()
    await ctx.db.patch(parent!._id, { status: 'removed' })
  })
  expect((await data.read()).page).toEqual([])
  await data.t.run(async ctx => {
    const parent = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.parent).eq('principalId', 'p-alice')).unique()
    await ctx.db.patch(parent!._id, { status: 'active' })
    const child = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.child).eq('principalId', 'p-alice')).unique()
    await ctx.db.delete(child!._id)
  })
  expect((await data.read()).page).toEqual([])
})

test('Work assignment archive is live and origin disappears after connection revocation', async () => {
  const data = await assignmentFixture()
  const connection = await data.t.run(async ctx => {
    const id = await ctx.db.insert('surfaceConnections', { id: 'connection', workspaceId: 'ws', platform: 'slack', externalTeamId: 'team',
      externalTeamName: 'QA', status: 'active', createdAt: 1, updatedAt: 1, installedByUserId: 'alice' })
    await ctx.db.insert('surfaceThreadLinks', { workspaceId: 'ws', platform: 'slack', connectionId: 'connection', externalTeamId: 'team',
      channelId: 'channel', threadId: 'thread', conversationId: data.parent, channelName: 'launch', originalBindingId: 'binding', createdAt: 1, updatedAt: 1 })
    return id
  })
  expect((await data.read()).page[0]?.origin?.channelName).toBe('launch')
  await data.t.run(ctx => ctx.db.patch(connection, { status: 'uninstalled' }))
  expect((await data.read()).page[0]?.origin).toBeUndefined()
  await data.t.run(async ctx => {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', data.child).eq('principalId', 'p-alice')).unique()
    await ctx.db.patch(participant!._id, { archivedAt: 1 })
  })
  expect((await data.read()).page).toEqual([])
})

test('members with Work see their tasks in board order and shared ones, as client task views', async () => {
  const { as, ids } = await fixture()
  const items = await as('alice').query(fn.list, { workspaceId: 'ws', view: 'personal' }) as Item[]
  expect(titles(items)).toEqual(['First', 'Second'])
  expect(items[0]).toMatchObject({ id: ids.first, createdBy: 'alice', status: 'todo', archivedAt: null })
  expect(titles(await as('bob').query(fn.list, { workspaceId: 'ws' }))).toEqual(['Shared'])
  // A task outside the list (archived) is still readable by link.
  expect(await as('alice').query(fn.get, { workspaceId: 'ws', id: ids.archived })).toMatchObject({ title: 'Old' })
  expect(await as('bob').query(fn.get, { workspaceId: 'ws', id: ids.first })).toBeNull()
  const context = await as('alice').query(fn.context, { workspaceId: 'ws' }) as { principalId: string; people: Array<{ principalId: string }> }
  expect(context.principalId).toBe('p-alice')
  expect(context.people.map(person => person.principalId).sort()).toEqual(['p-alice', 'p-bob', 'p-carol'])
})

test('Work access needs the work.use capability, an active membership and the deployment feature', async () => {
  const { t, as, ids } = await fixture()
  expect(await as('carol').query(fn.list, { workspaceId: 'ws' })).toBeNull()
  expect(await as('stranger').query(fn.list, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(fn.list, { workspaceId: 'ws' })).toBeNull()
  await expect(as('carol').mutation(fn.update, { workspaceId: 'ws', id: ids.shared, title: 'x' })).rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  const off = await fixture({ workFeature: false })
  expect(await off.as('alice').query(fn.list, { workspaceId: 'ws' })).toBeNull()
  await expect(off.as('alice').mutation(fn.create, { workspaceId: 'ws', title: 'x' })).rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
})

test('edits, moves and comments apply with the server rules and reach the live list', async () => {
  const { as, ids } = await fixture()
  const created = await as('alice').mutation(fn.create, { workspaceId: 'ws', title: '  Third  ' }) as Item
  expect(created.title).toBe('Third')
  expect(titles(await as('alice').query(fn.list, { workspaceId: 'ws', view: 'personal' }))).toEqual(['First', 'Second', 'Third'])

  await as('alice').mutation(fn.update, { workspaceId: 'ws', id: ids.second, title: 'Second, renamed', status: 'progress' })
  await as('alice').mutation(fn.move, { workspaceId: 'ws', id: created.id, afterId: null, beforeId: ids.first })
  const todo = (await as('alice').query(fn.list, { workspaceId: 'ws', view: 'personal' }) as Item[]).filter(item => item.status === 'todo')
  expect(todo.map(item => item.title)).toEqual(['Third', 'First'])
  expect((await as('alice').query(fn.get, { workspaceId: 'ws', id: ids.second }) as Item)).toMatchObject({ title: 'Second, renamed', status: 'progress' })

  await as('alice').mutation(fn.addComment, { workspaceId: 'ws', workItemId: ids.first, body: 'Looks good' })
  const events = await as('alice').query(fn.events, { workspaceId: 'ws', workItemId: ids.first }) as Array<{ kind: string; data: { body?: string } | null }>
  expect(events.find(event => event.kind === 'comment')?.data?.body).toBe('Looks good')

  // A stale edit is refused; another member cannot touch a personal task; validation reasons pass through.
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', id: ids.first, title: 'x', expectedUpdatedAt: 1 })).rejects.toThrow('WORK_INVALID:conflict')
  await expect(as('bob').mutation(fn.update, { workspaceId: 'ws', id: ids.first, title: 'x' })).rejects.toThrow('Unauthorized')
  await expect(as('bob').mutation(fn.addComment, { workspaceId: 'ws', workItemId: ids.first, body: 'hi' })).rejects.toThrow('Unauthorized')
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', id: ids.first, title: '   ' })).rejects.toThrow('WORK_INVALID:title_required')
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', id: ids.archived, title: 'x' })).rejects.toThrow('WORK_INVALID:archived')
  expect(await as('bob').query(fn.events, { workspaceId: 'ws', workItemId: ids.first })).toEqual([])
})

test('assignment cannot be changed natively, because it starts an agent turn on the server', async () => {
  const { as, ids } = await fixture()
  await expect(as('alice').mutation(fn.update, { workspaceId: 'ws', id: ids.first, assigneePrincipalId: 'p-bob' } as never)).rejects.toThrow()
  await expect(as('alice').mutation(fn.create, { workspaceId: 'ws', title: 'x', assigneePrincipalId: 'p-bob' } as never)).rejects.toThrow()
})
