import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import { nativeCollaborationMetadata, NATIVE_COLLABORATION_FUNCTIONS_READY } from './collaboration/nativeCollaborationReadiness'

const modules = import.meta.glob('./**/*.ts')
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

test('readiness needs both complete functions and the persisted completed backfill', async () => {
  vi.useFakeTimers()
  vi.stubEnv('INTERNAL_API_SECRET', 'readiness-test')
  const t = convexTest(schema, modules)
  expect(NATIVE_COLLABORATION_FUNCTIONS_READY).toBe(true)
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx, true))).toEqual({})
  const settings = () => t.query(api.platform.uiSettings.getByServer, { userId: 'alice', serverSecret: 'readiness-test' })
  expect(await settings()).not.toHaveProperty('nativeCollaborationRevision')
  await t.mutation(internal.collaboration.nativeRoomMaintenance.kickRoomRecencyBackfill, {})
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx, true))).toEqual({})
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx, true))).toEqual({ nativeCollaborationRevision: 'native-collaboration-v1' })
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx, false))).toEqual({})
  expect(await settings()).toHaveProperty('nativeCollaborationRevision', 'native-collaboration-v1')
  await expect(t.query(api.platform.uiSettings.getByServer, { userId: 'alice', serverSecret: 'wrong' })).rejects.toThrow('Unauthorized')
})

test('backfill persists its cursor, resumes, self-drives and is idempotent', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    const conversationId = await ctx.db.insert('conversations', { userId: 'alice', workspaceId: 'workspace', conversationType: 'dm',
      title: 'Room', lastMode: 'act', askModelIds: [], actModelId: 'test', createdAt: 1, updatedAt: 1, lastModified: 77 })
    for (let i = 0; i < 205; i++) await ctx.db.insert('conversationParticipants', {
      conversationId, workspaceId: 'workspace', principalId: `p${i}`, principalType: 'human', role: 'member', status: 'active',
      notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
    })
  })
  const kick = () => t.mutation(internal.collaboration.nativeRoomMaintenance.kickRoomRecencyBackfill, {})
  const state = () => t.run(ctx => ctx.db.query('migrationMarkers').unique())
  const jobs = () => t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())
  await kick()
  await kick()
  expect(await jobs()).toHaveLength(1)
  await t.mutation(internal.collaboration.nativeRoomMaintenance.runRoomRecencyBackfill, {})
  const first = await state()
  expect(first?.cursor).toBeTruthy()
  expect(first?.completedAt).toBe(0)
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx, true))).toEqual({})
  const progress = await t.run(async ctx => (await ctx.db.query('conversationParticipants').collect()).filter(row => row.roomLastModified === 77).length)
  expect(progress).toBe(100)
  await t.mutation(internal.collaboration.nativeRoomMaintenance.runRoomRecencyBackfill, {})
  expect((await state())?.cursor).not.toBe(first?.cursor)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const done = await state()
  expect(done?.completedAt).toBeGreaterThan(0)
  expect(await t.run(async ctx => (await ctx.db.query('conversationParticipants').collect()).every(row => row.roomLastModified === 77))).toBe(true)
  const count = (await jobs()).length
  await kick()
  await t.mutation(internal.collaboration.nativeRoomMaintenance.runRoomRecencyBackfill, {})
  expect(await state()).toEqual(done)
  expect(await jobs()).toHaveLength(count)
})

test('cron can restart abandoned progress from its persisted cursor', async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  await t.mutation(internal.collaboration.nativeRoomMaintenance.kickRoomRecencyBackfill, {})
  await t.run(async ctx => {
    const state = await ctx.db.query('migrationMarkers').unique()
    await ctx.db.patch(state!._id, { scheduledAt: Date.now() - 120_001 })
  })
  await t.mutation(internal.collaboration.nativeRoomMaintenance.kickRoomRecencyBackfill, {})
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(2)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => nativeCollaborationMetadata(ctx, true))).toHaveProperty('nativeCollaborationRevision')
})
