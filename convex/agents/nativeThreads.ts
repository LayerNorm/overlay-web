import { paginationOptsValidator, paginationResultValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query, type QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { requireNativeRoom } from '../collaboration/nativeRoomAccess'
import { visible } from './nativeDirectory'
import { callerArchivedAt, deleteThreadForActor, insertThread, listThreadDocs, requireLiveAgent, resolveMainThreadForActor, setThreadArchivedForActor } from './agentThreads'

const agentArgs = { workspaceId: v.string(), agentId: v.string() }
const threadArgs = { ...agentArgs, conversationId: v.id('conversations') }
const identity = v.object({ conversationId: v.id('conversations'), title: v.string() })
const threadView = v.object({ conversationId: v.id('conversations'), workspaceId: v.string(), agentId: v.string(), viewerUserId: v.string(),
  title: v.string(), lastModified: v.number(), createdAt: v.number(), archivedAt: v.optional(v.number()), isMain: v.boolean() })
type Context = Pick<QueryCtx, 'auth' | 'db'>
type AgentArgs = { workspaceId: string; agentId: string }

function unavailable(error: unknown) {
  return error instanceof Error && ['UNAUTHENTICATED', 'WORKSPACE_ACCESS_DENIED', 'ROOM_ACCESS_DENIED', 'AGENT_NOT_FOUND', 'AGENT_ARCHIVED',
    'DEPLOYMENT_FEATURE_ACCESS_DENIED', 'CAPABILITY_ACCESS_DENIED'].includes(error.message)
}

async function agentAccess(ctx: Context, args: AgentArgs, capability: 'conversations.read' | 'conversations.create' | 'conversations.edit' = 'conversations.read') {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  await requireNativeDeploymentFeature(ctx, 'chat', args.workspaceId)
  await requireNativeCapability(ctx, viewer.userId, capability)
  const live = await requireLiveAgent(ctx, args)
  if (!visible(live.agent, viewer) || live.agent.archivedAt !== undefined || live.agentPrincipal.archivedAt !== undefined
    || live.agentPrincipal.type !== 'agent' || live.agentPrincipal.workspaceId !== args.workspaceId
    || (live.agentPrincipal.agentId !== undefined && live.agentPrincipal.agentId !== args.agentId)) throw new Error('AGENT_NOT_FOUND')
  const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q =>
    q.eq('workspaceId', args.workspaceId).eq('principalId', live.agentPrincipal.principalId)).unique()
  if (!membership || membership.status !== 'active') throw new Error('AGENT_NOT_FOUND')
  return { viewer, ...live }
}

async function threadAccess(ctx: Context, args: AgentArgs & { conversationId: Id<'conversations'> }) {
  const room = await requireNativeRoom(ctx, args)
  await agentAccess(ctx, args)
  if (room.conversation.agentId !== args.agentId || room.conversation.isAutomation) throw new Error('ROOM_ACCESS_DENIED')
  const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique()
  const participant = agent && await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q =>
    q.eq('conversationId', args.conversationId).eq('principalId', agent.principalId)).unique()
  if (!participant || participant.workspaceId !== args.workspaceId || participant.principalType !== 'agent'
    || participant.status !== 'active' || participant.removedAt !== undefined) throw new Error('ROOM_ACCESS_DENIED')
  return room
}

async function mainThreadId(ctx: Context, args: AgentArgs, userId: string, principalId: string) {
  const threads = await listThreadDocs(ctx, { ...args, userId }, true)
  const states = await Promise.all(threads.map(async row => ({ row, archivedAt: await callerArchivedAt(ctx, row._id, principalId) })))
  return states.filter(row => row.archivedAt === undefined).map(row => row.row)
    .sort((a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id)))[0]?._id
}

async function threadOrNull(ctx: Context, args: AgentArgs & { conversationId: Id<'conversations'> }) {
  try {
    return await threadAccess(ctx, args)
  } catch (error) {
    if (unavailable(error)) return null
    throw error
  }
}

async function agentOrNull(ctx: Context, args: AgentArgs) {
  try {
    return await agentAccess(ctx, args)
  } catch (error) {
    if (unavailable(error)) return null
    throw error
  }
}

function view(row: Doc<'conversations'>, viewerUserId: string, archivedAt: number | undefined, main: Id<'conversations'> | undefined) {
  return { conversationId: row._id, workspaceId: row.workspaceId!, agentId: row.agentId!, viewerUserId,
    title: row.title.slice(0, 240), lastModified: row.lastModified, createdAt: row.createdAt, archivedAt, isMain: row._id === main }
}

export const listThreads = query({
  args: { ...agentArgs, archived: v.boolean(), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(threadView),
  handler: async (ctx, args) => {
    const access = await agentOrNull(ctx, args)
    if (!access) return { page: [], isDone: true, continueCursor: '' }
    const { viewer } = access
    const main = await mainThreadId(ctx, args, viewer.userId, viewer.principal.principalId)
    const page = await ctx.db.query('conversations').withIndex('by_workspaceId_agentId_userId_lastModified', q =>
      q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId).eq('userId', viewer.userId)).order('desc')
      .paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)) })
    const rows = await Promise.all(page.page.map(async row => {
      const access = await threadOrNull(ctx, { ...args, conversationId: row._id })
      if (!access || row.isAutomation || (access.participant.archivedAt !== undefined) !== args.archived) return null
      return view(row, viewer.userId, access.participant.archivedAt, main)
    }))
    return { ...page, page: rows.filter(row => row !== null) }
  },
})

export const getThread = query({
  args: threadArgs, returns: v.union(threadView, v.null()),
  handler: async (ctx, args) => {
    const access = await threadOrNull(ctx, args)
    if (!access) return null
    const main = await mainThreadId(ctx, args, access.viewer.userId, access.principal.principalId)
    return view(access.conversation, access.viewer.userId, access.participant.archivedAt, main)
  },
})

export const resolveMainThread = mutation({
  args: agentArgs, returns: identity,
  handler: async (ctx, args) => {
    const { viewer } = await agentAccess(ctx, args, 'conversations.create')
    const result = await resolveMainThreadForActor(ctx, { ...args, userId: viewer.userId }, true)
    await threadAccess(ctx, { ...args, conversationId: result.conversationId })
    return { ...result, title: result.title.slice(0, 240) }
  },
})

export const createThread = mutation({
  args: { ...agentArgs, clientRequestId: v.string(), title: v.optional(v.string()) }, returns: identity,
  handler: async (ctx, args) => {
    const { viewer, agent, agentPrincipal } = await agentAccess(ctx, args, 'conversations.create')
    if (!args.clientRequestId.trim() || args.clientRequestId.length > 200) throw new Error('INVALID_REQUEST_ID')
    const existing = await ctx.db.query('conversations').withIndex('by_workspaceId_agentId_userId_threadClientRequestId', q =>
      q.eq('workspaceId', args.workspaceId).eq('agentId', args.agentId).eq('userId', viewer.userId).eq('threadClientRequestId', args.clientRequestId)).unique()
    if (existing) {
      await threadAccess(ctx, { ...args, conversationId: existing._id })
      return { conversationId: existing._id, title: existing.title.slice(0, 240) }
    }
    const title = args.title?.trim().slice(0, 120) || 'New thread'
    const conversationId = await insertThread(ctx, { ...args, userId: viewer.userId, title }, viewer.principal, agent, agentPrincipal)
    await ctx.db.patch(conversationId, { threadClientRequestId: args.clientRequestId })
    return { conversationId, title }
  },
})

export const setThreadArchived = mutation({
  args: { ...threadArgs, archived: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args)
    await requireNativeCapability(ctx, access.viewer.userId, 'conversations.edit')
    return setThreadArchivedForActor(ctx, { ...args, userId: access.viewer.userId })
  },
})

export const deleteThread = mutation({
  args: threadArgs, returns: v.null(),
  handler: async (ctx, args) => {
    const access = await threadAccess(ctx, args)
    await requireNativeCapability(ctx, access.viewer.userId, 'conversations.edit')
    return deleteThreadForActor(ctx, { ...args, userId: access.viewer.userId }, true)
  },
})
