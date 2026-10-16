import { v } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { reduceRemoteRun, remoteRunCoarseStatus, type RemoteRunFact, type RemoteRunState, type RemoteRunReduction } from '../../src/shared/agents/remote-run'

const remoteApprovalValidator = v.object({ requestKey: v.string(), expiresAt: v.number(), kind: v.optional(v.union(v.literal('permission'), v.literal('elicitation'))), decision: v.optional(v.string()), delivered: v.optional(v.boolean()) })

export const remoteLifecycleValidator = v.object({
  version: v.literal(2), revision: v.number(), phase: v.union(
    v.literal('queued'), v.literal('waking'), v.literal('starting'), v.literal('running'),
    v.literal('waiting_for_approval'), v.literal('waiting_for_input'), v.literal('recovering'),
    v.literal('needs_attention'), v.literal('cancelling'), v.literal('completed'), v.literal('cancelled'), v.literal('failed')),
  currentAttemptId: v.string(), executionGeneration: v.number(), coordinatorGeneration: v.number(),
  coordinatorId: v.optional(v.string()), hardDeadlineAt: v.number(), claimDeadlineAt: v.number(),
  lastHealthAt: v.optional(v.number()), lastProgressAt: v.optional(v.number()), lastPreparationAt: v.optional(v.number()),
  approval: v.optional(remoteApprovalValidator), approvals: v.optional(v.array(remoteApprovalValidator)),
  providerStop: v.optional(v.object({provider: v.literal('box'), environmentId: v.string(), leaseId: v.string(),
    providerReference: v.string(), attemptId: v.string(), executionGeneration: v.number(), observedAt: v.number(), recordedAtRevision: v.number()})),
  cause: v.optional(v.string()), cancelRequestedAt: v.optional(v.number()), recoveryOutcome: v.optional(v.union(v.literal('attached_live'), v.literal('restored'), v.literal('requires_new_attempt'), v.literal('unavailable'))),
})

/** Existing session rows are attempts. Legacy runs keep their unique-by-run behavior. */
export async function currentRemoteAttempt(ctx: QueryCtx | MutationCtx, runId: string) {
  const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', runId)).unique()
  if (run?.remoteLifecycle) return ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', run.remoteLifecycle!.currentAttemptId)).unique()
  return ctx.db.query('agentRemoteSessions').withIndex('by_runId', q => q.eq('runId', runId)).unique()
}

/** Coalesced signal intents contain IDs only; transcript delivery never depends on Workflow availability. */
export async function signalRemoteLifecycle(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>, now: number) {
  if (!run.externalRunId || !run.remoteLifecycle) return
  const intentId = `signal:${run.externalRunId}:${run.remoteLifecycle.coordinatorGeneration}`
  const existing = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', intentId)).unique()
  const value = { revision: run.remoteLifecycle.revision, status: 'pending', updatedAt: now }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert('agentRemoteRunIntents', { intentId, runId: run.externalRunId, kind: 'signal', ...value, createdAt: now })
}

/** Canonical request state wins over an individual event's transcript projection. */
export function reconcileRemoteRequestParts(parts: Array<Record<string, unknown>>, state: RemoteRunState, now: number) {
  const requests = state.approvals ?? (state.approval ? [state.approval] : [])
  const invalidated = ['cancelling', 'cancelled', 'failed'].includes(state.phase) || state.cause === 'approval_context_lost'
  return parts.map(part => {
    if (part.type !== 'data-remote-agent-request' || !part.data || typeof part.data !== 'object') return part
    const data = part.data as Record<string, unknown>
    const request = requests.find(request => request.requestKey === data.requestKey)
    if (!invalidated && request && !request.delivered) {
      const { resolution, ...pending } = data
      return { ...part, data: { ...pending, state: request.decision ? 'decision_pending' : 'pending',
        ...(request.decision && resolution ? { resolution } : {}) } }
    }
    if (!invalidated && !request?.delivered && state.phase !== 'completed') return part
    return { ...part, data: { ...data, state: 'resolved', resolution: data.resolution ?? {
      decision: request?.decision ?? state.cause ?? 'run_completed', resolvedAt: now, resolvedByPrincipalId: 'system:remote-lifecycle',
    } } }
  })
}

export async function applyRemoteFact(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>, fact: RemoteRunFact, now: number, options: { deferMessageProjection?: boolean } = {}): Promise<RemoteRunReduction | null> {
  if (!run.remoteLifecycle) return null
  const current = run.remoteLifecycle as RemoteRunState
  const result = reduceRemoteRun(current, current.revision, { attemptId: current.currentAttemptId,
    executionGeneration: current.executionGeneration, coordinatorGeneration: current.coordinatorGeneration }, fact, now)
  if (!result.applied) return result
  await ctx.db.patch(run._id, { remoteLifecycle: result.state, status: remoteRunCoarseStatus(result.state.phase), updatedAt: now })
  const attempt = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', result.state.currentAttemptId)).unique()
  if (attempt) await ctx.db.patch(attempt._id, { status: result.state.phase,
    ...(result.state.lastHealthAt !== undefined ? { lastHealthAt: result.state.lastHealthAt, executionLeaseExpiresAt: Math.min(result.state.lastHealthAt + 90_000, result.state.hardDeadlineAt) } : {}),
    ...(result.state.lastProgressAt !== undefined ? { lastProgressAt: result.state.lastProgressAt } : {}), updatedAt: now })
  const invalidateRequests = result.state.phase === 'cancelling' || result.state.cause === 'approval_context_lost'
  if (attempt && invalidateRequests) {
    const requests = await ctx.db.query('agentApprovalRequests').withIndex('by_workspaceId_runId', q => q.eq('workspaceId', attempt.workspaceId).eq('runId', attempt.runId)).take(100)
    for (const request of requests) if (!request.resolution) await ctx.db.patch(request._id, { resolution: {
      decision: result.state.cause ?? 'cancelled', resolvedByPrincipalId: 'system:remote-lifecycle', resolvedAt: now,
    } })
  }
  const message = await ctx.db.get(run.assistantMessageId)
  if (message && !options.deferMessageProjection) {
    const phase = result.state.phase
    const visibleState = ['queued', 'waking'].includes(phase) ? 'waiting' : phase
    const parts = reconcileRemoteRequestParts((message.parts ?? []) as Array<Record<string, unknown>>, result.state, now).map(part => {
      if (part.type === 'data-remote-agent-status' && 'data' in part) return { ...part, data: { ...(part.data as Record<string, unknown>), state: visibleState, hardDeadlineAt: result.state.hardDeadlineAt } }
      return part
    })
    if (!parts.some(part => part.type === 'data-remote-agent-status')) {
      const snapshot = attempt?.capabilitySnapshot as { environmentName?: string } | undefined
      parts.push({ type: 'data-remote-agent-status', data: { environmentName: snapshot?.environmentName ?? 'connected environment',
        runId: run.externalRunId!, queueExpiresAt: result.state.claimDeadlineAt, hardDeadlineAt: result.state.hardDeadlineAt, state: visibleState } } as typeof parts[number])
    }
    await ctx.db.patch(message._id, { parts: parts as typeof message.parts, updatedAt: now })
  }
  if (attempt && result.state.phase === 'needs_attention' && result.state.cause === 'command_unclaimed') {
    const held = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', attempt.runId)).take(100)
    for (const command of held) if (command.status === 'coordinator_pending') await ctx.db.patch(command._id, {
      type: 'shutdown', payload: { reason: 'The task was not claimed before its wake deadline.' }, status: 'pending', updatedAt: now,
    })
  }
  // A policy stop must reach the host even while Workflow delivery is unavailable.
  if (attempt && result.state.phase === 'cancelling') {
    const commandId = `stop:${run.externalRunId}:${result.state.currentAttemptId}`
    const existing = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', commandId)).unique()
    // Release any reserved sequence as a neutralized shutdown, preserving environment ordering.
    const held = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', attempt.runId)).take(100)
    const neverDispatched = held.some(command => command.status === 'coordinator_pending'
      && command.type === 'start' && command.attemptId === result.state.currentAttemptId)
    for (const command of held) if (command.status === 'coordinator_pending') await ctx.db.patch(command._id, { type: 'shutdown', payload: { reason: 'Cancellation requested before execution was dispatched.' }, status: 'pending', updatedAt: now })
    if (!existing) {
      const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', attempt.environmentId)).order('desc').first()
      await ctx.db.insert('agentRunCommands', { commandId, workspaceId: attempt.workspaceId, environmentId: attempt.environmentId,
        runId: attempt.runId, attemptId: attempt.sessionId, executionGeneration: result.state.executionGeneration,
        type: 'cancel', sequence: (latest?.sequence ?? 0) + 1, payload: { reason: result.state.cause }, status: 'pending', createdAt: now, updatedAt: now })
    }
    // Atomic reserved-start state proves no host was ever allowed to execute it.
    if (neverDispatched) return applyRemoteFact(ctx, { ...run, remoteLifecycle: result.state }, { type: 'stopped' }, now)
  }
  if (attempt && ['completed', 'cancelled', 'failed'].includes(result.state.phase)) {
    const intentId = `finalize:${attempt.runId}:${attempt.sessionId}`
    const existing = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', intentId)).unique()
    if (!existing) await ctx.db.insert('agentRemoteRunIntents', { intentId, runId: attempt.runId, kind: 'finalize',
      revision: result.state.revision, status: 'pending', createdAt: now, updatedAt: now })
    if (message) await ctx.db.patch(message._id, { status: result.state.phase === 'failed' ? 'error' : 'completed', updatedAt: now })
    await ctx.db.patch(attempt._id, { endedAt: now })
  }
  await signalRemoteLifecycle(ctx, { ...run, remoteLifecycle: result.state }, now)
  return result
}
