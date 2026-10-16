import {v} from 'convex/values'
import {executionFenceSchema, nativeStartRequestSchema, nativeStartAdmissionSchema, startAdapterPayloadSchema, type NativeStartAdmission} from '@layernorm/overlay-agent-bridge-protocol'
import type {Doc} from '../_generated/dataModel'
import type {MutationCtx} from '../_generated/server'
import {pendingRemoteApprovals} from '../../src/shared/agents/remote-run'
import {hydrateRemoteMessage} from './remoteMessageText'
import {nativeRecoveryIsAuthorized} from './nativeRecoveryAuthority'
import {nativeRecoverySnapshotSchema, nativeRestorationSnapshotSchema} from './nativeRecoveryPayload'
import {matchesNativeRestoration} from './nativePreparationRetry'
import {matchesCurrentRecoveryMachine, recoveryMachineBinding} from './remoteRecoveryMachine'

export const nativeStartAdmissionValidator = v.object({commandId: v.string(), attemptId: v.string(), generation: v.number(),
  hostBootId: v.string(), sourceEventCursor: v.number(), canonicalTextOffset: v.number(), hardDeadlineAt: v.number()})

/** Admission closes historical ingestion before any native process may start; it does not assert process health. */
export async function admitNativeStart(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>, session: Doc<'agentRemoteSessions'>,
  input: {payload: unknown; execution: unknown; now: number}): Promise<NativeStartAdmission> {
  const request = nativeStartRequestSchema.safeParse(input.payload), execution = executionFenceSchema.safeParse(input.execution)
  const snapshot = nativeRecoverySnapshotSchema.safeParse(session.capabilitySnapshot)
  const restoration = nativeRestorationSnapshotSchema.safeParse(session.capabilitySnapshot), state = run.remoteLifecycle
  if (!request.success || !execution.success || !execution.data.hostBootId || !snapshot.success || !restoration.success || !state
    || state.phase !== 'recovering' || state.cause !== 'native_restoration' || pendingRemoteApprovals(state).length
    || !Number.isSafeInteger(input.now) || input.now < run.createdAt || input.now >= state.hardDeadlineAt || execution.data.attemptId !== state.currentAttemptId
    || execution.data.generation !== state.executionGeneration || request.data.commandId !== session.restorationCommandId
    || request.data.remoteSessionId !== restoration.data.nativeRestoration.nativeSessionId
    || !await nativeRecoveryIsAuthorized(ctx, run, session, snapshot.data)) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
  const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', request.data.commandId)).unique()
  if (!command || command.status !== 'claimed' || !matchesNativeRestoration(state, session, command)
    || input.now < command.createdAt) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
  if (startAdapterPayloadSchema.parse(command.payload).adapterId !== request.data.adapterId) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
  const adapter = snapshot.data.adapters.find(candidate => candidate.id === request.data.adapterId && candidate.protocol === 'acp')
  if (!adapter?.recovery?.sessionLoading || !adapter.recovery.fencedSessionRestoration) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
  const previous = restoration.data.nativeRestoration.previousExecution, proof = state.providerStop
  const source = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', previous.attemptId)).unique()
  const sourceMachine = recoveryMachineBinding.safeParse(source?.capabilitySnapshot)
  if (!proof || !source || source.runId !== session.runId || source.workspaceId !== session.workspaceId
    || source.environmentId !== session.environmentId || source.bindingId !== session.bindingId
    || source.attemptId !== previous.attemptId || source.executionGeneration !== previous.generation || source.remoteSessionId !== request.data.remoteSessionId
    || source.status !== 'failed' || source.recoveryCause !== 'provider_isolated'
    || source.hardDeadlineAt !== session.hardDeadlineAt || source.endedAt === undefined || source.endedAt < proof.observedAt
    || !sourceMachine.success || sourceMachine.data.sandboxBilling.leaseId !== proof.leaseId
    || source.eventCursor !== request.data.sourceEventCursor
    || !await matchesCurrentRecoveryMachine(ctx, {runId: session.runId, environmentId: session.environmentId,
      leaseId: proof.leaseId, providerReference: proof.providerReference})) throw Error('AGENT_NATIVE_SOURCE_NOT_DRAINED')
  const approvals = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', session.sessionId)).take(101)
  if (approvals.length === 101 || approvals.some(request => !request.resolution)) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
  const existing = nativeStartAdmissionSchema.safeParse(session.nativeStartAdmission)
  if (session.nativeStartAdmission !== undefined && !existing.success) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
  if (existing.success) {
    const value = existing.data
    if (value.commandId !== request.data.commandId || value.attemptId !== execution.data.attemptId
      || value.generation !== execution.data.generation || value.hostBootId !== execution.data.hostBootId
      || value.sourceEventCursor !== request.data.sourceEventCursor) throw Error('AGENT_NATIVE_START_NOT_ADMITTED')
    return value
  }
  const message = await ctx.db.get(run.assistantMessageId)
  if (!message) throw Error('AGENT_REMOTE_MESSAGE_NOT_FOUND')
  const admitted = nativeStartAdmissionSchema.parse({commandId: request.data.commandId, attemptId: state.currentAttemptId,
    generation: state.executionGeneration, hostBootId: execution.data.hostBootId, sourceEventCursor: request.data.sourceEventCursor,
    canonicalTextOffset: (await hydrateRemoteMessage(ctx, message)).content.length, hardDeadlineAt: state.hardDeadlineAt})
  await ctx.db.patch(session._id, {nativeStartAdmission: admitted, updatedAt: input.now})
  return admitted
}
