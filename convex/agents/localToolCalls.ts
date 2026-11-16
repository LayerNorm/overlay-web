import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

/**
 * Local tools: Overlay's native tools executed on a user's own machine through
 * its Agent Host. The web server enqueues a call and waits for its outcome; the
 * host long-polls, claims and answers. Delivery is at most once.
 */
const MAX_REQUEST_BYTES = 700 * 1024
const MAX_OUTCOME_BYTES = 800 * 1024
const MAX_DEADLINE_MS = 6 * 60_000
const MAX_CLAIM = 10
const RETENTION_MS = 60 * 60_000

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
const bounded = (value: string, max = 200) => value.length > 0 && value.length <= max

function localToolsAdvertised(capabilities: unknown): boolean {
  const localTools = (capabilities as { localTools?: { version?: unknown } } | null)?.localTools
  return localTools?.version === 1
}

async function requireLocalEnvironment(ctx: MutationCtx, workspaceId: string, environmentId: string) {
  const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', environmentId)).unique()
  if (!environment || environment.workspaceId !== workspaceId || !environment.approvedAt
    || environment.status === 'pending' || environment.status === 'revoked' || environment.revokedAt !== undefined) {
    throw new ConvexError('LOCAL_TOOLS_ENVIRONMENT_UNAVAILABLE')
  }
  return environment
}

async function requireActiveMember(ctx: MutationCtx, workspaceId: string, userId: string) {
  const principal = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId)).unique()
  if (!principal || principal.archivedAt !== undefined || principal.type !== 'human') throw new ConvexError('LOCAL_TOOLS_FORBIDDEN')
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
  if (membership?.status !== 'active') throw new ConvexError('LOCAL_TOOLS_FORBIDDEN')
}

/** Only the person who approved a local machine can send it tool calls, and only while it advertises local tools. */
export const enqueueByServer = mutation({
  args: {
    serverSecret: v.string(), callId: v.string(), workspaceId: v.string(), environmentId: v.string(),
    requestedByUserId: v.string(), agentId: v.optional(v.string()), toolName: v.string(), request: v.any(),
    deadlineAt: v.number(), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!bounded(args.callId) || !bounded(args.toolName, 100) || bytes(args.request) > MAX_REQUEST_BYTES) throw new ConvexError('LOCAL_TOOLS_REQUEST_INVALID')
    if (args.deadlineAt <= args.now || args.deadlineAt > args.now + MAX_DEADLINE_MS) throw new ConvexError('LOCAL_TOOLS_DEADLINE_INVALID')
    const environment = await requireLocalEnvironment(ctx, args.workspaceId, args.environmentId)
    if (environment.kind !== 'local' || environment.approvedByUserId !== args.requestedByUserId) throw new ConvexError('LOCAL_TOOLS_FORBIDDEN')
    if (!localToolsAdvertised(environment.capabilities)) throw new ConvexError('LOCAL_TOOLS_UNSUPPORTED')
    await requireActiveMember(ctx, args.workspaceId, args.requestedByUserId)
    if (await ctx.db.query('agentLocalToolCalls').withIndex('by_callId', q => q.eq('callId', args.callId)).unique()) throw new ConvexError('LOCAL_TOOLS_DUPLICATE_CALL')
    await ctx.db.insert('agentLocalToolCalls', {
      callId: args.callId, workspaceId: args.workspaceId, environmentId: args.environmentId,
      requestedByUserId: args.requestedByUserId, ...(args.agentId ? { agentId: args.agentId } : {}),
      toolName: args.toolName, request: args.request, status: 'pending', deadlineAt: args.deadlineAt,
      createdAt: args.now, updatedAt: args.now,
    })
    return { callId: args.callId }
  },
})

/** Claims pending calls for a host; anything already past its deadline is expired, not delivered. */
export const claimByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), limit: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireLocalEnvironment(ctx, args.workspaceId, args.environmentId)
    const pending = await ctx.db.query('agentLocalToolCalls')
      .withIndex('by_environmentId_status_createdAt', q => q.eq('environmentId', args.environmentId).eq('status', 'pending'))
      .order('asc').take(Math.max(1, Math.min(args.limit, MAX_CLAIM)))
    const claimed = []
    for (const call of pending) {
      if (call.workspaceId !== args.workspaceId) continue
      if (call.deadlineAt <= args.now) {
        await ctx.db.patch(call._id, { status: 'expired', updatedAt: args.now })
        continue
      }
      await ctx.db.patch(call._id, { status: 'claimed', claimedAt: args.now, updatedAt: args.now })
      claimed.push({ callId: call.callId, workspaceId: call.workspaceId, environmentId: call.environmentId,
        issuedAt: call.createdAt, deadlineAt: call.deadlineAt, request: call.request })
    }
    return claimed
  },
})

/** Records a host's answer for its own claimed call. Repeating the same answer is harmless. */
export const completeByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), callId: v.string(), outcome: v.any(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireLocalEnvironment(ctx, args.workspaceId, args.environmentId)
    if (bytes(args.outcome) > MAX_OUTCOME_BYTES) throw new ConvexError('LOCAL_TOOLS_OUTCOME_TOO_LARGE')
    const call = await ctx.db.query('agentLocalToolCalls').withIndex('by_callId', q => q.eq('callId', args.callId)).unique()
    if (!call || call.workspaceId !== args.workspaceId || call.environmentId !== args.environmentId) throw new ConvexError('LOCAL_TOOLS_CALL_NOT_FOUND')
    if (call.status === 'completed') return { accepted: true }
    if (call.status !== 'claimed') return { accepted: false }
    await ctx.db.patch(call._id, { status: 'completed', outcome: args.outcome, completedAt: args.now, updatedAt: args.now })
    return { accepted: true }
  },
})

export const getByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), callId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const call = await ctx.db.query('agentLocalToolCalls').withIndex('by_callId', q => q.eq('callId', args.callId)).unique()
    if (!call || call.workspaceId !== args.workspaceId) return null
    return { status: call.status, ...(call.outcome !== undefined ? { outcome: call.outcome } : {}) }
  },
})

/** Called by the waiting server when it gives up; a call the host already answered keeps its answer. */
export const expireByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), callId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const call = await ctx.db.query('agentLocalToolCalls').withIndex('by_callId', q => q.eq('callId', args.callId)).unique()
    if (!call || call.workspaceId !== args.workspaceId) return null
    if (call.status === 'pending' || call.status === 'claimed') await ctx.db.patch(call._id, { status: 'expired', updatedAt: args.now })
    return call.status === 'completed' ? { status: call.status, outcome: call.outcome } : { status: 'expired' as const }
  },
})

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS
    const old = await ctx.db.query('agentLocalToolCalls').withIndex('by_createdAt', q => q.lt('createdAt', cutoff)).take(500)
    for (const call of old) await ctx.db.delete(call._id)
    return old.length
  },
})
