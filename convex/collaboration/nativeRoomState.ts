import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { nativeRoomOrNull, requireNativeRoom, type NativeRoomArgs } from './nativeRoomAccess'
import { roomParticipantValidator } from './nativeRoomDtos'
import { participantViews, resolvedPrincipalName } from './roomParticipants'
import { addParticipantForActor, archiveConversationForEveryoneForActor, groupReactions, relatedRows, removeParticipantForActor,
  requireStateMessage, setPinnedForActor, setReactionForActor, setSavedForActor, setThreadFollowForActor } from './roomStateActions'

const roomArgs = { workspaceId: v.string(), conversationId: v.id('conversations') }
const messageArgs = { ...roomArgs, messageId: v.id('conversationMessages') }
const level = v.union(v.literal('all'), v.literal('mentions'), v.literal('muted'))
const scope = v.union(v.literal('self'), v.literal('everyone'))
const pin = v.object({ conversationId: v.id('conversations'), messageId: v.id('conversationMessages'), pinnedByPrincipalId: v.string(), createdAt: v.number() })
const saved = v.object({ conversationId: v.id('conversations'), messageId: v.id('conversationMessages'), principalId: v.string(), createdAt: v.number() })
const follow = v.object({ conversationId: v.id('conversations'), threadRootMessageId: v.id('conversationMessages'), principalId: v.string(), followedAt: v.number() })
const reaction = v.object({ conversationId: v.id('conversations'), messageId: v.id('conversationMessages'), emoji: v.string(), principalIds: v.array(v.string()), count: v.number(), reactedByCurrentPrincipal: v.boolean() })
const state = v.object({ ...roomArgs, viewerUserId: v.string(), viewerPrincipalId: v.string(), participants: v.array(roomParticipantValidator),
  viewerState: v.object({ notificationLevel: level, archivedAt: v.optional(v.number()), lastReadSequence: v.optional(v.number()), markedUnreadAt: v.optional(v.number()) }),
  pins: v.array(pin), pinsCapped: v.boolean(), follows: v.array(follow), savedMessages: v.array(saved) })

export const getRoomState = query({ args: roomArgs, returns: v.union(state, v.null()), handler: async (ctx, args) => {
  const access = await nativeRoomOrNull(ctx, args)
  if (!access) return null
  const [participants, pins, follows, saves] = await Promise.all([
    participantViews(ctx, args.conversationId, 200),
    ctx.db.query('conversationPins').withIndex('by_conversationId_createdAt', q => q.eq('conversationId', args.conversationId)).order('desc').take(51),
    relatedRows(ctx.db.query('conversationThreadFollows').withIndex('by_conversationId_principalId_followedAt', q => q.eq('conversationId', args.conversationId).eq('principalId', access.principal.principalId)), true),
    relatedRows(ctx.db.query('conversationSavedMessages').withIndex('by_conversationId_principalId_createdAt', q => q.eq('conversationId', args.conversationId).eq('principalId', access.principal.principalId)), true),
  ])
  const p = access.participant
  return { ...args, viewerUserId: access.viewer.userId, viewerPrincipalId: access.principal.principalId,
    participants: participants.map(row => ({ ...row, displayName: row.displayName.slice(0, 240), email: row.email?.slice(0, 320) })),
    viewerState: { notificationLevel: p.notificationLevel, archivedAt: p.archivedAt, lastReadSequence: p.lastReadSequence, markedUnreadAt: p.markedUnreadAt },
    pins: pins.slice(0, 50).map(({ conversationId, messageId, pinnedByPrincipalId, createdAt }) => ({ conversationId, messageId, pinnedByPrincipalId, createdAt })), pinsCapped: pins.length > 50,
    follows: follows.filter(row => row.principalId === access.principal.principalId).map(({ conversationId, threadRootMessageId, principalId, followedAt }) => ({ conversationId, threadRootMessageId, principalId, followedAt })),
    savedMessages: saves.filter(row => row.principalId === access.principal.principalId).map(({ conversationId, messageId, principalId, createdAt }) => ({ conversationId, messageId, principalId, createdAt })) }
} })

export const listReactions = query({ args: { ...roomArgs, messageIds: v.array(v.id('conversationMessages')) }, returns: v.union(v.array(reaction), v.null()), handler: async (ctx, args) => {
  const access = await nativeRoomOrNull(ctx, args)
  if (!access) return null
  if (args.messageIds.length > 100) throw new Error('MESSAGE_LIMIT_EXCEEDED')
  const rows = await Promise.all([...new Set(args.messageIds)].map(async messageId => {
    await requireStateMessage(ctx, args.conversationId, messageId)
    return relatedRows(ctx.db.query('conversationMessageReactions').withIndex('by_messageId_principalId_emoji', q => q.eq('messageId', messageId)), true)
  }))
  if (rows.flat().length > 200) throw new Error('ROOM_RELATED_LIMIT_EXCEEDED')
  return groupReactions(rows.flat(), access.principal.principalId)
} })

export const listSavedMessages = query({ args: { workspaceId: v.string(), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(saved), handler: async (ctx, args) => {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  await requireNativeDeploymentFeature(ctx, 'chat', args.workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
  const page = await ctx.db.query('conversationSavedMessages').withIndex('by_workspaceId_principalId_createdAt', q => q.eq('workspaceId', args.workspaceId).eq('principalId', viewer.principal.principalId))
    .order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
  const rows = await Promise.all(page.page.map(async row => {
    const access = await nativeRoomOrNull(ctx, { ...args, conversationId: row.conversationId })
    const message = await ctx.db.get(row.messageId)
    return access && message?.conversationId === row.conversationId && message.deletedAt === undefined
      ? { conversationId: row.conversationId, messageId: row.messageId, principalId: row.principalId, createdAt: row.createdAt } : null
  }))
  return { ...page, page: rows.filter(row => row !== null) }
} })

async function writeAccess(ctx: MutationCtx, args: NativeRoomArgs) {
  const access = await requireNativeRoom(ctx, args)
  await requireNativeCapability(ctx, access.viewer.userId, 'conversations.edit')
  return { ...access, actor: { ...access.principal, displayName: await resolvedPrincipalName(ctx, access.principal) } }
}
export const setReaction = mutation({ args: { ...messageArgs, emoji: v.string(), enabled: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  await setReactionForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access, true)
  return null
} })
export const setPinned = mutation({ args: { ...messageArgs, pinned: v.boolean() }, returns: v.boolean(), handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  return setPinnedForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access)
} })
export const setSaved = mutation({ args: { ...messageArgs, saved: v.boolean() }, returns: v.boolean(), handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  return setSavedForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access)
} })
export const setThreadFollow = mutation({ args: { ...roomArgs, threadRootMessageId: v.id('conversationMessages'), followed: v.boolean() }, returns: v.boolean(), handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  return setThreadFollowForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access)
} })
export const setNotificationLevel = mutation({ args: { ...roomArgs, notificationLevel: level }, returns: v.null(), handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  await ctx.db.patch(access.participant._id, { notificationLevel: args.notificationLevel, updatedAt: Date.now() })
  return null
} })
async function archive(ctx: MutationCtx, args: NativeRoomArgs & { scope: 'self' | 'everyone'; archived: boolean }) {
  const access = await writeAccess(ctx, args)
  if (args.scope === 'everyone') {
    if (access.membership.role !== 'owner') throw new Error('WORKSPACE_OWNER_REQUIRED')
    await archiveConversationForEveryoneForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access, true)
  } else await ctx.db.patch(access.participant._id, { archivedAt: args.archived ? Date.now() : undefined, updatedAt: Date.now() })
  return null
}
export const setRoomArchived = mutation({ args: { ...roomArgs, scope, archived: v.boolean() }, returns: v.null(), handler: archive })
export const restore = mutation({ args: { ...roomArgs, scope }, returns: v.null(), handler: (ctx, args) => archive(ctx, { ...args, archived: false }) })
export const addParticipant = mutation({ args: { ...roomArgs, principalId: v.string() }, returns: roomParticipantValidator, handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  const participant = await addParticipantForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access, true)
  return { ...participant, displayName: participant.displayName.slice(0, 240), email: participant.email?.slice(0, 320) }
} })
export const removeParticipant = mutation({ args: { ...roomArgs, principalId: v.string() }, returns: v.boolean(), handler: async (ctx, args) => {
  const access = await writeAccess(ctx, args)
  return removeParticipantForActor(ctx, { ...args, actorUserId: access.viewer.userId }, access, true)
} })
