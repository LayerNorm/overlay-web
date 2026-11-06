import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { loadRoomPresence } from './collaboration/nativePresence'

const modules = import.meta.glob('./**/*.ts')
const workspaceId = 'room-state'
beforeEach(() => {
  vi.stubEnv('INTERNAL_API_SECRET', 'room-state-test')
  vi.stubEnv('OVERLAY_BFF_URL', 'https://rooms.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://rooms.convex.cloud')
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

async function fixture() {
  const t = convexTest(schema, modules)
  const now = Date.now()
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', { key: 'web', sequence: 1, challenge: 'test', sourceOrigin: 'https://rooms.example.test', expiresAt: now + 3_600_000,
      snapshot: { version: 1, backendUrl: 'https://rooms.convex.cloud', revision: 'a'.repeat(64), features: { chat: true }, rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } } })
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Room state', slug: 'room-state', status: 'active', createdAt: now, updatedAt: now })
    await ctx.db.insert('authorizationRoles', { roleId: 'room-user', name: 'Room user', isSystem: false, capabilities: ['conversations.read', 'conversations.create', 'conversations.edit'], createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob', 'eve']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: userId, userId, type: 'human', displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { workspaceId, membershipId: userId, principalId: userId, role: userId === 'alice' ? 'owner' : 'member', status: 'active', joinedAt: now, updatedAt: now })
      await ctx.db.insert('authorizationUserRoles', { userId, roleId: 'room-user', createdAt: now })
    }
  })
  const alice = t.withIdentity({ subject: 'alice' })
  const bob = t.withIdentity({ subject: 'bob' })
  const eve = t.withIdentity({ subject: 'eve' })
  const { conversationId } = await alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['bob'] })
  const args = { workspaceId, conversationId }
  const messageId = await t.run(ctx => ctx.db.insert('conversationMessages', { conversationId, userId: 'alice', authorPrincipalId: 'alice', authorKind: 'human', role: 'user', mode: 'act', contentType: 'text', turnId: 'turn', content: 'Hello', parts: [], createdAt: now }))
  return { t, alice, bob, eve, args, messageId }
}

describe('native room metadata and presence', () => {
  test('presence uses one global 200-row read budget rather than multiplying by participants', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      for (let p = 0; p < 5; p++) {
        const principalId = `session-owner-${p}`
        await ctx.db.insert('conversationParticipants', { ...f.args, principalId, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 })
        for (let s = 0; s < 200; s++) await ctx.db.insert('workspacePresence', { workspaceId, principalId, sessionId: `session-${s}`, status: 'online', lastSeenAt: 1, updatedAt: 1 })
      }
    })
    await f.bob.mutation(api.collaboration.nativePresence.heartbeat, { ...f.args, sessionId: 'live', typing: true })
    await f.t.run(async ctx => {
      let presenceRowsRead = 0
      function measured<T extends object>(query: T): T {
        return new Proxy(query, { get(target, key) {
          const method = Reflect.get(target, key)
          if (typeof method !== 'function') return method
          return (...args: unknown[]) => {
            const result = Reflect.apply(method, target, args)
            if (key === 'take') return result.then((rows: unknown[]) => { presenceRowsRead += rows.length; return rows })
            return measured(result)
          }
        } })
      }
      const db = new Proxy(ctx.db, { get(target, key) {
        if (key !== 'query') return Reflect.get(target, key)
        return (table: Parameters<typeof ctx.db.query>[0]) => table === 'workspacePresence' ? measured(target.query(table)) : target.query(table)
      } })
      const rows = await loadRoomPresence({ db }, f.args)
      expect(rows.some(row => row.sessionId === 'live')).toBe(true)
      expect(presenceRowsRead).toBe(200)
    })
  })
  test('historical presence rows never hide a live session or prevent a heartbeat', async () => {
    const f = await fixture()
    await f.t.run(async ctx => {
      for (let i = 0; i < 250; i++) await ctx.db.insert('workspacePresence', { workspaceId, principalId: 'bob', sessionId: `stale-${i}`, status: 'online', lastSeenAt: 1, updatedAt: 1 })
    })
    await f.bob.mutation(api.collaboration.nativePresence.heartbeat, { ...f.args, sessionId: 'live', typing: true })
    const rows = await f.alice.query(api.collaboration.nativePresence.watchPresence, f.args)
    expect(rows).toHaveLength(200)
    expect(rows![0]).toMatchObject({ principalId: 'bob', sessionId: 'live', status: 'online' })
    expect(rows![0].expiresAt).toBeGreaterThan(Date.now())
  })
  test('exact access fails closed and removal revokes every native room surface', async () => {
    const f = await fixture()
    expect(await f.eve.query(api.collaboration.nativeRoomState.getRoomState, f.args)).toBeNull()
    expect(await f.t.query(api.collaboration.nativeRoomState.getRoomState, f.args)).toBeNull()
    expect(await f.alice.query(api.collaboration.nativeRoomState.getRoomState, { ...f.args, workspaceId: 'foreign' })).toBeNull()
    await expect(f.bob.mutation(api.collaboration.nativeRoomState.removeParticipant, { ...f.args, principalId: 'alice' })).rejects.toThrow('MODERATOR_REQUIRED')
    await expect(f.alice.mutation(api.collaboration.nativeRoomState.addParticipant, { ...f.args, principalId: 'eve' })).rejects.toThrow('DIRECT_MESSAGE_REQUIRES_NEW_GROUP')
    await f.bob.mutation(api.collaboration.nativeRoomState.setSaved, { ...f.args, messageId: f.messageId, saved: true })
    await f.alice.mutation(api.collaboration.nativeRoomState.removeParticipant, { ...f.args, principalId: 'bob' })
    expect(await f.bob.query(api.collaboration.nativeRooms.getRoom, f.args)).toBeNull()
    expect(await f.bob.query(api.collaboration.nativeRooms.listMessages, { ...f.args, paginationOpts: { numItems: 10, cursor: null } })).toBeNull()
    expect(await f.bob.query(api.collaboration.nativeRoomState.getRoomState, f.args)).toBeNull()
    expect(await f.bob.query(api.collaboration.nativeRoomState.listReactions, { ...f.args, messageIds: [f.messageId] })).toBeNull()
    expect(await f.bob.query(api.collaboration.nativePresence.watchPresence, f.args)).toBeNull()
    expect((await f.bob.query(api.collaboration.nativeRoomState.listSavedMessages, { workspaceId, paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([])
  })

  test('concurrent reactions converge, enforce message scope and replay without duplicate effects', async () => {
    const f = await fixture()
    const args = { ...f.args, messageId: f.messageId, emoji: '👍', enabled: true }
    await Promise.all([f.alice.mutation(api.collaboration.nativeRoomState.setReaction, args), f.bob.mutation(api.collaboration.nativeRoomState.setReaction, args)])
    await f.bob.mutation(api.collaboration.nativeRoomState.setReaction, args)
    const rows = await f.alice.query(api.collaboration.nativeRoomState.listReactions, { ...f.args, messageIds: [f.messageId] })
    expect(rows).toMatchObject([{ count: 2, reactedByCurrentPrincipal: true }])
    expect(new Set(rows![0].principalIds)).toEqual(new Set(['alice', 'bob']))
    expect(await f.alice.query(api.collaboration.nativeRoomState.listReactions, { ...f.args, messageIds: [] })).toEqual([])
    await expect(f.alice.query(api.collaboration.nativeRoomState.listReactions, { ...f.args, messageIds: Array(101).fill(f.messageId) })).rejects.toThrow('MESSAGE_LIMIT_EXCEEDED')
    const foreign = await f.alice.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['eve'] })
    await expect(f.alice.query(api.collaboration.nativeRoomState.listReactions, { workspaceId, conversationId: foreign.conversationId, messageIds: [f.messageId] })).rejects.toThrow('Message not found')
    await expect(f.eve.mutation(api.collaboration.nativeRoomState.setReaction, args)).rejects.toThrow('ROOM_ACCESS_DENIED')
    expect((await f.t.run(ctx => ctx.db.query('workspaceNotifications').collect())).filter(row => row.type === 'reaction')).toHaveLength(1)
  })

  test('pin, save and follow are idempotent; saved pages retain equal-timestamp rows', async () => {
    const f = await fixture()
    const args = { ...f.args, messageId: f.messageId }
    expect(await f.alice.mutation(api.collaboration.nativeRoomState.setPinned, { ...args, pinned: true })).toBe(true)
    expect(await f.alice.mutation(api.collaboration.nativeRoomState.setPinned, { ...args, pinned: true })).toBe(false)
    await f.alice.mutation(api.collaboration.nativeRoomState.setSaved, { ...args, saved: true })
    await f.alice.mutation(api.collaboration.nativeRoomState.setSaved, { ...args, saved: true })
    await f.alice.mutation(api.collaboration.nativeRoomState.setThreadFollow, { ...f.args, threadRootMessageId: f.messageId, followed: true })
    await f.alice.mutation(api.collaboration.nativeRoomState.setThreadFollow, { ...f.args, threadRootMessageId: f.messageId, followed: true })
    const state = await f.alice.query(api.collaboration.nativeRoomState.getRoomState, f.args)
    expect(state?.pins).toHaveLength(1); expect(state?.savedMessages).toHaveLength(1); expect(state?.follows).toHaveLength(1)
    const bob = await f.bob.query(api.collaboration.nativeRoomState.getRoomState, f.args)
    expect(bob?.savedMessages).toEqual([]); expect(bob?.follows).toEqual([])
    expect(await f.alice.mutation(api.collaboration.nativeRoomState.setPinned, { ...args, pinned: false })).toBe(true)
    expect(await f.alice.mutation(api.collaboration.nativeRoomState.setPinned, { ...args, pinned: false })).toBe(false)
    const second = await f.t.run(ctx => ctx.db.insert('conversationMessages', { conversationId: f.args.conversationId, userId: 'alice', role: 'user', mode: 'act', contentType: 'text', turnId: 'second', content: 'Second', createdAt: 1 }))
    await f.alice.mutation(api.collaboration.nativeRoomState.setSaved, { ...f.args, messageId: second, saved: true })
    await f.t.run(async ctx => { for (const row of await ctx.db.query('conversationSavedMessages').collect()) await ctx.db.patch(row._id, { createdAt: 1 }) })
    const first = await f.alice.query(api.collaboration.nativeRoomState.listSavedMessages, { workspaceId, paginationOpts: { numItems: 1, cursor: null } })
    const next = await f.alice.query(api.collaboration.nativeRoomState.listSavedMessages, { workspaceId, paginationOpts: { numItems: 1, cursor: first.continueCursor } })
    expect(new Set([...first.page, ...next.page].map(row => row.messageId))).toEqual(new Set([f.messageId, second]))
  })

  test('self/everyone archive, owner guard and restore preserve caller scope', async () => {
    const f = await fixture()
    await f.alice.mutation(api.collaboration.nativeRoomState.setRoomArchived, { ...f.args, scope: 'self', archived: true })
    expect((await f.alice.query(api.collaboration.nativeRoomState.getRoomState, f.args))?.viewerState.archivedAt).toBeTypeOf('number')
    expect((await f.bob.query(api.collaboration.nativeRoomState.getRoomState, f.args))?.viewerState.archivedAt).toBeUndefined()
    const archived = await f.alice.query(api.collaboration.nativeRooms.listRooms, { workspaceId, kind: 'direct', archived: true, paginationOpts: { numItems: 10, cursor: null } })
    expect(archived.page.map(row => row.conversationId)).toContain(f.args.conversationId)
    await expect(f.bob.mutation(api.collaboration.nativeRoomState.setRoomArchived, { ...f.args, scope: 'everyone', archived: true })).rejects.toThrow('WORKSPACE_OWNER_REQUIRED')
    await f.alice.mutation(api.collaboration.nativeRoomState.setRoomArchived, { ...f.args, scope: 'everyone', archived: true })
    expect((await f.bob.query(api.collaboration.nativeRoomState.getRoomState, f.args))?.viewerState.archivedAt).toBeTypeOf('number')
    await f.alice.mutation(api.collaboration.nativeRoomState.restore, { ...f.args, scope: 'self' })
    expect((await f.bob.query(api.collaboration.nativeRoomState.getRoomState, f.args))?.viewerState.archivedAt).toBeTypeOf('number')
    await f.alice.mutation(api.collaboration.nativeRoomState.restore, { ...f.args, scope: 'everyone' })
    expect((await f.bob.query(api.collaboration.nativeRoomState.getRoomState, f.args))?.viewerState.archivedAt).toBeUndefined()
  })

  test('channel additions preserve policy and metadata traversals fail closed above 200', async () => {
    const f = await fixture()
    const channel = await f.alice.mutation(api.collaboration.nativeRooms.createChannel, { workspaceId, name: 'Room', visibility: 'private', principalIds: ['bob'] })
    const args = { workspaceId, conversationId: channel.conversationId }
    await expect(f.bob.mutation(api.collaboration.nativeRoomState.addParticipant, { ...args, principalId: 'eve' })).rejects.toThrow('MODERATOR_REQUIRED')
    await f.alice.mutation(api.collaboration.nativeRoomState.addParticipant, { ...args, principalId: 'eve' })
    expect((await f.eve.query(api.collaboration.nativeRoomState.getRoomState, args))?.participants).toHaveLength(3)
    await f.t.run(async ctx => { for (let i = 0; i < 198; i++) await ctx.db.insert('conversationParticipants', { ...args, principalId: `extra-${i}`, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1 }) })
    await expect(f.alice.query(api.collaboration.nativeRoomState.getRoomState, args)).rejects.toThrow('ROOM_RELATED_LIMIT_EXCEEDED')
  })

  test('presence queries return absolute deadlines unchanged as time passes without writes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_900_000_000_000)
    const f = await fixture()
    await f.bob.mutation(api.collaboration.nativePresence.heartbeat, { ...f.args, sessionId: 'tab', typing: true })
    const initial = await f.alice.query(api.collaboration.nativePresence.watchPresence, f.args)
    expect(initial).toMatchObject([{ principalId: 'bob', status: 'online', expiresAt: 1_900_000_120_000, typingExpiresAt: 1_900_000_006_000 }])
    vi.setSystemTime(1_900_000_121_000)
    expect(await f.alice.query(api.collaboration.nativePresence.watchPresence, f.args)).toEqual(initial)
    await expect(f.eve.mutation(api.collaboration.nativePresence.heartbeat, { ...f.args, typing: true })).rejects.toThrow('ROOM_ACCESS_DENIED')
    const other = await f.bob.mutation(api.collaboration.nativeRooms.createDirectMessage, { workspaceId, principalIds: ['eve'] })
    await f.bob.mutation(api.collaboration.nativePresence.heartbeat, { workspaceId, conversationId: other.conversationId, sessionId: 'tab', typing: true })
    const elsewhere = await f.alice.query(api.collaboration.nativePresence.watchPresence, f.args)
    expect(elsewhere).toMatchObject([{ principalId: 'bob', conversationId: f.args.conversationId, status: 'online' }])
    expect(elsewhere![0].typingExpiresAt).toBeUndefined()
  })
})
