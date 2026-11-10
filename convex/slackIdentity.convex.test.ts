import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'slack-identity-fixture'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const mutation = (operation: string) => makeFunctionReference<'mutation'>(`surfaces/slackIdentity:${operation}`)
const requester = makeFunctionReference<'query'>('surfaces/slackIdentity:requester')

async function fixture() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('surfaceConnections', { id: 'connection', workspaceId: 'ws', platform: 'slack', externalTeamId: 'T1', status: 'active', installedByUserId: 'admin', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob', 'admin']) {
      await ctx.db.insert('workspacePrincipals', { principalId: userId, workspaceId: 'ws', userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: userId, workspaceId: 'ws', principalId: userId,
        role: userId === 'admin' ? 'admin' : 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
  })
  const scope = { workspaceId: 'ws', connectionId: 'connection', teamId: 'T1', serverSecret: secret }
  async function link(userId: string, slackUserId: string, nonce: string) {
    await t.mutation(mutation('begin'), { ...scope, userId, nonce })
    return await t.mutation(mutation('complete'), { ...scope, userId, nonce, slackUserId, id: nonce })
  }
  const query = (slackUserId = 'U1', extra: Record<string, unknown> = {}) => t.query(requester, { ...scope, slackUserId, channelId: 'C1', threadId: 'thread', ...extra })
  return { t, scope, link, query }
}

test('nonce is scoped, expiring and consumed atomically with a durable link; replay fails', async () => {
  const { t, scope, link } = await fixture()
  expect(await link('alice', 'U1', 'nonce')).toEqual({ status: 'linked' })
  await expect(t.mutation(mutation('complete'), { ...scope, userId: 'alice', slackUserId: 'U1', nonce: 'nonce', id: 'replay' })).rejects.toThrow('NONCE_INVALID')
  await t.mutation(mutation('begin'), { ...scope, userId: 'alice', nonce: 'scoped' })
  await expect(t.mutation(mutation('complete'), { ...scope, userId: 'bob', slackUserId: 'U2', nonce: 'scoped', id: 'wrong-user' })).rejects.toThrow('NONCE_INVALID')
  await t.run(async ctx => {
    const nonce = await ctx.db.query('slackIdentityNonces').withIndex('by_nonce', q => q.eq('nonce', 'scoped')).unique()
    await ctx.db.patch(nonce!._id, { expiresAt: Date.now() - 1 })
  })
  await expect(t.mutation(mutation('complete'), { ...scope, userId: 'alice', slackUserId: 'U2', nonce: 'scoped', id: 'expired' })).rejects.toThrow('NONCE_INVALID')
  await t.run(async ctx => {
    const links = await ctx.db.query('slackIdentityLinks').collect()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ teamId: 'T1', slackUserId: 'U1', userId: 'alice', workspaceId: 'ws', connectionId: 'connection', status: 'active' })
    expect(links[0].createdAt).toBeGreaterThan(0)
  })
})

test('conflicts never replace another account and consume the conflicting callback nonce', async () => {
  const { t, scope, link, query } = await fixture()
  await link('alice', 'U1', 'alice-link')
  expect(await link('bob', 'U1', 'bob-conflict')).toEqual({ status: 'conflict' })
  expect(await query()).toMatchObject({ userId: 'alice' })
  await expect(t.mutation(mutation('complete'), { ...scope, userId: 'bob', slackUserId: 'U2', nonce: 'bob-conflict', id: 'retry' })).rejects.toThrow('NONCE_INVALID')
})

test('relinking revokes the previous Slack user and frozen runs cannot adopt a replacement link', async () => {
  const { t, link, query } = await fixture()
  await link('alice', 'U1', 'old')
  await link('alice', 'U2', 'new')
  expect(await query('U1')).toBeNull()
  expect(await query('U2')).toMatchObject({ userId: 'alice', linkId: 'new' })
  expect(await query('U2', { linkId: 'old', userId: 'alice' })).toBeNull()
  expect(await query('U2', { userId: 'bob' })).toBeNull()
  await t.run(async ctx => {
    const links = await ctx.db.query('slackIdentityLinks').collect()
    expect(links.find(row => row.id === 'old')).toMatchObject({ status: 'revoked', revokedAt: expect.any(Number) })
    expect(links.filter(row => row.status === 'active')).toHaveLength(1)
  })
})

test('self and workspace admin may unlink; another member and a foreign workspace cannot', async () => {
  const { t, link, query } = await fixture()
  await link('alice', 'U1', 'link')
  const args = { workspaceId: 'ws', linkId: 'link', serverSecret: secret }
  await expect(t.mutation(mutation('unlink'), { ...args, actorUserId: 'bob' })).rejects.toThrow('UNLINK_DENIED')
  await expect(t.mutation(mutation('unlink'), { ...args, workspaceId: 'foreign', actorUserId: 'admin' })).rejects.toThrow('UNLINK_DENIED')
  await t.mutation(mutation('unlink'), { ...args, actorUserId: 'alice' })
  expect(await query()).toBeNull()
  await link('alice', 'U1', 'admin-revoked')
  await t.mutation(mutation('unlink'), { ...args, linkId: 'admin-revoked', actorUserId: 'admin' })
  expect(await query()).toBeNull()
})

test('unlinked, removed members, revoked participants and inactive installs fail closed', async () => {
  const { t, link, query } = await fixture()
  expect(await query()).toBeNull()
  await link('alice', 'U1', 'link')
  expect(await query()).toMatchObject({ userId: 'alice', principalId: 'alice' })
  await t.run(async ctx => {
    const member = await ctx.db.query('workspaceMemberships').withIndex('by_membershipId', q => q.eq('membershipId', 'alice')).unique()
    await ctx.db.patch(member!._id, { status: 'suspended' })
  })
  expect(await query()).toBeNull()
  await t.mutation(mutation('unlink'), { actorUserId: 'alice', workspaceId: 'ws', linkId: 'link', serverSecret: secret })
  await t.run(async ctx => {
    const member = await ctx.db.query('workspaceMemberships').withIndex('by_membershipId', q => q.eq('membershipId', 'alice')).unique()
    await ctx.db.patch(member!._id, { status: 'active' })
  })
  await link('alice', 'U1', 'reconnected')
  expect(await query()).toMatchObject({ userId: 'alice' })
  await t.run(async ctx => {
    const connection = await ctx.db.query('surfaceConnections').withIndex('by_entityId', q => q.eq('id', 'connection')).unique()
    await ctx.db.patch(connection!._id, { status: 'degraded' })
  })
  expect(await query()).toBeNull()
})

test('two linked participants in one Slack thread admit turns as themselves, never the installer or binding creator', async () => {
  const { t, scope, link, query } = await fixture()
  await link('alice', 'U1', 'alice-link')
  await link('bob', 'U2', 'bob-link')
  const conversationId = await t.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', { principalId: 'chief-principal', workspaceId: 'ws', type: 'agent', agentId: 'chief', displayName: 'Chief', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'chief', principalId: 'chief-principal', workspaceId: 'ws', agentRole: 'workspace_chief', harness: 'overlay', name: 'Chief', instructions: '', modelId: 'openrouter/free', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'admin', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('surfaceBindings', { id: 'binding', connectionId: 'connection', agentId: 'chief', channelId: 'C1', status: 'active', createdByUserId: 'admin', createdAt: 1, updatedAt: 1 })
    const id = await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'ws', conversationType: 'channel', createdByPrincipalId: 'alice', externalPlatform: 'slack', externalChannelId: 'C1', externalThreadId: 'thread', surfaceBindingId: 'binding', title: 'Slack', createdAt: 1, lastModified: 1, lastMode: 'act', actModelId: 'openrouter/free', askModelIds: [] })
    await ctx.db.insert('surfaceThreadLinks', { workspaceId: 'ws', platform: 'slack', connectionId: 'connection', externalTeamId: 'T1', channelId: 'C1', threadId: 'thread', conversationId: id, originalBindingId: 'binding', createdAt: 1, updatedAt: 1 })
    for (const principalId of ['alice', 'bob', 'chief-principal']) await ctx.db.insert('conversationParticipants', { conversationId: id, workspaceId: 'ws', principalId,
      principalType: principalId === 'chief-principal' ? 'agent' : 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 })
    return id
  })
  const begin = makeFunctionReference<'mutation'>('surfaces/surfaceExecutions:beginSurfaceTurn')
  for (const [userId, slackUserId] of [['alice', 'U1'], ['bob', 'U2']]) {
    expect(await query(slackUserId)).toMatchObject({ userId, principalId: userId })
    const result = await t.mutation(begin, { ...scope, platform: 'slack', turnId: `surface:slack:T1:C1:${userId}`, workflowRunId: userId,
      actorUserId: userId, creatorPrincipalId: userId, identityLinkId: `${userId}-link`, slackUserId, agentId: 'chief', agentPrincipalId: 'chief-principal',
      channelId: 'C1', threadId: 'thread', messageId: userId, bindingId: 'binding', conversationId, userContent: 'Help', modelId: 'openrouter/free' })
    expect(result.execution).toMatchObject({ actorUserId: userId, creatorPrincipalId: userId, conversationId })
    await t.run(async ctx => { expect(await ctx.db.get(result.execution.agentRunId)).toMatchObject({ userId, initiatorPrincipalId: userId }) })
  }
  await t.run(async ctx => {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversationId).eq('principalId', 'bob')).unique()
    await ctx.db.patch(participant!._id, { status: 'removed' })
    expect((await ctx.db.get(conversationId))?.userId).toBe('alice')
  })
  expect(await query('U2')).toBeNull()
  await t.run(async ctx => {
    const mapping = await ctx.db.query('surfaceThreadLinks').withIndex('by_conversationId', q => q.eq('conversationId', conversationId)).unique()
    await ctx.db.delete(mapping!._id)
  })
  expect(await query('U2')).toBeNull()
  expect(await query('U1')).toMatchObject({ userId: 'alice' })
})
