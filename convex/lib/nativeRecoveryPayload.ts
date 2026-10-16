import {driveStartDescriptorSchema, startAdapterPayloadSchema, type executionFenceSchema} from '@layernorm/overlay-agent-bridge-protocol'
import {z} from 'zod'
import type {RemoteRunState} from '../../src/shared/agents/remote-run'

export const nativeRecoverySnapshotSchema = z.object({
  adapters: z.array(z.object({id: z.string(), protocol: z.string(), recovery: z.object({
    sessionLoading: z.boolean(), fencedSessionRestoration: z.boolean().optional(),
  }).passthrough().optional()}).passthrough()),
  sandboxBilling: z.object({leaseId: z.string(), reservationId: z.string().optional()}).passthrough(),
  billing: z.object({reservationId: z.string().nullable().optional()}).passthrough().optional(),
}).passthrough()

/** Preserve the original grant/settings while replacing execution-scoped delivery and the text cursor. */
export function nativeRecoveryPayload(input: {original: unknown; nativeSessionId: string; newAttemptId: string;
  previousExecution: z.infer<typeof executionFenceSchema>; providerStop: NonNullable<RemoteRunState['providerStop']>; textOffset: number}) {
  const original = startAdapterPayloadSchema.parse(input.original)
  const metadata: typeof original.metadata = {...original.metadata, recoveryTextOffset: input.textOffset}
  if (original.metadata.overlayDrive !== undefined) metadata.overlayDrive = {
    ...driveStartDescriptorSchema.parse(original.metadata.overlayDrive), sessionId: input.newAttemptId,
  }
  return startAdapterPayloadSchema.parse({...original, fresh: false, sessionId: input.nativeSessionId,
    prompt: 'You were interrupted. Continue the task from where you stopped; files in the drive are current. Preserve completed work and verify any uncertain prior action before repeating it.',
    metadata, restore: {previousExecution: input.previousExecution, providerStop: {provider: input.providerStop.provider,
      leaseId: input.providerStop.leaseId, providerReference: input.providerStop.providerReference, observedAt: input.providerStop.observedAt}}})
}
