import {z} from 'zod'
import {driveContentResultSchema, driveMetadataResultSchema} from './drive.js'

const previousExecution = z.object({attemptId: z.string().min(1).max(200), generation: z.number().int().positive()}).strict()
const identity = {requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), previousExecution}

/** Receipt lookup only: this request never grants authority to repeat an old write. */
export const driveRecoveryRequestSchema = z.object({action: z.literal('recover'), ...identity,
  kind: z.enum(['content', 'metadata']), fingerprint: z.string().min(1).max(16384),
}).strict()
export const driveRecoveryResultSchema = z.object({...identity, resolution: z.discriminatedUnion('state', [
  z.object({state: z.literal('uncommitted')}).strict(),
  z.object({state: z.literal('content_committed'), result: driveContentResultSchema}).strict(),
  z.object({state: z.literal('metadata_committed'), result: driveMetadataResultSchema}).strict(),
])}).strict()
export type DriveRecoveryRequest = z.infer<typeof driveRecoveryRequestSchema>
export type DriveRecoveryResult = z.infer<typeof driveRecoveryResultSchema>
