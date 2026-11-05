import { z } from 'zod/v3'
import type { CapabilityCheck } from '@overlay/app-core'

export type NativeDeploymentFeature = keyof CapabilityCheck | 'workspaceHandles'
export const NATIVE_POLICY_LEASE_MS = 180_000
export const NATIVE_POLICY_RESPONSE_MAX_BYTES = 65_536
export const NATIVE_POLICY_RESPONSE_MAX_AGE_MS = 30_000

export const nativePolicySnapshotSchema = z.object({
  version: z.literal(1),
  backendUrl: z.string().url().max(2048),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  features: z.record(z.boolean()),
  rollout: z.object({
    stage: z.enum(['off', 'internal', 'invited', 'general']),
    internalWorkspaceIds: z.string().max(16_384),
    invitedWorkspaceIds: z.string().max(16_384),
  }),
})

export const nativePolicyResponseSchema = z.object({
  challenge: z.string().uuid(),
  issuedAt: z.number().finite(),
  snapshot: nativePolicySnapshotSchema,
})

export type NativePolicySnapshot = z.infer<typeof nativePolicySnapshotSchema>
