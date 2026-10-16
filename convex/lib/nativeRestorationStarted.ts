import type {Doc} from '../_generated/dataModel'
import type {MutationCtx} from '../_generated/server'
import {startAdapterPayloadSchema} from '@layernorm/overlay-agent-bridge-protocol'
import {nativeRecoverySnapshotSchema, nativeRestorationSnapshotSchema} from './nativeRecoveryPayload'
import {matchesNativeRestoration} from './nativePreparationRetry'
import {matchesCurrentRecoveryMachine} from './remoteRecoveryMachine'
import {pendingRemoteApprovals} from '../../src/shared/agents/remote-run'

/** A start receipt must confirm the admitted conversation, delivery and isolated predecessor. */
export async function nativeRestorationStarted(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>,
  session: Doc<'agentRemoteSessions'>, input: {remoteSessionId: unknown; adapterId: unknown}): Promise<boolean> {
  const state = run.remoteLifecycle, stored = nativeRestorationSnapshotSchema.safeParse(session.capabilitySnapshot)
  const snapshot = nativeRecoverySnapshotSchema.safeParse(session.capabilitySnapshot)
  if (!state || !stored.success || !snapshot.success || pendingRemoteApprovals(state).length
    || input.remoteSessionId !== stored.data.nativeRestoration.nativeSessionId) return false
  const commandId = session.restorationCommandId ?? stored.data.nativeRestoration.commandId
  const command = await ctx.db.query('agentRunCommands').withIndex('by_commandId', q => q.eq('commandId', commandId)).unique()
  if (!command || !['claimed', 'acknowledged'].includes(command.status) || !matchesNativeRestoration(state, session, command)) return false
  const start = startAdapterPayloadSchema.safeParse(command.payload)
  if (!start.success || input.adapterId !== start.data.adapterId) return false
  const adapter = snapshot.data.adapters.find(candidate => candidate.id === start.data.adapterId && candidate.protocol === 'acp')
  if (!adapter?.recovery?.sessionLoading || !adapter.recovery.fencedSessionRestoration) return false
  const requests = await ctx.db.query('agentApprovalRequests').withIndex('by_remoteSessionId_requestKey', q => q.eq('remoteSessionId', session.sessionId)).take(101)
  if (requests.length === 101 || requests.some(request => !request.resolution)) return false
  const proof = state.providerStop
  return Boolean(proof && await matchesCurrentRecoveryMachine(ctx, {runId: session.runId, environmentId: session.environmentId,
    leaseId: proof.leaseId, providerReference: proof.providerReference}))
}
