import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { ROOM_RECENCY_FANOUT } from './collaboration/roomRecencyFanout'
import { NATIVE_ROOM_RECENCY_MIGRATION, nativeCollaborationMetadata } from './collaboration/nativeCollaborationReadiness'

const modules = import.meta.glob('./**/*.ts')
const workspaceId = 'large-legacy'
const secret = 'recency-fanout-test'
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

test('large legacy sends bound synchronous recency writes and the existing cron drains resumable pages', async () => {
  vi.useFakeTimers()
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  const t = convexTest(schema, modules)
  const conversationId = await t.run(async ctx => {
    await ctx.db.insert('migrationMarkers', { key: NATIVE_ROOM_RECENCY_MIGRATION, scope: 'global', completedAt: 1 })
    await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: 'alice', userId: 'alice', type: 'human', displayName: 'Alice', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaceMemberships', { workspaceId, membershipId: 'alice', principalId: 'alice', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
    const id = await ctx.db.insert('conversations', { workspaceId, userId: 'alice', conversationType: 'channel', title: 'Legacy', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'test' })
    for (let i = 0; i < 250; i++) await ctx.db.insert('conversationParticipants', { workspaceId, conversationId: id, principalId: i === 0 ? 'alice' : `legacy-${i}`, principalType: 'human', role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1, roomLastModified: 1 })
    return id
  })
  const send = (turnId: string) => t.mutation(api.collaboration.directMessages.addMessage, { workspaceId, conversationId, actorUserId: 'alice', serverSecret: secret, content: turnId, turnId, clientNonce: turnId })
  const pending = () => t.run(ctx => ctx.db.query('migrationMarkers').withIndex('by_key_scope', q => q.eq('key', ROOM_RECENCY_FANOUT).eq('scope', conversationId)).unique())
  const kick = () => t.mutation(internal.collaboration.nativeRoomMaintenance.kickRoomRecencyBackfill, {})
  await send('first')
  expect(await t.run(async ctx => (await ctx.db.query('conversationParticipants').collect()).filter(p => p.roomLastModified !== 1).length)).toBe(200)
  expect(await pending()).toMatchObject({ completedAt: 0, targetLastModified: Date.now() })
  const scheduled = await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())
  await kick()
  const first = await pending()
  expect(first?.cursor).toBeTruthy()
  vi.setSystemTime(Date.now() + 10)
  await send('second')
  expect((await pending())?.cursor).toBe(first?.cursor)
  expect((await pending())?.targetLastModified).toBe(first?.targetLastModified)
  for (let page = 0; page < 6; page++) { vi.setSystemTime(Date.now() + 10); await kick() }
  expect(await pending()).toBeNull()
  await t.run(async ctx => {
    const room = await ctx.db.get(conversationId)
    expect((await ctx.db.query('conversationParticipants').collect()).every(p => p.roomLastModified === room!.lastModified)).toBe(true)
  })
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx))).toEqual({ nativeCollaborationRevision: 'native-collaboration-v1' })
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(scheduled.length + 1)
  await kick()
  expect(await pending()).toBeNull()
  await t.run(ctx => ctx.db.insert('migrationMarkers', { key: ROOM_RECENCY_FANOUT, scope: conversationId, completedAt: 0 }))
  await t.run(ctx => ctx.db.delete(conversationId))
  await kick()
  expect(await pending()).toBeNull()
})
