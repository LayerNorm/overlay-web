import type {Doc} from '../_generated/dataModel'
import type {MutationCtx} from '../_generated/server'
import {nativeRestorationSnapshotSchema} from './nativeRecoveryPayload'
import {recoveryMachineBinding} from './remoteRecoveryMachine'
import {z} from 'zod'

const sourceAdapterSchema = z.object({startPayload: z.object({adapterId: z.string()})})

/** Read-only evidence from the immediately isolated source may drain until the new native writer is admitted. */
export async function acceptsNativeHistory(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>,
  source: Doc<'agentRemoteSessions'>, events: ReadonlyArray<{type: string; payload: Record<string, unknown>}>, now: number): Promise<boolean> {
  const state = run.remoteLifecycle, proof = state?.providerStop
  if (!state || !proof || source.sessionId === state.currentAttemptId || source.sessionId !== proof.attemptId || source.attemptId !== source.sessionId
    || source.executionGeneration !== proof.executionGeneration || state.executionGeneration !== proof.executionGeneration + 1
    || proof.environmentId !== source.environmentId || run.environmentId !== source.environmentId || run.bindingId !== source.bindingId || proof.observedAt > now
    || source.status !== 'failed' || source.recoveryCause !== 'provider_isolated'
    || source.endedAt === undefined || source.endedAt < proof.observedAt) return false
  const adapter = sourceAdapterSchema.safeParse(source.capabilitySnapshot)
  if (events.some(event => event.type === 'session_started' && (!adapter.success
    || event.payload.remoteSessionId !== source.remoteSessionId || event.payload.adapterId !== adapter.data.startPayload.adapterId
    || (source.nativeStartAdmission && event.payload.restorationCommandId !== source.nativeStartAdmission.commandId)))) return false
  const attemptId = state.currentAttemptId
  const current = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', attemptId)).unique()
  const snapshot = nativeRestorationSnapshotSchema.safeParse(current?.capabilitySnapshot)
  const sourceMachine = recoveryMachineBinding.safeParse(source.capabilitySnapshot)
  const currentMachine = recoveryMachineBinding.safeParse(current?.capabilitySnapshot)
  if (!current || current.attemptId !== state.currentAttemptId || current.executionGeneration !== state.executionGeneration
    || !current.nativeStartAdmissionRequired || current.nativeStartAdmission || !snapshot.success
    || current.workspaceId !== source.workspaceId || current.environmentId !== source.environmentId
    || current.bindingId !== source.bindingId || current.runId !== source.runId || source.runId !== run.externalRunId
    || current.hardDeadlineAt !== source.hardDeadlineAt || current.hardDeadlineAt !== state.hardDeadlineAt
    || !sourceMachine.success || !currentMachine.success || sourceMachine.data.sandboxBilling.leaseId !== proof.leaseId
    || currentMachine.data.sandboxBilling.leaseId !== proof.leaseId) return false
  const restoration = snapshot.data.nativeRestoration
  return restoration.previousExecution.attemptId === source.sessionId && restoration.previousExecution.generation === source.executionGeneration
    && restoration.nativeSessionId === source.remoteSessionId && current.remoteSessionId === source.remoteSessionId
    && restoration.providerStop.provider === proof.provider && restoration.providerStop.leaseId === proof.leaseId
    && restoration.providerStop.providerReference === proof.providerReference && restoration.providerStop.observedAt === proof.observedAt
}
