import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { applyRemoteFact, currentRemoteAttempt } from './remoteRunModel'
import type { RemoteRunState } from '../../src/shared/agents/remote-run'
import {matchesCurrentRecoveryMachine} from '../lib/remoteRecoveryMachine'
import {nativeRecoverySnapshotSchema} from '../lib/nativeRecoveryPayload'

export const readByServer = query({
  args: { serverSecret: v.string(), runId: v.string() }, returns: v.any(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run?.remoteLifecycle) return null
    const attempt = await currentRemoteAttempt(ctx, args.runId)
    const capabilities = nativeRecoverySnapshotSchema.safeParse(attempt?.capabilitySnapshot)
    const nativeRestorationAdvertised = Boolean(attempt?.remoteSessionId && capabilities.success
      && capabilities.data.adapters.some(adapter => adapter.protocol === 'acp'
        && adapter.recovery?.sessionLoading && adapter.recovery.fencedSessionRestoration))
    const environment = run.environmentId ? await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', run.environmentId!)).unique() : null
    // No start payload, credentials or transcript crosses the Workflow boundary.
    const nativePreparationPending = Boolean(attempt?.restorationCommandId && !attempt.nativeStartAdmission
      && attempt.startedAt === undefined && run.remoteLifecycle.lastHealthAt === undefined)
    return { runId: args.runId, workspaceId: attempt?.workspaceId, environmentId: run.environmentId,
      environmentKind: environment?.kind, lifecycle: run.remoteLifecycle, nativeRestorationAdvertised, nativePreparationPending }
  },
})

export const claimByServer = mutation({
  args: { serverSecret: v.string(), runId: v.string(), coordinatorId: v.string(), generation: v.number(), now: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run?.remoteLifecycle || run.remoteLifecycle.coordinatorGeneration !== args.generation) return false
    if (run.remoteLifecycle.coordinatorId === args.coordinatorId) return true
    const result = await applyRemoteFact(ctx, run, { type: 'claim_coordinator', coordinatorId: args.coordinatorId }, args.now)
    if (!result?.applied) return false
    const intent = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', `start:${args.runId}:${args.generation}`)).unique()
    if (intent) await ctx.db.patch(intent._id, { status: 'delivered', updatedAt: args.now })
    return true
  },
})

export const advanceByServer = mutation({
  args: { serverSecret: v.string(), runId: v.string(), coordinatorId: v.string(), generation: v.number(), now: v.number(), wake: v.optional(v.boolean()) }, returns: v.any(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    let run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run?.remoteLifecycle || run.remoteLifecycle.coordinatorId !== args.coordinatorId || run.remoteLifecycle.coordinatorGeneration !== args.generation) return null
    let state = run.remoteLifecycle as RemoteRunState
    const attempt = await currentRemoteAttempt(ctx, args.runId)
    if (!attempt) throw new Error('AGENT_REMOTE_ATTEMPT_MISSING')
    const [environment, binding, membership, participant] = await Promise.all([
      ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', attempt.environmentId)).unique(),
      ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', attempt.bindingId)).unique(),
      ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', attempt.workspaceId).eq('principalId', run!.initiatorPrincipalId!)).unique(),
      ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', run!.conversationId).eq('principalId', run!.initiatorPrincipalId!)).unique(),
    ])
    const snapshot = attempt.capabilitySnapshot as Record<string, unknown>
    const billing = snapshot.billing as { reservationId?: string } | undefined
    const sandbox = snapshot.sandboxBilling as { reservationId?: string } | undefined
    const reservations = await Promise.all([billing?.reservationId, sandbox?.reservationId].filter((id): id is string => Boolean(id))
      .map(id => ctx.db.query('budgetReservations').withIndex('by_reservationId', q => q.eq('reservationId', id)).unique()))
    const fundingValid = reservations.every(reservation => reservation && ['reserved', 'reconcile_required'].includes(reservation.status))
    const apply = async (fact: Parameters<typeof applyRemoteFact>[2]) => {
      const result = await applyRemoteFact(ctx, run!, fact, args.now)
      if (result?.applied) { state = result.state; run = { ...run!, remoteLifecycle: state } }
    }
    if (!environment || environment.revokedAt || !binding?.enabled || membership?.status !== 'active' || participant?.status !== 'active') {
      await apply({ type: 'refuse', cause: 'authorization_revoked' })
    } else if (!fundingValid) await apply({ type: 'refuse', cause: 'funding_unavailable' })
    else if (args.wake) await apply({ type: 'wake' })
    else await apply({ type: 'observe' })
    if (state.phase === 'queued' || state.phase === 'waking') {
      if (!args.wake) {
        await apply({ type: 'dispatch' })
        const commands = await ctx.db.query('agentRunCommands').withIndex('by_runId', q => q.eq('runId', args.runId)).take(100)
        for (const command of commands) if (command.status === 'coordinator_pending' && command.attemptId === state.currentAttemptId) {
          await ctx.db.patch(command._id, { status: 'pending', updatedAt: args.now })
        }
      }
    }
    if (state.phase === 'needs_attention' && state.cause === 'process_health_required') {
      const intentId = `probe:${args.runId}:${state.currentAttemptId}:${Math.floor(args.now / 60_000)}`
      const existing = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', intentId)).unique()
      if (!existing) {
        const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', attempt.environmentId)).order('desc').first()
        await ctx.db.insert('agentRunCommands', { commandId: intentId, workspaceId: attempt.workspaceId, environmentId: attempt.environmentId,
          runId: args.runId, attemptId: state.currentAttemptId, executionGeneration: state.executionGeneration,
          type: 'observe', payload: {}, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: args.now, updatedAt: args.now })
      }
    }
    if (state.phase === 'cancelling') {
      const commandId = `stop:${args.runId}:${state.currentAttemptId}`
      const existing = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', commandId)).unique()
      if (!existing) {
        const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', attempt.environmentId)).order('desc').first()
        await ctx.db.insert('agentRunCommands', { commandId, workspaceId: attempt.workspaceId, environmentId: attempt.environmentId,
          runId: args.runId, attemptId: state.currentAttemptId, executionGeneration: state.executionGeneration,
          type: 'cancel', payload: { reason: state.cause }, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: args.now, updatedAt: args.now })
      }
    }
    await ctx.db.patch(attempt._id, { status: state.phase, updatedAt: args.now })
    return state
  },
})

export const pendingIntentsByServer = query({
  args: { serverSecret: v.string() }, returns: v.any(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return ctx.db.query('agentRemoteRunIntents').withIndex('by_status_updatedAt', q => q.eq('status', 'pending')).take(100)
  },
})
export const acknowledgeIntentByServer = mutation({
  args: { serverSecret: v.string(), intentId: v.string(), revision: v.number(), now: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const intent = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', args.intentId)).unique()
    if (!intent || intent.revision !== args.revision) return false
    await ctx.db.patch(intent._id, { status: 'delivered', updatedAt: args.now })
    return true
  },
})

/** Caller verifies the prior Workflow is terminal through the Workflow runtime before requesting takeover. */
export const replaceStoppedCoordinatorByServer = mutation({
  args: { serverSecret: v.string(), runId: v.string(), coordinatorId: v.string(), generation: v.number(), expectedRevision: v.number(), now: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run?.remoteLifecycle || run.remoteLifecycle.revision !== args.expectedRevision
      || run.remoteLifecycle.coordinatorId !== args.coordinatorId || run.remoteLifecycle.coordinatorGeneration !== args.generation) return false
    const result = await applyRemoteFact(ctx, run, { type: 'coordinator_stopped', coordinatorId: args.coordinatorId }, args.now)
    if (!result?.applied) return false
    await ctx.db.insert('agentRemoteRunIntents', { intentId: `start:${args.runId}:${result.state.coordinatorGeneration}`, runId: args.runId,
      kind: 'start', revision: result.state.revision, status: 'pending', createdAt: args.now, updatedAt: args.now })
    return true
  },
})

export const confirmStoppedByServer = mutation({
  args: { serverSecret: v.string(), runId: v.string(), attemptId: v.string(), generation: v.number(), now: v.number() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    if (!run?.remoteLifecycle || run.remoteLifecycle.phase !== 'cancelling' || run.remoteLifecycle.currentAttemptId !== args.attemptId
      || run.remoteLifecycle.executionGeneration !== args.generation) return false
    return (await applyRemoteFact(ctx, run, { type: 'stopped' }, args.now))?.applied === true
  },
})

/** The trusted caller must read the provider's stopped state before recording it, and before resuming. */
export const recordProviderStopByServer = mutation({
  args: {serverSecret: v.string(), runId: v.string(), environmentId: v.string(), leaseId: v.string(),
    providerReference: v.string(), attemptId: v.string(), generation: v.number(), expectedRevision: v.number(), now: v.number()},
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique()
    const state = run?.remoteLifecycle
    if (!state || !['needs_attention', 'recovering'].includes(state.phase) || state.currentAttemptId !== args.attemptId
      || state.executionGeneration !== args.generation || run.environmentId !== args.environmentId
      || !Number.isSafeInteger(args.now) || args.now < run.createdAt || args.now >= state.hardDeadlineAt) return false
    if (!await matchesCurrentRecoveryMachine(ctx, args)) return false
    const prior = state.providerStop
    if (state.revision === args.expectedRevision + 1 && prior?.recordedAtRevision === args.expectedRevision
      && prior.attemptId === args.attemptId && prior.executionGeneration === args.generation
      && prior.leaseId === args.leaseId && prior.providerReference === args.providerReference) return true
    if (state.revision !== args.expectedRevision) return false
    await ctx.db.patch(run._id, {remoteLifecycle: {...state, revision: state.revision + 1, providerStop: {
      provider: 'box', environmentId: args.environmentId, leaseId: args.leaseId, providerReference: args.providerReference,
      attemptId: args.attemptId, executionGeneration: args.generation, observedAt: args.now, recordedAtRevision: state.revision,
    }}, updatedAt: args.now})
    return true
  },
})
