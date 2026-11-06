import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { NATIVE_ROOM_RECENCY_MIGRATION, nativeCollaborationMetadata } from './collaboration/nativeCollaborationReadiness'
import { activateRoomParticipant, insertRoomParticipant } from './collaboration/participantRecency'

const modules = import.meta.glob('./**/*.ts')
const workspaceId = 'recency-workspace'
const secret = 'recency-test'
beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  vi.stubEnv('OVERLAY_BFF_URL', 'https://recency.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://recency.convex.cloud')
})
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  const t = convexTest(schema, modules)
  const now = Date.now()
  await t.run(async ctx => {
    await ctx.db.insert('migrationMarkers', { key: NATIVE_ROOM_RECENCY_MIGRATION, scope: 'global', completedAt: now })
    await ctx.db.insert('nativeDeploymentPolicies', { key: 'web', sequence: 1, challenge: 'test', sourceOrigin: 'https://recency.example.test', expiresAt: now + 3_600_000, snapshot: { version: 1, backendUrl: 'https://recency.convex.cloud', revision: 'a'.repeat(64), features: { chat: true }, rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } } })
    await ctx.db.insert('authorizationRoles', { roleId: 'recency-user', name: 'Reader', isSystem: false, capabilities: ['conversations.read'], createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob']) await ctx.db.insert('authorizationUserRoles', { userId, roleId: 'recency-user', createdAt: now })
  })
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx))).toEqual({ nativeCollaborationRevision: 'native-collaboration-v1' })
  await t.mutation(api.collaboration.workspaces.createOrganizationByServer, { serverSecret: secret, workspaceId, principalId: 'alice', membershipId: 'alice', creatorUserId: 'alice', creatorDisplayName: 'Alice', name: 'Recency', slug: 'recency', now })
  const list = (userId = 'alice', kind: 'channel' | 'direct' = 'channel') => t.withIdentity({ subject: userId }).query(api.collaboration.nativeRooms.listRooms, { workspaceId, kind, archived: false, paginationOpts: { cursor: null, numItems: 100 } })
  const visible = async (conversationId: Id<'conversations'>, userId = 'alice', kind: 'channel' | 'direct' = 'channel') => {
    expect((await list(userId, kind)).page.map(row => row.conversationId)).toContain(conversationId)
    const participant = await t.run(ctx => ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversationId).eq('principalId', userId)).unique())
    const room = await t.run(ctx => ctx.db.get(conversationId))
    expect(participant?.roomLastModified).toBe(room?.lastModified)
  }
  return { t, list, visible, now }
}

test('workspace #general is immediately listable after the global backfill has completed', async () => {
  const f = await fixture()
  const general = await f.t.run(ctx => ctx.db.query('conversations').first())
  expect(general?.title).toBe('general')
  await f.visible(general!._id)
})

test.each([false, true])('invitation initializes new and reactivated participants after backfill (existing=%s)', async existing => {
  const f = await fixture()
  const room = await f.t.run(ctx => ctx.db.query('conversations').first())
  if (existing) await f.t.run(ctx => ctx.db.insert('conversationParticipants', { workspaceId, conversationId: room!._id, principalId: 'bob', principalType: 'human', status: 'removed', role: 'member', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, roomLastModified: 1, removedAt: 1 }))
  await f.t.mutation(api.collaboration.workspaces.inviteByServer, { serverSecret: secret, invitationId: 'invite', workspaceId, email: 'bob@example.test', role: 'member', invitedByPrincipalId: 'alice', now: f.now, expiresAt: f.now + 60_000 })
  await f.t.mutation(api.collaboration.workspaces.acceptInvitationByServer, { serverSecret: secret, invitationId: 'invite', principalId: 'bob', membershipId: 'bob', userId: 'bob', email: 'bob@example.test', displayName: 'Bob', now: f.now + 1 })
  await f.visible(room!._id, 'bob')
})

test('surface participant insertion remains natively listable after backfill', async () => {
  const f = await fixture()
  const conversationId = await f.t.mutation(api.surfaces.surfaces.ensureSurfaceConversation, { serverSecret: secret, userId: 'alice', workspaceId, title: 'Surface', askModelIds: [], actModelId: 'test', conversationType: 'channel', createdByPrincipalId: 'alice', externalPlatform: 'slack', externalChannelId: 'channel', externalThreadId: 'thread', surfaceBindingId: 'binding' })
  await f.visible(conversationId)
})

test('Slack import insertion and reactivation both initialize current recency', async () => {
  const f = await fixture()
  const args = { actorUserId: 'alice', workspaceId, title: 'Imported', clientId: 'slack:C123', visibility: 'public' as const, serverSecret: secret }
  const conversationId = await f.t.mutation(api.imports.slackImporter.createSlackChannel, args)
  await f.visible(conversationId)
  await f.t.run(async ctx => {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversationId).eq('principalId', 'alice')).unique()
    await ctx.db.patch(participant!._id, { status: 'removed', removedAt: 1, roomLastModified: undefined })
    await ctx.db.patch(conversationId, { deletedAt: 1 })
  })
  expect(await f.t.mutation(api.imports.slackImporter.createSlackChannel, args)).toBe(conversationId)
  await f.visible(conversationId)
})

test('shared invariant ignores stale caller projections and rejects missing resources', async () => {
  const f = await fixture()
  const room = await f.t.run(ctx => ctx.db.query('conversations').first())
  await f.t.run(async ctx => {
    const id = await insertRoomParticipant(ctx, { workspaceId, conversationId: room!._id, principalId: 'temporary', principalType: 'human', status: 'removed', role: 'member', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, roomLastModified: -1 })
    expect((await ctx.db.get(id))?.roomLastModified).toBe(room!.lastModified)
    await activateRoomParticipant(ctx, id, { roomLastModified: -2 })
    expect((await ctx.db.get(id))?.roomLastModified).toBe(room!.lastModified)
    await ctx.db.delete(id)
    await expect(activateRoomParticipant(ctx, id, {})).rejects.toThrow('PARTICIPANT_NOT_FOUND')
    await ctx.db.delete(room!._id)
    await expect(insertRoomParticipant(ctx, { workspaceId, conversationId: room!._id, principalId: 'missing', principalType: 'human', status: 'active', role: 'member', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 })).rejects.toThrow('CONVERSATION_NOT_FOUND')
  })
})
