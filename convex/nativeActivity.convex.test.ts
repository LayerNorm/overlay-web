import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { getUnreadCounts, UNREAD_ROOM_SCAN_LIMIT, UNREAD_ROW_READ_LIMIT } from './collaboration/nativeActivity'

const modules = import.meta.glob('./**/*.ts')
const workspaceId = 'native-activity'
beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', 'activity-test')
  vi.stubEnv('OVERLAY_BFF_URL', 'https://activity.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://activity.convex.cloud')
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

async function fixture() {
  const t = convexTest(schema, modules)
  const now = Date.now()
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', { key: 'web', sequence: 1, challenge: 'test', sourceOrigin: 'https://activity.example.test', expiresAt: now + 3_600_000,
      snapshot: { version: 1, backendUrl: 'https://activity.convex.cloud', revision: 'a'.repeat(64), features: { chat: true }, rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } } })
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Activity', slug: 'activity', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('authorizationRoles', { roleId: 'activity-user', name: 'Activity user', isSystem: false, capabilities: ['conversations.read', 'conversations.create', 'conversations.edit'], createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob', 'eve']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: userId, userId, type: 'human', displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { workspaceId, membershipId: userId, principalId: userId, role: userId === 'alice' ? 'owner' : 'member', status: 'active', joinedAt: now, updatedAt: now })
      await ctx.db.insert('authorizationUserRoles', { userId, roleId: 'activity-user', createdAt: now })
    }
  })
  const alice = t.withIdentity({ subject: 'alice' }); const bob = t.withIdentity({ subject: 'bob' }); const eve = t.withIdentity({ subject: 'eve' })
  const { conversationId } = await alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['bob'] })
  await t.run(async ctx => { for (const row of await ctx.db.query('workspaceNotifications').collect()) await ctx.db.delete(row._id) })
  const notify = (id: string, createdAt: number, recipientPrincipalId = 'bob') => t.run(ctx => ctx.db.insert('workspaceNotifications', {
    notificationId: id, workspaceId, recipientPrincipalId, conversationId, actorPrincipalId: 'alice', type: 'message', title: id, createdAt,
  }))
  const args = { workspaceId, conversationId }
  const list = () => bob.query(api.collaboration.nativeActivity.listNotifications, { workspaceId, filter: 'all', paginationOpts: { cursor: null, numItems: 100 } })
  const counts = () => bob.query(api.collaboration.nativeActivity.getUnreadCounts, { workspaceId })
  return { t, alice, bob, eve, args, conversationId, notify, list, counts }
}

test('identity-only notifications recheck live room access and include destinations', async () => {
  const f = await fixture()
  await f.notify('visible', 10)
  expect((await f.list()).page[0]).toMatchObject({ id: 'visible', destination: { conversationId: f.conversationId, kind: 'direct', archived: false } })
  expect((await f.counts()).notifications).toEqual({ count: 1, capped: false })
  expect((await f.eve.query(api.collaboration.nativeActivity.listNotifications, { workspaceId, filter: 'all', paginationOpts: { cursor: null, numItems: 100 } })).page).toEqual([])
  await expect(f.t.query(api.collaboration.nativeActivity.getUnreadCounts, { workspaceId })).rejects.toThrow('UNAUTHENTICATED')
  await f.alice.mutation(api.collaboration.nativeRoomState.removeParticipant, { ...f.args, principalId: 'bob' })
  expect((await f.list()).page).toEqual([])
  expect((await f.counts()).notifications).toEqual({ count: 0, capped: false })
  expect((await f.bob.query(api.collaboration.nativeActivity.getRoomUnreadCounts, { workspaceId, conversationIds: [f.conversationId] })).byConversation).toEqual({})
})

test('unread counts use the unread index, not the first notification page', async () => {
  const f = await fixture()
  await f.t.run(async ctx => {
    for (let i = 0; i < 105; i++) await ctx.db.insert('workspaceNotifications', { notificationId: `unread-${i}`, workspaceId, recipientPrincipalId: 'bob', conversationId: f.conversationId, actorPrincipalId: 'alice', type: 'message', title: 'Unread', createdAt: 1 })
    for (let i = 0; i < 101; i++) await ctx.db.insert('workspaceNotifications', { notificationId: `read-${i}`, workspaceId, recipientPrincipalId: 'bob', conversationId: f.conversationId, actorPrincipalId: 'alice', type: 'message', title: 'Read', createdAt: 2, readAt: 3 })
  })
  expect((await f.list()).page.every(row => row.readAt !== undefined)).toBe(true)
  expect((await f.counts()).notifications).toEqual({ count: 99, capped: true })
  expect((await f.bob.query(api.collaboration.nativeActivity.getRoomUnreadCounts, { workspaceId, conversationIds: [f.conversationId] })).byConversation[f.conversationId]).toEqual({ count: 99, capped: true })
})

async function countBudgetFixture(roomCount: number, rowsPerRoom: number, revoked = false) {
  const f = await fixture()
  await f.t.run(async ctx => {
    for (let r = 0; r < roomCount; r++) {
      const conversationId = await ctx.db.insert('conversations', { workspaceId, userId: 'alice', title: `Room ${r}`, conversationType: 'dm', lastMode: 'act', askModelIds: [], actModelId: 'test', lastModified: 1, createdAt: 1 })
      await ctx.db.insert('conversationParticipants', { workspaceId, conversationId, principalId: 'bob', principalType: 'human', role: 'member', status: revoked ? 'removed' : 'active', removedAt: revoked ? 1 : undefined, roomLastModified: 1, notificationLevel: 'all', joinedAt: 1, updatedAt: 1 })
      for (let i = 0; i < rowsPerRoom; i++) await ctx.db.insert('workspaceNotifications', { notificationId: `budget-${r}-${i}`, workspaceId, recipientPrincipalId: 'bob', conversationId, actorPrincipalId: 'alice', type: 'message', title: 'Unread', createdAt: i })
    }
  })
  return f
}

test('row budget exhaustion caps every uncertain kind and room count', async () => {
  const f = await countBudgetFixture(Math.ceil(UNREAD_ROW_READ_LIMIT / 100) + 1, 100)
  const counts = await f.counts()
  expect(counts.notifications).toEqual({ count: 99, capped: true })
  expect(counts.rooms.capped).toBe(true)
  expect(counts.byKind.channel).toEqual({ count: 0, capped: true })
  expect(counts.byKind.agentThread).toEqual({ count: 0, capped: true })
})

test('revoked rooms consume room and access-check budgets instead of scanning for free', async () => {
  const f = await countBudgetFixture(UNREAD_ROOM_SCAN_LIMIT + 10, 1, true)
  const counts = await f.counts()
  expect(counts.notifications).toEqual({ count: 0, capped: true })
  expect(counts.rooms).toEqual({ count: 0, capped: true })
  expect(Object.values(counts.byKind).every(bucket => bucket.capped)).toBe(true)
  expect(counts.byConversation).toEqual({})
})

test('unread scans authorize the viewer once rather than multiplying role traversal per room', async () => {
  const f = await countBudgetFixture(UNREAD_ROOM_SCAN_LIMIT + 10, 1, true)
  await f.bob.run(async ctx => {
    const reads: Record<string, number> = {}
    const db = new Proxy(ctx.db, { get(target, key) {
      if (key !== 'query') return Reflect.get(target, key)
      return (table: Parameters<typeof ctx.db.query>[0]) => {
        reads[table] = (reads[table] ?? 0) + 1
        return target.query(table)
      }
    } })
    expect((await getUnreadCounts._handler({ ...ctx, db }, { workspaceId })).notifications).toEqual({ count: 0, capped: true })
    expect(reads.authorizationUserRoles).toBe(1)
    expect(reads.authorizationGroupMemberships).toBe(1)
    expect(reads.conversationParticipants).toBe(UNREAD_ROOM_SCAN_LIMIT)
  })
})

test('rare kinds beyond the room budget are unknown, never a false exact zero', async () => {
  const f = await countBudgetFixture(UNREAD_ROOM_SCAN_LIMIT + 10, 1)
  await f.t.run(async ctx => {
    const ordered = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_room_time', q => q.eq('workspaceId', workspaceId).eq('recipientPrincipalId', 'bob').eq('readAt', undefined)).collect()
    await ctx.db.patch(ordered.at(-1)!.conversationId, { conversationType: 'channel', channelSlug: 'rare', channelVisibility: 'public' })
  })
  const counts = await f.counts()
  expect(counts.byKind.channel).toEqual({ count: 0, capped: true })
  expect(counts.rooms).toEqual({ count: UNREAD_ROOM_SCAN_LIMIT, capped: true })
})

test('owned-id reads ignore other recipients, newer arrivals and overlarge requests', async () => {
  const f = await fixture()
  await f.notify('old', 10); await f.notify('new', 20); await f.notify('other', 10, 'eve')
  expect(await f.bob.mutation(api.collaboration.nativeActivity.markNotificationsRead, { workspaceId, notificationIds: ['old', 'new', 'other'], observedThrough: 10 })).toBe(1)
  const rows = await f.t.run(ctx => ctx.db.query('workspaceNotifications').collect())
  expect(rows.find(row => row.notificationId === 'old')?.readAt).toBeDefined()
  expect(rows.find(row => row.notificationId === 'new')?.readAt).toBeUndefined()
  expect(rows.find(row => row.notificationId === 'other')?.readAt).toBeUndefined()
  expect(await f.bob.mutation(api.collaboration.nativeActivity.markNotificationsRead, { workspaceId, notificationIds: [], observedThrough: 10 })).toBe(0)
  await expect(f.bob.mutation(api.collaboration.nativeActivity.markNotificationsRead, { workspaceId, notificationIds: Array(101).fill('old'), observedThrough: 10 })).rejects.toThrow('NOTIFICATION_LIMIT_EXCEEDED')
})

test('mark-all is bounded, replayable and continues with the original watermark', async () => {
  const f = await fixture()
  for (let i = 0; i < 205; i++) await f.notify(`old-${i}`, 10)
  await f.notify('arrived-later', 20)
  const mark = () => f.bob.mutation(api.collaboration.nativeActivity.markAllNotificationsRead, { workspaceId, observedThrough: 10 })
  expect(await mark()).toEqual({ count: 100, hasMore: true })
  expect(await mark()).toEqual({ count: 100, hasMore: true })
  expect(await mark()).toEqual({ count: 5, hasMore: false })
  expect(await mark()).toEqual({ count: 0, hasMore: false })
  expect((await f.counts()).notifications).toEqual({ count: 1, capped: false })
})

test('room reads honor observed sequence and native and legacy reads never regress', async () => {
  vi.useFakeTimers()
  const f = await fixture()
  const first = await f.t.run(async ctx => { const id = await ctx.db.insert('conversationEvents', { ...f.args, userId: 'alice', type: 'message.created', createdAt: Date.now() }); return (await ctx.db.get(id))!._creationTime })
  vi.setSystemTime(Date.now() + 10)
  const second = await f.t.run(async ctx => { const id = await ctx.db.insert('conversationEvents', { ...f.args, userId: 'alice', type: 'message.created', createdAt: Date.now() }); return (await ctx.db.get(id))!._creationTime })
  await f.t.run(async ctx => {
    for (const sequence of [first, second]) await ctx.db.insert('workspaceNotifications', { notificationId: String(sequence), workspaceId, recipientPrincipalId: 'bob', conversationId: f.conversationId, actorPrincipalId: 'alice', type: 'message', title: 'Arrival', createdAt: sequence, eventSequence: sequence })
  })
  const mark = async (observedSequence: number) => (await f.bob.mutation(api.collaboration.nativeActivity.markRoomRead, { ...f.args, observedSequence })).sequence
  expect(await mark(first)).toBe(first)
  expect((await f.counts()).notifications).toEqual({ count: 1, capped: false })
  const participant = () => f.t.run(ctx => ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', f.conversationId).eq('principalId', 'bob')).unique())
  expect((await participant())!.lastReadSequence).toBeLessThan(second)
  expect(await mark(Number.MAX_SAFE_INTEGER)).toBe(second)
  expect((await f.counts()).notifications).toEqual({ count: 0, capped: false })
  expect(await mark(first)).toBe(second)
  await f.bob.mutation(api.collaboration.directMessages.updateParticipantState, { ...f.args, actorUserId: 'bob', readSequence: 0, markRead: true, serverSecret: 'activity-test' })
  expect((await participant())!.lastReadSequence).toBe(second)
  await expect(mark(-1)).rejects.toThrow('INVALID_READ_SEQUENCE')
})

test('channel, archived and agent destinations are projected from current room state', async () => {
  const f = await fixture()
  const message = await f.t.run(async ctx => {
    const message = await ctx.db.insert('conversationMessages', { conversationId: f.conversationId, userId: 'alice', authorPrincipalId: 'alice', authorKind: 'human', role: 'user', mode: 'act', contentType: 'text', turnId: 'root', content: 'Root', createdAt: 1 })
    await ctx.db.insert('workspaceNotifications', { notificationId: 'archived', workspaceId, recipientPrincipalId: 'bob', conversationId: f.conversationId, actorPrincipalId: 'alice', type: 'message', title: 'Root', createdAt: 10, messageId: message, threadRootMessageId: message })
    return message
  })
  expect((await f.list()).page[0].destination).toMatchObject({ messageId: message, threadRootMessageId: message })
  await f.bob.mutation(api.collaboration.nativeRoomState.setRoomArchived, { ...f.args, scope: 'self', archived: true })
  expect((await f.list()).page[0].destination.archived).toBe(true)
  await f.t.run(async ctx => { await ctx.db.patch(f.conversationId, { conversationType: 'channel' }) })
  expect((await f.list()).page[0].destination.kind).toBe('channel')
  await f.t.run(async ctx => {
    await ctx.db.insert('workspaceAgentDefinitions', { agentId: 'activity-agent', workspaceId, principalId: 'agent-p', name: 'Agent', instructions: '', harness: 'overlay', modelId: 'test', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'alice', createdAt: 1, updatedAt: 1 })
    await ctx.db.patch(f.conversationId, { agentId: 'activity-agent' })
  })
  expect((await f.list()).page[0].destination).toMatchObject({ kind: 'agentThread', agentId: 'activity-agent' })
})
