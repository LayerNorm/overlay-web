import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const anyObject = v.any()
function clean<T extends Record<string, unknown>>(row: T) {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}

export const createEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), kind: v.string(), name: v.string(), status: v.string(), publicKey: v.optional(v.string()), hostVersion: v.optional(v.string()), platform: v.optional(v.string()), capabilities: anyObject, lastSeenAt: v.optional(v.number()), revokedAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.id)).unique()
    if (existing) throw new Error('AGENT_ENVIRONMENT_EXISTS')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, environmentId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentEnvironments', row)
    return { ...row, id }
  },
})

export const createBindingByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), agentId: v.string(), environmentId: v.string(), protocolAdapter: v.string(), adapterConfig: anyObject, enabled: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, bindingId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentBindings', row)
    return { ...row, id }
  },
})

export const createRemoteSessionByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(), bindingId: v.string(), runId: v.string(), remoteSessionId: v.optional(v.string()), status: v.string(), commandCursor: v.number(), eventCursor: v.number(), capabilitySnapshot: anyObject, startedAt: v.optional(v.number()), endedAt: v.optional(v.number()), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const binding = await ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', args.bindingId)).unique()
    if (!binding || binding.workspaceId !== args.workspaceId || binding.environmentId !== args.environmentId || !binding.enabled) throw new Error('AGENT_BINDING_UNAVAILABLE')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, sessionId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentRemoteSessions', row)
    return { ...row, id }
  },
})

export const enqueueCommandByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(), runId: v.string(), type: v.string(), payload: anyObject, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).order('desc').first()
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, commandId: id, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: now, updatedAt: now }
    await ctx.db.insert('agentRunCommands', row)
    return { ...row, id }
  },
})

export const acknowledgeCommandByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), commandId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', args.commandId)).unique()
    if (!command || command.workspaceId !== args.workspaceId || command.environmentId !== args.environmentId || command.status === 'cancelled') return false
    if (command.status !== 'acknowledged') {
      await ctx.db.patch(command._id, {
        status: 'acknowledged', acknowledgedAt: args.now, claimExpiresAt: undefined, updatedAt: args.now,
      })
    }
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', command.runId)).unique()
    if (session && session.workspaceId === args.workspaceId && session.environmentId === args.environmentId) {
      await ctx.db.patch(session._id, { commandCursor: Math.max(session.commandCursor, command.sequence), updatedAt: args.now })
    }
    return true
  },
})

export const createApprovalRequestByServer = mutation({
  args: {
    serverSecret: v.string(), id: v.string(), workspaceId: v.string(), runId: v.string(),
    remoteSessionId: v.string(), requestKey: v.string(), prompt: v.string(),
    options: v.array(v.string()), payload: anyObject, requestedAt: v.number(),
    resolution: v.optional(v.object({
      decision: v.string(), resolvedByPrincipalId: v.string(), resolvedAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', args.remoteSessionId)).unique()
    if (!session || session.workspaceId !== args.workspaceId || session.runId !== args.runId) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    const existing = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', args.remoteSessionId).eq('requestKey', args.requestKey)).unique()
    if (existing) return { ...clean(existing), id: existing.approvalId }
    const { serverSecret, id, ...value } = args
    void serverSecret
    const row = { ...value, approvalId: id }
    await ctx.db.insert('agentApprovalRequests', row)
    return { ...row, id }
  },
})

export const resolveApprovalRequestByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), approvalId: v.string(),
    resolution: v.object({ decision: v.string(), resolvedByPrincipalId: v.string(), resolvedAt: v.number() }),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db.query('agentApprovalRequests').withIndex('by_approvalId', q => q.eq('approvalId', args.approvalId)).unique()
    if (!current || current.workspaceId !== args.workspaceId) return null
    if (current.resolution) {
      if (!sameResolution(current.resolution, args.resolution)) throw new Error('AGENT_APPROVAL_ALREADY_RESOLVED')
      return { ...clean(current), id: current.approvalId }
    }
    await ctx.db.patch(current._id, { resolution: args.resolution })
    return { ...clean(current), resolution: args.resolution, id: current.approvalId }
  },
})

export const createSandboxLeaseByServer = mutation({
  args: {
    serverSecret: v.string(), id: v.string(), workspaceId: v.string(), environmentId: v.string(),
    runId: v.optional(v.string()), provider: v.string(), providerReference: v.optional(v.string()),
    status: v.string(), reservationId: v.optional(v.string()), reservedUntil: v.number(),
    runtimeStartedAt: v.optional(v.number()), runtimeEndedAt: v.optional(v.number()),
    usage: anyObject, cleanupAttempts: v.number(), cleanupAfter: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, leaseId: id, createdAt: now, updatedAt: now }
    await ctx.db.insert('agentSandboxLeases', row)
    return { ...row, id }
  },
})

export const updateSandboxLeaseByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), leaseId: v.string(),
    status: v.optional(v.string()), providerReference: v.optional(v.string()),
    reservationId: v.optional(v.string()), reservedUntil: v.optional(v.number()),
    runtimeStartedAt: v.optional(v.number()), runtimeEndedAt: v.optional(v.number()),
    usage: v.optional(anyObject), cleanupAttempts: v.optional(v.number()),
    cleanupAfter: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const current = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', q => q.eq('leaseId', args.leaseId)).unique()
    if (!current || current.workspaceId !== args.workspaceId) return null
    const { serverSecret, workspaceId, leaseId, now, ...updates } = args
    void serverSecret
    void workspaceId
    void leaseId
    await ctx.db.patch(current._id, { ...updates, updatedAt: now })
    return { ...clean(current), ...updates, updatedAt: now, id: current.leaseId }
  },
})

export const claimCommandsByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number(), leaseMs: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status === 'revoked') return []
    const rows = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).collect()
    const claimable = rows.filter(row => row.workspaceId === args.workspaceId && (row.status === 'pending' || (row.status === 'claimed' && (row.claimExpiresAt ?? 0) <= args.now))).slice(0, Math.max(1, Math.min(args.limit, 100)))
    return await Promise.all(claimable.map(async row => {
      await ctx.db.patch(row._id, { status: 'claimed', claimedAt: args.now, claimExpiresAt: args.now + args.leaseMs, updatedAt: args.now })
      return { ...clean(row), id: row.commandId, status: 'claimed', claimedAt: args.now, claimExpiresAt: args.now + args.leaseMs, updatedAt: args.now }
    }))
  },
})

export const applyRemoteEventsByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), sessionId: v.string(), events: v.array(v.object({ protocolVersion: v.number(), eventId: v.string(), environmentId: v.string(), runId: v.string(), sourceSequence: v.number(), type: v.string(), occurredAt: v.number(), payload: anyObject })), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const session = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', args.sessionId)).unique()
    if (!session || session.workspaceId !== args.workspaceId || session.environmentId !== args.environmentId) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
    if (args.events.length === 0) return { accepted: true, acknowledgedSequence: session.eventCursor, duplicate: true }
    const first = args.events[0]!.sourceSequence
    if (args.events.some((event, index) => event.sourceSequence !== first + index)) throw new Error('AGENT_EVENT_BATCH_NOT_CONTIGUOUS')
    if (args.events.some(event => event.environmentId !== args.environmentId || event.runId !== session.runId)) throw new Error('AGENT_EVENT_SCOPE_MISMATCH')
    const last = args.events.at(-1)!.sourceSequence
    if (last <= session.eventCursor) return { accepted: true, acknowledgedSequence: session.eventCursor, duplicate: true }
    const expected = session.eventCursor + 1
    if (first !== expected) return { accepted: false, expectedSequence: expected }
    await ctx.db.patch(session._id, { eventCursor: last, updatedAt: args.now })
    return { accepted: true, acknowledgedSequence: last, duplicate: false }
  },
})

export const revokeEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId) return false
    await ctx.db.patch(environment._id, { status: 'revoked', revokedAt: args.now, updatedAt: args.now })
    for (const binding of await ctx.db.query('agentBindings').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).collect()) await ctx.db.patch(binding._id, { enabled: false, updatedAt: args.now })
    for (const command of await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).collect()) if (command.status === 'pending' || command.status === 'claimed') await ctx.db.patch(command._id, { status: 'cancelled', updatedAt: args.now })
    return true
  },
})

export const deleteWorkspaceDataByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const groups = await Promise.all([
      ctx.db.query('agentApprovalRequests').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentRunCommands').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentRemoteSessions').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentBindings').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
      ctx.db.query('agentEnvironments').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect(),
    ])
    for (const rows of groups) for (const row of rows) await ctx.db.delete(row._id)
    return true
  },
})

function sameResolution(
  left: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
  right: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) {
  return left.decision === right.decision
    && left.resolvedByPrincipalId === right.resolvedByPrincipalId
    && left.resolvedAt === right.resolvedAt
}
