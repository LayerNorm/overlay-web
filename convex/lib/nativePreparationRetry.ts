import {startAdapterPayloadSchema} from '@layernorm/overlay-agent-bridge-protocol'
import type {Doc} from '../_generated/dataModel'
import type {MutationCtx} from '../_generated/server'
import type {RemoteRunState} from '../../src/shared/agents/remote-run'
import {pendingRemoteApprovals} from '../../src/shared/agents/remote-run'
import {signalRemoteLifecycle} from '../agents/remoteRunModel'
import {nativeRecoveryIsAuthorized} from './nativeRecoveryAuthority'
import {nativeRecoverySnapshotSchema, nativeRestorationSnapshotSchema} from './nativeRecoveryPayload'
import {matchesCurrentRecoveryMachine} from './remoteRecoveryMachine'
import {projectNativePreparation} from './nativePreparationProjection'

const MAX_PREPARATION_RETRIES = 3

export function matchesNativeRestoration(state: RemoteRunState, session: Doc<'agentRemoteSessions'>, command: Doc<'agentRunCommands'>): boolean {
  const payload = startAdapterPayloadSchema.safeParse(command.payload)
  const stored = nativeRestorationSnapshotSchema.safeParse(session.capabilitySnapshot)
  const proof = state.providerStop
  if (!payload.success || !stored.success || !payload.data.restore || !proof || command.type !== 'start') return false
  const restoration = stored.data.nativeRestoration, previous = restoration.previousExecution
  return command.attemptId === state.currentAttemptId && command.attemptId === session.sessionId
    && command.executionGeneration === state.executionGeneration && state.executionGeneration === previous.generation + 1
    && command.workspaceId === session.workspaceId && command.environmentId === session.environmentId
    && payload.data.bindingId === session.bindingId
    && payload.data.sessionId === restoration.nativeSessionId && session.remoteSessionId === restoration.nativeSessionId
    && proof.environmentId === session.environmentId && proof.attemptId === previous.attemptId && proof.executionGeneration === previous.generation
    && proof.leaseId === restoration.providerStop.leaseId && proof.providerReference === restoration.providerStop.providerReference
    && proof.observedAt === restoration.providerStop.observedAt
    && JSON.stringify(payload.data.restore) === JSON.stringify({previousExecution: previous, providerStop: restoration.providerStop})
}

/** Called only for the authenticated host's confirmed pre-provider transient failure. No new execution is created. */
export async function retryNativePreparation(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>,
  session: Doc<'agentRemoteSessions'>, command: Doc<'agentRunCommands'>, now: number): Promise<boolean> {
  const state = run.remoteLifecycle, snapshot = nativeRecoverySnapshotSchema.safeParse(session.capabilitySnapshot)
  if (!state || state.phase !== 'recovering' || state.cause !== 'native_restoration' || !snapshot.success
    || command.status !== 'claimed' || session.restorationCommandId !== command.commandId
    || state.lastHealthAt !== undefined || session.startedAt !== undefined || pendingRemoteApprovals(state).length
    || !Number.isSafeInteger(now) || now < command.createdAt || now >= state.hardDeadlineAt
    || (session.preparationRetryCount ?? 0) >= MAX_PREPARATION_RETRIES || !matchesNativeRestoration(state, session, command)) return false
  const start = startAdapterPayloadSchema.parse(command.payload)
  const adapter = snapshot.data.adapters.find(candidate => candidate.id === start.adapterId && candidate.protocol === 'acp')
  if (!adapter?.recovery?.sessionLoading || !adapter.recovery.fencedSessionRestoration
    || !await nativeRecoveryIsAuthorized(ctx, run, session, snapshot.data)) return false
  const proof = state.providerStop
  if (!proof || now < proof.observedAt || !await matchesCurrentRecoveryMachine(ctx, {runId: command.runId,
    environmentId: command.environmentId, leaseId: proof.leaseId, providerReference: proof.providerReference})) return false
  const requests = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', session.sessionId)).take(101)
  if (requests.length === 101 || requests.some(request => !request.resolution)) return false
  const commandId = `native-prep-retry:${command._id}`
  const latest = await ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', session.environmentId)).order('desc').first()
  await ctx.db.insert('agentRunCommands', {commandId, workspaceId: command.workspaceId, environmentId: command.environmentId,
    runId: command.runId, attemptId: session.sessionId, executionGeneration: state.executionGeneration,
    type: 'start', payload: start, sequence: (latest?.sequence ?? 0) + 1, status: 'pending', createdAt: now, updatedAt: now})
  const claimDeadlineAt = Math.min(state.hardDeadlineAt, now + 120000)
  const next = {...state, revision: state.revision + 1, claimDeadlineAt}
  delete next.lastPreparationAt
  await ctx.db.patch(run._id, {remoteLifecycle: next, updatedAt: now})
  await ctx.db.patch(session._id, {restorationCommandId: commandId, preparationRetryCount: (session.preparationRetryCount ?? 0) + 1,
    claimDeadlineAt, hostBootId: undefined, updatedAt: now})
  await projectNativePreparation(ctx, run, next, {workspaceId: session.workspaceId, environmentName: snapshot.data.environmentName, now})
  await signalRemoteLifecycle(ctx, {...run, remoteLifecycle: next}, now)
  return true
}
