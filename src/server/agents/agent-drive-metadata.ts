import 'server-only'
import { z } from 'zod'

const id = z.string().min(1).max(200)
export const driveMetadataEntrySchema = z.object({ fileId: id, path: z.string().min(1).max(4096),
  kind: z.enum(['file', 'folder']), updatedAt: z.number().int().nonnegative() })
const previous = { entry: driveMetadataEntrySchema, metadataMac: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }
export const driveMetadataBodySchema = z.object({ action: z.literal('metadata'), requestId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('mkdir'), name: z.string().min(1).max(255), parentId: id.optional() }).strict(),
    z.object({ kind: z.literal('move'), ...previous, name: z.string().min(1).max(255), parentId: id.optional() }).strict(),
    z.object({ kind: z.literal('remove'), ...previous }).strict(),
  ]),
}).strict()
export type DriveMetadataRequest = z.infer<typeof driveMetadataBodySchema>
export type DriveMetadataEntry = z.infer<typeof driveMetadataEntrySchema>
export type DriveMetadataOperation =
  | { kind: 'mkdir'; name: string; parentId?: string }
  | { kind: 'move'; fileId: string; path: string; updatedAt: number; name: string; parentId?: string }
  | { kind: 'remove'; fileId: string; path: string; updatedAt: number }
export const driveMetadataResultSchema = z.object({ fileId: id, updatedAt: z.number().int().nonnegative() }).strict()
export type DriveMetadataResult = z.infer<typeof driveMetadataResultSchema>
