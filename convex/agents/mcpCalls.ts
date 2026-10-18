import { ConvexError, v } from 'convex/values'
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { requireServerSecret } from '../lib/auth'
import { agentMcpCallAuthority, agentMcpCallState } from '../lib/agentMcpCallSchema'
import { agentMcpSessionIsLive, type AgentMcpExecutionAuthority } from '../../src/shared/agents/agent-mcp-authority'
import { currentRemoteAttempt } from './remoteRunModel'

const authority = { serverSecret: v.string(), ...agentMcpCallAuthority }
const MAX_INPUT_BYTES = 256 * 1024
const MAX_CHUNK_BYTES = 64 * 1024
const MAX_RUN_BYTES = 64 * 1024 * 1024
const MAX_RUN_CALLS = 1_000
const RETENTION_MS = 24 * 60 * 60_000
const encode = (value: string) => new TextEncoder().encode(value)
const wellFormed = (value: string) => !/[\uD800-\uDFFF]/u.test(value)
const boundedId = (value: string) => value.length > 0 && value.length <= 200 && wellFormed(value)

async function authorize(ctx: QueryCtx | MutationCtx, args: AgentMcpExecutionAuthority & { serverSecret: string; sessionId: string }) {
  requireServerSecret(args.serverSecret)
  const session = await currentRemoteAttempt(ctx, args.runId)
  if (!agentMcpSessionIsLive(args, session ? { ...session, id: session.sessionId } : null)) throw new ConvexError('MCP_CALL_UNAUTHORIZED')
  if (!session) throw new ConvexError('MCP_CALL_UNAUTHORIZED')
  const [run, binding, environment] = await Promise.all([
    ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique(),
    ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', session.bindingId)).unique(),
    ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique(),
  ])
  if (!run || !binding || !environment || binding.workspaceId !== args.workspaceId
    || environment.workspaceId !== args.workspaceId || !binding.enabled || binding.environmentId !== args.environmentId
    || binding.agentId !== run.agentId || environment.revokedAt !== undefined || environment.status === 'revoked'
    || run.bindingId !== binding.bindingId || run.environmentId !== args.environmentId
    || ['completed', 'cancelled', 'failed', 'cancelling', 'needs_attention'].includes(run.status)
    || !['starting', 'running', 'waiting_for_approval', 'waiting_for_input', 'recovering'].includes(run.remoteLifecycle?.phase ?? session.status)) throw new ConvexError('MCP_CALL_UNAUTHORIZED')
  const [agent, principal, conversation] = await Promise.all([
    ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', binding.agentId)).unique(),
    ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', run.userId)).unique(),
    ctx.db.get(run.conversationId),
  ])
  if (!agent || !principal || !conversation || conversation.workspaceId !== args.workspaceId || conversation.deletedAt !== undefined
    || agent.workspaceId !== args.workspaceId || agent.archivedAt !== undefined || agent.deletedAt !== undefined
    || principal.archivedAt !== undefined || principal.type !== 'human'
    || (agent.visibility === 'creator' && agent.createdByPrincipalId !== principal.principalId)) throw new ConvexError('MCP_CALL_UNAUTHORIZED')
  const [membership, participant] = await Promise.all([
    ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId)).unique(),
    ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', run.conversationId).eq('principalId', principal.principalId)).unique(),
  ])
  if (membership?.status !== 'active' || participant?.status !== 'active') throw new ConvexError('MCP_CALL_UNAUTHORIZED')
  return session
}

async function findCall(ctx: QueryCtx | MutationCtx, callId: string) {
  return ctx.db.query('agentMcpCalls').withIndex('by_callId', q => q.eq('callId', callId)).unique()
}

function sameScope(call: Doc<'agentMcpCalls'>, args: AgentMcpExecutionAuthority & { sessionId: string }) {
  return call.workspaceId === args.workspaceId && call.environmentId === args.environmentId && call.runId === args.runId
    && call.sessionId === args.sessionId && call.expiresAt > Date.now()
    && call.execution?.attemptId === args.execution?.attemptId && call.execution?.generation === args.execution?.generation
}

async function authorizedCall(ctx: QueryCtx | MutationCtx, args: AgentMcpExecutionAuthority & { serverSecret: string; sessionId: string; callId: string }) {
  await authorize(ctx, args)
  const call = await findCall(ctx, args.callId)
  if (!call || !sameScope(call, args)) throw new ConvexError('MCP_CALL_UNAVAILABLE')
  return call
}

const publicCall = (call: Doc<'agentMcpCalls'>) => ({ callId: call.callId, requestKey: call.requestKey,
  toolName: call.toolName, argumentsJson: call.argumentsJson, rpcId: call.rpcId, clientSessionId: call.clientSessionId, state: call.state,
  elicitationAnsweredAt: call.elicitationAnsweredAt })
const callResult = v.object({ callId: v.string(), requestKey: v.string(), toolName: v.string(), argumentsJson: v.string(),
  rpcId: v.string(), clientSessionId: v.string(), state: agentMcpCallState, elicitationAnsweredAt: v.optional(v.number()) })

/** A JSON-RPC request identity is immutable, including its exact normalized arguments. */
export const register = mutation({
  args: { ...authority, clientSessionId: v.string(), rpcId: v.string(), callId: v.string(), toolName: v.string(), argumentsJson: v.string() },
  returns: callResult,
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    if (![args.clientSessionId, args.rpcId, args.callId, args.toolName].every(boundedId)
      || !wellFormed(args.argumentsJson) || encode(args.argumentsJson).length > MAX_INPUT_BYTES) throw new ConvexError('MCP_CALL_INVALID')
    try { JSON.parse(args.argumentsJson) } catch { throw new ConvexError('MCP_CALL_INVALID') }
    const existing = await ctx.db.query('agentMcpCalls').withIndex('by_session_rpc', q => q.eq('sessionId', args.sessionId)
      .eq('clientSessionId', args.clientSessionId).eq('rpcId', args.rpcId)).unique()
    if (existing) {
      if (!sameScope(existing, args) || existing.toolName !== args.toolName || existing.argumentsJson !== args.argumentsJson) throw new ConvexError('MCP_CALL_ID_REUSED')
      return publicCall(existing)
    }
    if (await findCall(ctx, args.callId)) throw new ConvexError('MCP_CALL_ID_REUSED')
    const budget = await ctx.db.query('agentMcpCallBudgets').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
    const bytes = encode(args.argumentsJson).length
    if ((budget?.calls ?? 0) >= MAX_RUN_CALLS || (budget?.bytes ?? 0) + bytes > MAX_RUN_BYTES) throw new ConvexError('MCP_CALL_QUOTA')
    const now = Date.now()
    const retireAt = args.expiresAt + RETENTION_MS
    if (budget) await ctx.db.patch(budget._id, { calls: budget.calls + 1, bytes: budget.bytes + bytes, retireAt: Math.max(budget.retireAt, retireAt) })
    else await ctx.db.insert('agentMcpCallBudgets', { runId: args.runId, calls: 1, bytes, retireAt })
    const row = { workspaceId: args.workspaceId, environmentId: args.environmentId, runId: args.runId, sessionId: args.sessionId,
      ...(args.execution ? { execution: args.execution } : {}), expiresAt: args.expiresAt, retireAt, createdAt: now,
      callId: args.callId, requestKey: `mcp_call:${args.callId}`, clientSessionId: args.clientSessionId,
      rpcId: args.rpcId, toolName: args.toolName, argumentsJson: args.argumentsJson, state: { kind: 'pending' as const } }
    const id = await ctx.db.insert('agentMcpCalls', row)
    const stored = await ctx.db.get(id)
    if (!stored) throw new ConvexError('MCP_CALL_UNAVAILABLE')
    return publicCall(stored)
  },
})

export const read = query({ args: { ...authority, callId: v.string() }, returns: callResult,
  handler: async (ctx, args) => publicCall(await authorizedCall(ctx, args)) })

/** Native form delivery is separate from the owner's persisted permission decision. */
export const acknowledgeElicitation = mutation({
  args: { ...authority, callId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const call = await authorizedCall(ctx, args)
    if (call.elicitationAnsweredAt === undefined) await ctx.db.patch(call._id, { elicitationAnsweredAt: Date.now() })
    return null
  },
})

/** There is no lease takeover. A lost executor has an unknown outcome, never permission to repeat a write. */
export const claim = mutation({
  args: { ...authority, callId: v.string(), executionId: v.string(), approvalRequired: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const call = await authorizedCall(ctx, args)
    if (call.state.kind !== 'pending') return false
    if (!boundedId(args.executionId)) throw new ConvexError('MCP_CALL_INVALID')
    if (args.approvalRequired) {
      const approval = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', args.sessionId).eq('requestKey', call.requestKey)).unique()
      if (approval?.resolution?.decision !== 'allow') throw new ConvexError('MCP_CALL_NOT_APPROVED')
    }
    await ctx.db.patch(call._id, { state: { kind: 'executing', executionId: args.executionId,
      deadlineAt: Math.min(Date.now() + 240_000, args.expiresAt), chunks: 0, bytes: 0 } })
    return true
  },
})

function ownsExecution(call: Doc<'agentMcpCalls'>, executionId: string) {
  if (call.state.kind !== 'executing' || call.state.executionId !== executionId) throw new ConvexError('MCP_CALL_EXECUTOR_MISMATCH')
  return call.state
}

export const appendResult = mutation({
  args: { ...authority, callId: v.string(), executionId: v.string(), index: v.number(), data: v.bytes() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await authorizedCall(ctx, args)
    const state = ownsExecution(call, args.executionId)
    if (!Number.isSafeInteger(args.index) || args.index < 0 || args.data.byteLength > MAX_CHUNK_BYTES || args.data.byteLength === 0) throw new ConvexError('MCP_CALL_INVALID')
    if (args.index < state.chunks) {
      const prior = await ctx.db.query('agentMcpResultChunks').withIndex('by_callId_index', q => q.eq('callId', args.callId).eq('index', args.index)).unique()
      if (!prior || new Uint8Array(prior.data).length !== args.data.byteLength
        || !new Uint8Array(prior.data).every((value, index) => value === new Uint8Array(args.data)[index])) throw new ConvexError('MCP_CALL_RESULT_CHANGED')
      return null
    }
    if (args.index !== state.chunks) throw new ConvexError('MCP_CALL_RESULT_ORDER')
    const budget = await ctx.db.query('agentMcpCallBudgets').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
    if (!budget || budget.bytes + args.data.byteLength > MAX_RUN_BYTES) throw new ConvexError('MCP_CALL_QUOTA')
    await ctx.db.insert('agentMcpResultChunks', { callId: args.callId, index: args.index, data: args.data })
    await ctx.db.patch(budget._id, { bytes: budget.bytes + args.data.byteLength })
    await ctx.db.patch(call._id, { state: { ...state, chunks: state.chunks + 1, bytes: state.bytes + args.data.byteLength } })
    return null
  },
})

export const complete = mutation({
  args: { ...authority, callId: v.string(), executionId: v.string(), chunks: v.number(), bytes: v.number(), sha256: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await authorizedCall(ctx, args)
    if (call.state.kind === 'completed') {
      if (call.state.chunks !== args.chunks || call.state.bytes !== args.bytes || call.state.sha256 !== args.sha256) throw new ConvexError('MCP_CALL_RESULT_CHANGED')
      return null
    }
    const state = ownsExecution(call, args.executionId)
    if (state.chunks !== args.chunks || state.bytes !== args.bytes || !/^[a-f0-9]{64}$/.test(args.sha256)) throw new ConvexError('MCP_CALL_RESULT_INCOMPLETE')
    await ctx.db.patch(call._id, { state: { kind: 'completed', chunks: state.chunks, bytes: state.bytes, sha256: args.sha256 } })
    return null
  },
})

export const readResult = query({
  args: { ...authority, callId: v.string(), start: v.number() },
  returns: v.array(v.object({ index: v.number(), data: v.bytes() })),
  handler: async (ctx, args) => {
    const call = await authorizedCall(ctx, args)
    if (call.state.kind !== 'completed' || !Number.isSafeInteger(args.start) || args.start < 0) throw new ConvexError('MCP_CALL_RESULT_UNAVAILABLE')
    return (await ctx.db.query('agentMcpResultChunks').withIndex('by_callId_index', q => q.eq('callId', args.callId).gte('index', args.start)).take(8))
      .map(({ index, data }) => ({ index, data }))
  },
})

/** Bounded deletion, including results of calls whose executor disappeared. */
export const cleanupExpired = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const now = Date.now()
    const calls = await ctx.db.query('agentMcpCalls').withIndex('by_retireAt', q => q.lte('retireAt', now)).take(10)
    let remaining = false
    let chunkBudget = 64
    for (const call of calls) {
      if (chunkBudget === 0) { remaining = true; break }
      const limit = chunkBudget
      const chunks = await ctx.db.query('agentMcpResultChunks').withIndex('by_callId_index', q => q.eq('callId', call.callId)).take(limit)
      chunkBudget -= chunks.length
      for (const chunk of chunks) await ctx.db.delete(chunk._id)
      if (chunks.length < limit) await ctx.db.delete(call._id)
      else remaining = true
    }
    const budgets = await ctx.db.query('agentMcpCallBudgets').withIndex('by_retireAt', q => q.lte('retireAt', now)).take(10)
    for (const budget of budgets) await ctx.db.delete(budget._id)
    if (remaining || calls.length === 10 || budgets.length === 10) await ctx.scheduler.runAfter(0, internal.agents.mcpCalls.cleanupExpired, {})
    return null
  },
})
