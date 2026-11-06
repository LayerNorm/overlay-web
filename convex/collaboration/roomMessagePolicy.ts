import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { hydrateRemoteMessage, prepareRemoteMessageText } from '../lib/remoteMessageText'
import { assertNativeThreadWritable } from '../lib/nativeThreadCompatibility'

type Access = { actor: { principalId: string }; conversation: Doc<'conversations'> }
type MessageArgs = { conversationId: Id<'conversations'>; messageId: Id<'conversationMessages'> }

export async function editRoomMessage(ctx: MutationCtx, args: MessageArgs & { content: string }, access: Access, limit?: number) {
  const message = await ctx.db.get(args.messageId)
  const content = args.content.trim()
  if (!content) throw new Error('Message content is required')
  if (
    !message
    || message.conversationId !== args.conversationId
    || message.authorKind !== 'human'
    || message.authorPrincipalId !== access.actor.principalId
    || message.deletedAt
  ) return false
  if (limit !== undefined && ((message.remoteTextStored?.chunks ?? 0) > limit || (message.parts?.length ?? 0) > limit)) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
  await assertNativeThreadWritable(ctx, access.conversation, message.threadRootMessageId ?? message._id)
  const hydrated = await hydrateRemoteMessage(ctx, message)
  const parts: NonNullable<Doc<'conversationMessages'>['parts']> = [
    { type: 'text', text: content },
    ...(hydrated.parts ?? []).filter((part) => part.type !== 'text' && part.type !== 'output-text'),
  ]
  const textPatch = message.remoteTextStored
    ? await prepareRemoteMessageText(ctx, message, { content, parts })
    : { content, parts }
  const now = Date.now()
  await ctx.db.patch(message._id, {
    content: textPatch.content,
    parts: textPatch.parts,
    ...('remoteTextStored' in textPatch ? { remoteTextStored: textPatch.remoteTextStored } : {}),
    editedAt: now,
    editHistory: [
      ...(message.editHistory ?? []),
      { content: message.content, editedAt: now },
    ],
    updatedAt: now,
  })
  return true
}

export async function deleteRoomMessage(ctx: MutationCtx, args: MessageArgs, access: Access) {
  const message = await ctx.db.get(args.messageId)
  if (
    !message
    || message.conversationId !== args.conversationId
    || message.authorKind !== 'human'
    || message.authorPrincipalId !== access.actor.principalId
    || message.deletedAt
  ) return false
  await assertNativeThreadWritable(ctx, access.conversation, message.threadRootMessageId ?? message._id)
  const now = Date.now()
  await ctx.db.patch(message._id, { content: '', parts: [], deletedAt: now, updatedAt: now })
  await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
    sourceKind: 'message',
    sourceId: args.messageId,
  })
  return true
}
