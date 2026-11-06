import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { requireNativeRoom, nativeRoomOrNull } from './nativeRoomAccess'
import { heartbeatForActor } from './roomStateActions'

const status = v.union(v.literal('online'), v.literal('away'), v.literal('offline'))
const row = v.object({ workspaceId: v.string(), conversationId: v.optional(v.id('conversations')), principalId: v.string(), sessionId: v.optional(v.string()),
  status, lastSeenAt: v.number(), expiresAt: v.number(), typingExpiresAt: v.optional(v.number()) })

export const heartbeat = mutation({ args: { workspaceId: v.string(), conversationId: v.optional(v.id('conversations')), sessionId: v.optional(v.string()),
  status: v.optional(status), typing: v.optional(v.boolean()) }, returns: v.null(), handler: async (ctx, args) => {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  await requireNativeDeploymentFeature(ctx, 'chat', args.workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
  if (args.conversationId) await requireNativeRoom(ctx, { ...args, conversationId: args.conversationId })
  if (args.sessionId !== undefined && (!args.sessionId.trim() || args.sessionId.length > 200)) throw new Error('INVALID_SESSION_ID')
  await heartbeatForActor(ctx, { ...args, sessionId: args.sessionId ?? 'native', status: args.status ?? 'online', actorUserId: viewer.userId }, viewer.principal.principalId, true)
  return null
} })

export const watchPresence = query({ args: { workspaceId: v.string(), conversationId: v.id('conversations') }, returns: v.union(v.array(row), v.null()), handler: async (ctx, args) => {
  if (!await nativeRoomOrNull(ctx, args)) return null
  return loadRoomPresence(ctx, args)
} })

export async function loadRoomPresence(ctx: Pick<QueryCtx, 'db'>, args: { workspaceId: string; conversationId: Id<'conversations'> }) {
  const participants = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_status', q => q.eq('conversationId', args.conversationId).eq('status', 'active')).take(201)
  if (participants.length > 200) return []
  const allowed = new Set(participants.filter(p => p.workspaceId === args.workspaceId && p.removedAt === undefined).map(p => p.principalId))
  const rows = await ctx.db.query('workspacePresence').withIndex('by_workspaceId_updatedAt', q => q.eq('workspaceId', args.workspaceId)).order('desc').take(200)
  return rows.filter(p => allowed.has(p.principalId)).map(p => ({ workspaceId: p.workspaceId, conversationId: args.conversationId,
    principalId: p.principalId, sessionId: p.sessionId, status: p.status, lastSeenAt: p.lastSeenAt, expiresAt: p.lastSeenAt + 120_000,
    typingExpiresAt: p.conversationId === args.conversationId ? p.typingExpiresAt : undefined }))
}
