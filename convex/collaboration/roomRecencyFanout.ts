import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

export const ROOM_RECENCY_FANOUT = 'native-room-recency-fanout-v1'

export async function projectRoomRecency(ctx: Pick<MutationCtx, 'db'>, room: Doc<'conversations'>) {
  const participants = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_status', q => q.eq('conversationId', room._id).eq('status', 'active')).take(201)
  await Promise.all(participants.slice(0, 200).filter(p => p.roomLastModified !== room.lastModified)
    .map(p => ctx.db.patch(p._id, { roomLastModified: room.lastModified })))
  if (participants.length <= 200) return
  const pending = await ctx.db.query('migrationMarkers')
    .withIndex('by_key_scope', q => q.eq('key', ROOM_RECENCY_FANOUT).eq('scope', room._id)).unique()
  if (!pending) await ctx.db.insert('migrationMarkers', { key: ROOM_RECENCY_FANOUT, scope: room._id,
    completedAt: 0, scheduledAt: Date.now(), targetLastModified: room.lastModified })
}

export async function drainRoomRecencyFanout(ctx: Pick<MutationCtx, 'db'>) {
  const pending = await ctx.db.query('migrationMarkers')
    .withIndex('by_key_scheduledAt', q => q.eq('key', ROOM_RECENCY_FANOUT)).first()
  if (!pending) return
  const conversationId = ctx.db.normalizeId('conversations', pending.scope)
  const room = conversationId ? await ctx.db.get(conversationId) : null
  if (!room || room.deletedAt !== undefined) { await ctx.db.delete(pending._id); return }
  const page = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_status', q => q.eq('conversationId', room._id).eq('status', 'active'))
    .paginate({ numItems: 100, cursor: pending.cursor ?? null })
  await Promise.all(page.page.filter(p => p.roomLastModified !== room.lastModified)
    .map(p => ctx.db.patch(p._id, { roomLastModified: room.lastModified })))
  if (page.isDone && pending.targetLastModified === room.lastModified) { await ctx.db.delete(pending._id); return }
  await ctx.db.patch(pending._id, { cursor: page.isDone ? undefined : page.continueCursor,
    targetLastModified: page.isDone ? room.lastModified : pending.targetLastModified, scheduledAt: Date.now() })
}
