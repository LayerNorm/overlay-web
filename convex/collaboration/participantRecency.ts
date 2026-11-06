import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

type Participant = Omit<Doc<'conversationParticipants'>, '_id' | '_creationTime'>
type Ctx = Pick<MutationCtx, 'db'>

async function recency(ctx: Ctx, conversationId: Id<'conversations'>) {
  const room = await ctx.db.get(conversationId)
  if (!room) throw new Error('CONVERSATION_NOT_FOUND')
  return { roomLastModified: room.lastModified }
}

export async function insertRoomParticipant(ctx: Ctx, value: Participant) {
  return ctx.db.insert('conversationParticipants', { ...value, ...await recency(ctx, value.conversationId) })
}

export async function activateRoomParticipant(ctx: Ctx, id: Id<'conversationParticipants'>, patch: Partial<Participant>) {
  const participant = await ctx.db.get(id)
  if (!participant) throw new Error('PARTICIPANT_NOT_FOUND')
  return ctx.db.patch(id, { ...patch, status: 'active', ...await recency(ctx, participant.conversationId) })
}
