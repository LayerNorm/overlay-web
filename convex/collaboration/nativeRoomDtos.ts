import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { hydrateRemoteMessage, type HydratedRemoteMessage } from '../lib/remoteMessageText'
import type { requireNativeRoom } from './nativeRoomAccess'

export const roomSummaryValidator = v.object({
  conversationId: v.id('conversations'), workspaceId: v.string(), title: v.string(),
  kind: v.union(v.literal('direct'), v.literal('channel')), agentId: v.optional(v.string()),
  lastModified: v.number(), archivedAt: v.optional(v.number()),
})
export const roomParticipantValidator = v.object({
  conversationId: v.id('conversations'), workspaceId: v.string(),
  principalId: v.string(), principalType: v.union(v.literal('human'), v.literal('agent')),
  displayName: v.string(), role: v.union(v.literal('moderator'), v.literal('member')),
  photoUrl: v.optional(v.string()), email: v.optional(v.string()),
  status: v.union(v.literal('active'), v.literal('removed')),
  notificationLevel: v.union(v.literal('all'), v.literal('mentions'), v.literal('muted')),
  joinedAt: v.number(), updatedAt: v.number(), removedAt: v.optional(v.number()),
  lastReadAt: v.optional(v.number()), lastReadSequence: v.optional(v.number()),
  markedUnreadAt: v.optional(v.number()), archivedAt: v.optional(v.number()),
})
export const roomDetailValidator = v.object({
  ...roomSummaryValidator.fields, participants: v.array(roomParticipantValidator),
  viewerPrincipalId: v.string(), viewerUserId: v.string(), externalPlatform: v.optional(v.string()),
  topic: v.optional(v.string()), visibility: v.optional(v.union(v.literal('public'), v.literal('private'))),
  slug: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
})
export const roomMessageValidator = v.object({
  id: v.id('conversationMessages'), conversationId: v.id('conversations'), turnId: v.string(),
  role: v.union(v.literal('user'), v.literal('assistant')),
  authorKind: v.optional(v.union(v.literal('human'), v.literal('agent'), v.literal('model'), v.literal('system'))),
  authorPrincipalId: v.optional(v.string()), content: v.string(), partsJson: v.string(),
  importedAuthorName: v.optional(v.string()), importedAuthorEmail: v.optional(v.string()),
  importedAuthorStatus: v.optional(v.union(v.literal('member'), v.literal('invited'), v.literal('not_invited'))),
  agentPlanJson: v.string(),
  clientNonce: v.optional(v.string()), threadRootMessageId: v.optional(v.id('conversationMessages')),
  createdAt: v.number(), updatedAt: v.optional(v.number()), eventSequence: v.optional(v.number()),
  status: v.optional(v.union(v.literal('generating'), v.literal('completed'), v.literal('error'))),
  editedAt: v.optional(v.number()), deletedAt: v.optional(v.number()),
})

export function roomSummary(access: Awaited<ReturnType<typeof requireNativeRoom>>) {
  const { conversation, participant } = access
  return {
    conversationId: conversation._id, workspaceId: access.viewer.workspaceId,
    title: conversation.title.slice(0, 240), kind: conversation.conversationType === 'channel' ? 'channel' as const : 'direct' as const,
    agentId: conversation.agentId, lastModified: conversation.lastModified, archivedAt: participant.archivedAt,
  }
}

export async function roomMessage(ctx: Pick<QueryCtx, 'db'>, row: Doc<'conversationMessages'>) {
  if ((row.remoteTextStored?.chunks ?? 0) > 200 || (row.parts?.length ?? 0) > 200) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
  const message: HydratedRemoteMessage = row.deletedAt === undefined ? await hydrateRemoteMessage(ctx, row) : row
  const content = message.deletedAt === undefined ? message.content : ''
  const partsJson = JSON.stringify(message.deletedAt === undefined ? message.parts ?? [] : [])
  const agentPlanJson = JSON.stringify(message.deletedAt === undefined ? message.agentPlan ?? [] : [])
  if (content.length > 64_000 || partsJson.length > 64_000 || agentPlanJson.length > 64_000) throw new Error('ROOM_MESSAGE_LIMIT_EXCEEDED')
  return {
    id: row._id, conversationId: row.conversationId, turnId: row.turnId, role: row.role,
    authorKind: row.authorKind ?? (row.role === 'assistant' ? 'model' : 'human'), authorPrincipalId: row.authorPrincipalId, content, partsJson, agentPlanJson,
    importedAuthorName: row.importedAuthorName?.slice(0, 240), importedAuthorEmail: row.importedAuthorEmail?.slice(0, 320), importedAuthorStatus: row.importedAuthorStatus,
    clientNonce: row.clientNonce, threadRootMessageId: row.threadRootMessageId,
    createdAt: row.createdAt, updatedAt: message.updatedAt, eventSequence: message.eventSequence,
    status: row.status, editedAt: row.editedAt, deletedAt: row.deletedAt,
  }
}
