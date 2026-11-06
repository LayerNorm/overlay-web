import { v } from 'convex/values'
import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { nativeRoomOrNull, requireNativeRoom } from './nativeRoomAccess'

const workspace = { workspaceId: v.string() }
const filter = v.union(v.literal('all'), v.literal('unread'), v.literal('mentions'), v.literal('threads'), v.literal('reactions'))
const bucket = v.object({ count: v.number(), capped: v.boolean() })
const destination = v.object({ conversationId: v.id('conversations'), kind: v.union(v.literal('direct'), v.literal('channel'), v.literal('agentThread')),
  agentId: v.optional(v.string()), threadRootMessageId: v.optional(v.id('conversationMessages')), messageId: v.optional(v.id('conversationMessages')), archived: v.boolean() })
const item = v.object({ id: v.string(), workspaceId: v.string(), recipientPrincipalId: v.string(), viewerUserId: v.string(), type: v.union(v.literal('mention'), v.literal('thread'), v.literal('message'), v.literal('reaction'), v.literal('participant')),
  conversationId: v.id('conversations'), messageId: v.optional(v.id('conversationMessages')), actorPrincipalId: v.string(), eventSequence: v.optional(v.number()),
  title: v.string(), body: v.optional(v.string()), readAt: v.optional(v.number()), createdAt: v.number(), conversationState: v.optional(v.literal('archived')), destination })
const bounded = (count: number) => ({ count: Math.min(99, count), capped: count > 99 })
export const UNREAD_ROOM_SCAN_LIMIT = 64
export const UNREAD_ROW_READ_LIMIT = 512
export const UNREAD_ACCESS_CHECK_LIMIT = 64

async function markObservedRoomNotifications(ctx: MutationCtx, workspaceId: string, principalId: string, conversationId: Id<'conversations'>, observed: number) {
  const sequenced = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_room_sequence_time', q => q.eq('workspaceId', workspaceId)
    .eq('recipientPrincipalId', principalId).eq('readAt', undefined).eq('conversationId', conversationId).gt('eventSequence', 0).lte('eventSequence', observed)).take(101)
  const legacy = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_room_sequence_time', q => q.eq('workspaceId', workspaceId)
    .eq('recipientPrincipalId', principalId).eq('readAt', undefined).eq('conversationId', conversationId).eq('eventSequence', undefined).lte('createdAt', observed)).take(101)
  const rows = [...sequenced, ...legacy]
  for (const row of rows.slice(0, 100)) await ctx.db.patch(row._id, { readAt: Date.now() })
  return rows.length > 100
}

async function viewer(ctx: Pick<QueryCtx, 'auth' | 'db'>, workspaceId: string) {
  const actor = await requireNativeWorkspace(ctx, workspaceId)
  await requireNativeDeploymentFeature(ctx, 'chat', workspaceId)
  await requireNativeCapability(ctx, actor.userId, 'conversations.read')
  return actor
}

async function notificationItem(ctx: QueryCtx, row: Doc<'workspaceNotifications'>) {
  const access = await nativeRoomOrNull(ctx, { workspaceId: row.workspaceId, conversationId: row.conversationId })
  if (!access) return null
  const archived = access.participant.archivedAt !== undefined
  const message = row.messageId ? await ctx.db.get(row.messageId) : null
  const root = row.threadRootMessageId ? await ctx.db.get(row.threadRootMessageId) : null
  return { id: row.notificationId, workspaceId: row.workspaceId, recipientPrincipalId: row.recipientPrincipalId, viewerUserId: access.viewer.userId, type: row.type, conversationId: row.conversationId,
    actorPrincipalId: row.actorPrincipalId, eventSequence: row.eventSequence, title: row.title.slice(0, 240), body: row.body?.slice(0, 2000),
    messageId: message?.conversationId === row.conversationId ? message._id : undefined, createdAt: row.createdAt, readAt: row.readAt,
    conversationState: archived ? 'archived' as const : undefined,
    destination: { conversationId: row.conversationId, kind: access.conversation.agentId ? 'agentThread' as const : access.conversation.conversationType === 'channel' ? 'channel' as const : 'direct' as const,
      agentId: access.conversation.agentId, archived, messageId: message?.conversationId === row.conversationId ? message._id : undefined,
      threadRootMessageId: root?.conversationId === row.conversationId ? root._id : undefined } }
}

export const listNotifications = query({ args: { ...workspace, filter, paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(item), handler: async (ctx, args) => {
  const actor = await viewer(ctx, args.workspaceId)
  const result = await ctx.db.query('workspaceNotifications').withIndex('by_workspaceId_recipientPrincipalId_createdAt', q => q.eq('workspaceId', args.workspaceId).eq('recipientPrincipalId', actor.principal.principalId))
    .order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
  const rows = await Promise.all(result.page.map(row => notificationItem(ctx, row)))
  return { ...result, page: rows.filter((row): row is NonNullable<typeof row> => Boolean(row && (args.filter === 'all' || (args.filter === 'unread' ? row.readAt === undefined : row.type === args.filter.slice(0, -1))))) }
} })

export const getUnreadCounts = query({ args: workspace, returns: v.object({ workspaceId: v.string(), viewerUserId: v.string(), notifications: bucket, rooms: bucket, byKind: v.object({ direct: bucket, channel: bucket, agentThread: bucket }), byConversation: v.record(v.string(), bucket), observedThrough: v.number() }), handler: async (ctx, args) => {
  const actor = await viewer(ctx, args.workspaceId)
  const principalId = actor.principal.principalId
  let previous: Id<'conversations'> | undefined
  let notifications = 0; let rooms = 0; let observedThrough = 0
  let roomScans = 0; let rowReads = 0; let accessChecks = 0; let complete = false
  const kinds = { direct: 0, channel: 0, agentThread: 0 }
  const byConversation: Record<string, { count: number; capped: boolean }> = {}
  while (roomScans < UNREAD_ROOM_SCAN_LIMIT && rowReads < UNREAD_ROW_READ_LIMIT && accessChecks < UNREAD_ACCESS_CHECK_LIMIT) {
    const next = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_room_time', q => {
      const prefix = q.eq('workspaceId', args.workspaceId).eq('recipientPrincipalId', principalId).eq('readAt', undefined)
      return previous ? prefix.gt('conversationId', previous) : prefix
    }).first()
    if (!next) { complete = true; break }
    rowReads += 1
    roomScans += 1
    previous = next.conversationId
    accessChecks += 1
    const access = await nativeRoomOrNull(ctx, { ...args, conversationId: previous })
    if (!access) continue
    if (rowReads === UNREAD_ROW_READ_LIMIT) break
    const unread = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_room_time', q => q.eq('workspaceId', args.workspaceId)
      .eq('recipientPrincipalId', principalId).eq('readAt', undefined).eq('conversationId', next.conversationId)).order('desc').take(Math.min(100, UNREAD_ROW_READ_LIMIT - rowReads))
    rowReads += unread.length
    notifications += unread.length; rooms += 1
    const kind = access.conversation.agentId ? 'agentThread' : access.conversation.conversationType === 'channel' ? 'channel' : 'direct'
    kinds[kind] += unread.length
    observedThrough = Math.max(observedThrough, unread[0]?.createdAt ?? 0)
  }
  const result = (count: number) => ({ count: Math.min(99, count), capped: !complete || count > 99 })
  return { workspaceId: args.workspaceId, viewerUserId: actor.userId, notifications: result(notifications), rooms: result(rooms), byKind: { direct: result(kinds.direct), channel: result(kinds.channel), agentThread: result(kinds.agentThread) }, byConversation, observedThrough }
} })

export const getRoomUnreadCounts = query({ args: { ...workspace, conversationIds: v.array(v.id('conversations')) }, returns: v.object({ workspaceId: v.string(), viewerUserId: v.string(), byConversation: v.record(v.string(), bucket) }), handler: async (ctx, args) => {
  const actor = await viewer(ctx, args.workspaceId)
  if (args.conversationIds.length > 100) throw new Error('ROOM_LIMIT_EXCEEDED')
  const byConversation: Record<string, { count: number; capped: boolean }> = {}
  for (const conversationId of new Set(args.conversationIds)) {
    if (!await nativeRoomOrNull(ctx, { workspaceId: args.workspaceId, conversationId })) continue
    const rows = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_room_time', q => q.eq('workspaceId', args.workspaceId)
      .eq('recipientPrincipalId', actor.principal.principalId).eq('readAt', undefined).eq('conversationId', conversationId)).take(100)
    byConversation[conversationId] = bounded(rows.length)
  }
  return { workspaceId: args.workspaceId, viewerUserId: actor.userId, byConversation }
} })

export const markRoomRead = mutation({ args: { ...workspace, conversationId: v.id('conversations'), observedSequence: v.number() }, returns: v.object({ sequence: v.number(), hasMore: v.boolean() }), handler: async (ctx, args) => {
  if (!Number.isFinite(args.observedSequence) || args.observedSequence < 0) throw new Error('INVALID_READ_SEQUENCE')
  const access = await requireNativeRoom(ctx, args)
  const latest = await ctx.db.query('conversationEvents').withIndex('by_conversationId', q => q.eq('conversationId', args.conversationId)).order('desc').first()
  const sequence = Math.max(access.participant.lastReadSequence ?? 0, Math.min(args.observedSequence, latest?._creationTime ?? 0))
  await ctx.db.patch(access.participant._id, { lastReadSequence: sequence, lastReadAt: Date.now(), markedUnreadAt: undefined, updatedAt: Date.now() })
  const hasMore = await markObservedRoomNotifications(ctx, args.workspaceId, access.principal.principalId, args.conversationId, Math.min(args.observedSequence, latest?._creationTime ?? 0))
  return { sequence, hasMore }
} })

export const markNotificationsRead = mutation({ args: { ...workspace, notificationIds: v.array(v.string()), observedThrough: v.number() }, returns: v.number(), handler: async (ctx, args) => {
  const actor = await viewer(ctx, args.workspaceId)
  if (!Number.isFinite(args.observedThrough) || args.observedThrough < 0) throw new Error('INVALID_READ_WATERMARK')
  if (args.notificationIds.length > 100) throw new Error('NOTIFICATION_LIMIT_EXCEEDED')
  let count = 0
  for (const id of new Set(args.notificationIds)) {
    const row = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_notification', q => q.eq('workspaceId', args.workspaceId).eq('recipientPrincipalId', actor.principal.principalId).eq('notificationId', id)).unique()
    if (!row || row.readAt !== undefined || row.createdAt > args.observedThrough) continue
    await ctx.db.patch(row._id, { readAt: Date.now() }); count += 1
  }
  return count
} })

export const markAllNotificationsRead = mutation({ args: { ...workspace, observedThrough: v.number() }, returns: v.object({ count: v.number(), hasMore: v.boolean() }), handler: async (ctx, args) => {
  const actor = await viewer(ctx, args.workspaceId)
  if (!Number.isFinite(args.observedThrough) || args.observedThrough < 0) throw new Error('INVALID_READ_WATERMARK')
  const rows = await ctx.db.query('workspaceNotifications').withIndex('by_workspace_recipient_read_time', q => q.eq('workspaceId', args.workspaceId)
    .eq('recipientPrincipalId', actor.principal.principalId).eq('readAt', undefined).lte('createdAt', args.observedThrough)).take(101)
  for (const row of rows.slice(0, 100)) await ctx.db.patch(row._id, { readAt: Date.now() })
  return { count: Math.min(100, rows.length), hasMore: rows.length > 100 }
} })
