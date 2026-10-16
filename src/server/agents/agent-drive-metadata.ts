import 'server-only'
import { z } from 'zod'

import { driveMetadataBodySchema, driveMetadataEntrySchema, driveMetadataResultSchema } from '@layernorm/overlay-agent-bridge-protocol'
export { driveMetadataBodySchema, driveMetadataEntrySchema, driveMetadataResultSchema }

export type DriveMetadataRequest = z.infer<typeof driveMetadataBodySchema>
export type DriveMetadataEntry = z.infer<typeof driveMetadataEntrySchema>
export type DriveMetadataOperation =
  | { kind: 'mkdir'; name: string; parentId?: string }
  | { kind: 'move'; fileId: string; path: string; updatedAt: number; name: string; parentId?: string }
  | { kind: 'remove'; fileId: string; path: string; updatedAt: number }
export type DriveMetadataResult = z.infer<typeof driveMetadataResultSchema>
