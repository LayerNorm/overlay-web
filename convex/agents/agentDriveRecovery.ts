import {ConvexError, v} from 'convex/values'
import {z} from 'zod'
import {query} from '../_generated/server'
import {driveAuthorityArgs, requireDriveAuthority} from './agentDrive'
import {driveContentResult} from '../lib/agentDriveUploadSchema'
import {matchesCurrentRecoveryMachine, recoveryMachineBinding} from '../lib/remoteRecoveryMachine'
import {driveRecoveryRequestSchema, nativeRestorationSchema} from '@layernorm/overlay-agent-bridge-protocol'

const restorationSnapshot = z.object({nativeRestoration: nativeRestorationSchema.extend({
  nativeSessionId: z.string().min(1), commandId: z.string().min(1),
})})

/** The old generation cannot commit after replacement; immutable receipts distinguish a lost ACK from no write. */
export const readByServer = query({
  args: {...driveAuthorityArgs, request: v.object({action: v.literal('recover'), requestId: v.string(),
    previousExecution: v.object({attemptId: v.string(), generation: v.number()}),
    kind: v.union(v.literal('content'), v.literal('metadata')), fingerprint: v.string()})},
  returns: v.object({requestId: v.string(), previousExecution: v.object({attemptId: v.string(), generation: v.number()}),
    resolution: v.union(v.object({state: v.literal('uncommitted')}),
      v.object({state: v.literal('content_committed'), result: driveContentResult}),
      v.object({state: v.literal('metadata_committed'), result: v.object({fileId: v.id('files'), updatedAt: v.number()})}))}),
  handler: async (ctx, args) => {
    const {run, session} = await requireDriveAuthority(ctx, args)
    const parsed = driveRecoveryRequestSchema.safeParse(args.request)
    const snapshot = restorationSnapshot.safeParse(session.capabilitySnapshot)
    if (!parsed.success || !snapshot.success) throw new ConvexError('DRIVE_RECOVERY_UNAVAILABLE')
    const request = parsed.data, previous = request.previousExecution
    const restoration = snapshot.data.nativeRestoration, proof = run.remoteLifecycle?.providerStop
    if (!args.execution || args.execution.attemptId === previous.attemptId || args.execution.generation !== previous.generation + 1
      || restoration.previousExecution.attemptId !== previous.attemptId || restoration.previousExecution.generation !== previous.generation
      || !proof || proof.environmentId !== args.environmentId || proof.attemptId !== previous.attemptId
      || proof.executionGeneration !== previous.generation || proof.leaseId !== restoration.providerStop.leaseId
      || proof.providerReference !== restoration.providerStop.providerReference || proof.observedAt !== restoration.providerStop.observedAt
      || proof.observedAt > Date.now()) throw new ConvexError('DRIVE_RECOVERY_UNAVAILABLE')
    const source = await ctx.db.query('agentRemoteSessions').withIndex('by_sessionId', q => q.eq('sessionId', previous.attemptId)).unique()
    const sourceMachine = recoveryMachineBinding.safeParse(source?.capabilitySnapshot)
    if (!source || source.runId !== args.runId || source.workspaceId !== session.workspaceId || source.environmentId !== args.environmentId
      || source.bindingId !== args.bindingId || source.attemptId !== previous.attemptId || source.executionGeneration !== previous.generation
      || source.status !== 'failed' || source.recoveryCause !== 'provider_isolated' || source.endedAt === undefined
      || !sourceMachine.success || sourceMachine.data.sandboxBilling.leaseId !== proof.leaseId
      || source.hardDeadlineAt !== session.hardDeadlineAt || source.endedAt < proof.observedAt
      || source.remoteSessionId !== restoration.nativeSessionId
      || !await matchesCurrentRecoveryMachine(ctx, {runId: args.runId, environmentId: args.environmentId,
        leaseId: proof.leaseId, providerReference: proof.providerReference})) throw new ConvexError('DRIVE_RECOVERY_UNAVAILABLE')
    const [upload, metadata] = await Promise.all([
      ctx.db.query('agentDriveUploads').withIndex('by_runId_requestId', q => q.eq('runId', args.runId).eq('requestId', request.requestId)).unique(),
      ctx.db.query('agentDriveMetadataReceipts').withIndex('by_runId_requestId', q => q.eq('runId', args.runId).eq('requestId', request.requestId)).unique(),
    ])
    const prior = request.kind === 'content' ? upload : metadata
    if ((request.kind === 'content' && metadata) || (request.kind === 'metadata' && upload)
      || (prior && (prior.sessionId !== previous.attemptId || prior.attemptId !== previous.attemptId
        || prior.generation !== previous.generation || prior.fingerprint !== request.fingerprint))) throw new ConvexError('DRIVE_REQUEST_CONFLICT')
    if (prior && (prior.retireAt === undefined || prior.retireAt <= Date.now())) throw new ConvexError('DRIVE_RECOVERY_UNAVAILABLE')
    const identity = {requestId: request.requestId, previousExecution: previous}
    if (request.kind === 'content' && upload?.state.kind === 'committed') return {...identity,
      resolution: {state: 'content_committed' as const, result: upload.state.result}}
    if (request.kind === 'metadata' && metadata) return {...identity,
      resolution: {state: 'metadata_committed' as const, result: metadata.result}}
    // Absence is definitive only under the above current-generation fence. Neither old uploads nor metadata can commit now.
    return {...identity, resolution: {state: 'uncommitted' as const}}
  },
})
