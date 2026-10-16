import {v} from 'convex/values'
import {mutation} from '../_generated/server'
import {requireServerSecret} from '../lib/auth'
import {currentRemoteAttempt, signalRemoteLifecycle} from './remoteRunModel'
import {pendingRemoteApprovals, type RemoteRunState} from '../../src/shared/agents/remote-run'
import {matchesCurrentRecoveryMachine} from '../lib/remoteRecoveryMachine'
import {nativeRecoveryIsAuthorized} from '../lib/nativeRecoveryAuthority'
import {nativeRecoveryPayload, nativeRecoverySnapshotSchema} from '../lib/nativeRecoveryPayload'
import {MAX_COMMAND_BYTES, startAdapterPayloadSchema} from '@layernorm/overlay-agent-bridge-protocol'
import {hydrateRemoteMessage} from '../lib/remoteMessageText'

/** The machine remains stopped until the caller receives this durable authorization. */
export const beginByServer = mutation({
  args: {serverSecret: v.string(), runId: v.string(), coordinatorId: v.string(), coordinatorGeneration: v.number(),
    attemptId: v.string(), generation: v.number(), expectedRevision: v.number(), leaseId: v.string(), providerReference: v.string(), now: v.number()},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    const state = run?.remoteLifecycle
    if (!run || !state || state.coordinatorId !== args.coordinatorId || state.coordinatorGeneration !== args.coordinatorGeneration
      || !['needs_attention', 'recovering'].includes(state.phase) || args.now >= state.hardDeadlineAt
      || !Number.isSafeInteger(args.now) || args.now < run.createdAt || pendingRemoteApprovals(state).length) return false
    const attempt = await currentRemoteAttempt(ctx, args.runId)
    const parsed = nativeRecoverySnapshotSchema.safeParse(attempt?.capabilitySnapshot)
    if (!attempt || !parsed.success || !run.environmentId) return false
    const scope = {runId: args.runId, environmentId: run.environmentId, leaseId: args.leaseId, providerReference: args.providerReference}
    if (!await matchesCurrentRecoveryMachine(ctx, scope) || !await nativeRecoveryIsAuthorized(ctx, run, attempt, parsed.data)) return false
    const commandId = `native-restore:${args.runId}:${args.attemptId}:${args.generation}`
    const proof = state.providerStop
    if (!proof || proof.environmentId !== run.environmentId || proof.attemptId !== args.attemptId
      || proof.executionGeneration !== args.generation || proof.leaseId !== args.leaseId
      || proof.providerReference !== args.providerReference || args.now < proof.observedAt) return false
    const existing = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', commandId)).unique()
    if (existing) return state.phase === 'recovering' && state.cause === 'native_restoration'
      && state.executionGeneration === args.generation + 1 && existing.executionGeneration === state.executionGeneration
      && existing.environmentId === run.environmentId && existing.workspaceId === attempt.workspaceId
      && existing.type === 'start' && existing.attemptId === state.currentAttemptId && existing.status === 'pending'
    if (state.revision !== args.expectedRevision || state.currentAttemptId !== args.attemptId || state.executionGeneration !== args.generation
      || !proof || proof.attemptId !== args.attemptId || proof.executionGeneration !== args.generation
      || proof.leaseId !== args.leaseId || proof.providerReference !== args.providerReference
      || !['process_health_unknown', 'process_health_required', 'process_lost', 'execution_stopped', 'old_writer_not_isolated'].includes(state.cause ?? '')
      || !attempt.remoteSessionId) return false
    const requests = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', attempt.sessionId)).take(101)
    if (requests.length === 101 || requests.some(request => !request.resolution)) return false
    const commands = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', args.runId)).take(101)
    if (commands.length === 101) return false
    const original = commands.find(command => command.type === 'start')
    const start = startAdapterPayloadSchema.safeParse(original?.payload)
    if (!start.success) return false
    const adapter = parsed.data.adapters.find(candidate => candidate.id === start.data.adapterId && candidate.protocol === 'acp')
    if (!adapter?.recovery?.sessionLoading || !adapter.recovery.fencedSessionRestoration) return false
    const message = await ctx.db.get(run.assistantMessageId)
    if (!message) return false
    const nextAttempt = `agent_session_${crypto.randomUUID()}`, generation = state.executionGeneration + 1
    const previousExecution = {attemptId: args.attemptId, generation: args.generation,
      ...(attempt.hostBootId ? {hostBootId: attempt.hostBootId} : {})}
    const payload = nativeRecoveryPayload({original: start.data, nativeSessionId: attempt.remoteSessionId,
      newAttemptId: nextAttempt, previousExecution, providerStop: proof, textOffset: (await hydrateRemoteMessage(ctx, message)).content.length})
    // Leave room for the delivery envelope and the freshly scoped MCP grant.
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_COMMAND_BYTES - 8192) return false
    const claimDeadlineAt = Math.min(state.hardDeadlineAt, args.now + 120_000)
    await ctx.db.insert('agentRemoteSessions', {sessionId: nextAttempt, attemptId: nextAttempt, executionGeneration: generation,
      workspaceId: attempt.workspaceId, environmentId: attempt.environmentId, bindingId: attempt.bindingId, runId: args.runId,
      remoteSessionId: attempt.remoteSessionId, status: 'recovering', commandCursor: 0, eventCursor: 0,
      hardDeadlineAt: state.hardDeadlineAt, claimDeadlineAt, capabilitySnapshot: {...parsed.data,
        nativeRestoration: {...payload.restore, nativeSessionId: attempt.remoteSessionId, commandId}}, createdAt: args.now, updatedAt: args.now})
    await ctx.db.patch(attempt._id, {status: 'failed', recoveryCause: 'provider_isolated', endedAt: args.now, updatedAt: args.now})
    const next: RemoteRunState = {...state, currentAttemptId: nextAttempt, executionGeneration: generation,
      revision: state.revision + 1, phase: 'recovering', cause: 'native_restoration', claimDeadlineAt}
    delete next.lastHealthAt; delete next.lastPreparationAt; delete next.approval; delete next.approvals; delete next.recoveryOutcome
    await ctx.db.patch(run._id, {remoteLifecycle: next, status: 'running', updatedAt: args.now})
    for (const command of commands) if (['pending', 'claimed', 'coordinator_pending'].includes(command.status)) await ctx.db.patch(command._id,
      {type: 'shutdown', payload: {reason: 'The previous execution was isolated for continuation.'}, status: 'pending', updatedAt: args.now})
    const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', attempt.environmentId)).order('desc').first()
    await ctx.db.insert('agentRunCommands', {commandId, workspaceId: attempt.workspaceId, environmentId: attempt.environmentId,
      runId: args.runId, attemptId: nextAttempt, executionGeneration: generation, type: 'start', payload,
      sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: args.now, updatedAt: args.now})
    await signalRemoteLifecycle(ctx, {...run, remoteLifecycle: next}, args.now)
    return true
  },
})
