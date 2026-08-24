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
    const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).order('desc').first()
    const { serverSecret, id, now, ...value } = args
    void serverSecret
    const row = { ...value, commandId: id, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: now, updatedAt: now }
    await ctx.db.insert('agentRunCommands', row)
    return { ...row, id }
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
