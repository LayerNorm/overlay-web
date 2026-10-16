import { z } from 'zod'

const id = z.string().min(1).max(200)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const mac = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const bytes = z.number().int().nonnegative().max(16 * 1024 * 1024)
const revision = z.number().int().nonnegative()
const requestId = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
const identity = { fileId: id, path: z.string().min(1).max(4096), updatedAt: revision }

/** Metadata operations intentionally select only identity/revision from a full manifest entry. */
export const driveMetadataEntrySchema = z.object({ ...identity, kind: z.enum(['file', 'folder']) })
const previous = { entry: driveMetadataEntrySchema, metadataMac: mac }
export const driveMetadataBodySchema = z.object({ action: z.literal('metadata'), requestId,
  operation: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('mkdir'), name: z.string().min(1).max(255), parentId: id.optional() }).strict(),
    z.object({ kind: z.literal('move'), ...previous, name: z.string().min(1).max(255), parentId: id.optional() }).strict(),
    z.object({ kind: z.literal('remove'), ...previous }).strict(),
  ]),
}).strict()
export const driveMetadataResultSchema = z.object({ fileId: id, updatedAt: revision }).strict()

const create = z.object({ kind: z.literal('create'), name: z.string().min(1).max(255), parentId: id.optional() }).strict()
export const driveUploadBodySchema = z.object({ action: z.literal('upload'), requestId,
  operation: z.discriminatedUnion('kind', [create, z.object({ kind: z.literal('replace'), ...previous }).strict()]),
  sha256: hash, sizeBytes: bytes, mimeType: z.string().max(200).regex(/^[\w.+-]+\/[\w.+-]+$/),
}).strict()
export const driveCommitBodySchema = z.object({ action: z.literal('commit'), uploadId: z.string().uuid() }).strict()
export const driveContentResultSchema = z.object({ fileId: id, updatedAt: revision, name: z.string(),
  conflict: z.boolean(), objectStored: z.boolean(), sha256: hash, sizeBytes: bytes }).strict()
export const driveUploadResponseSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), uploadId: z.string().uuid(), url: z.string().url().max(16384),
    headers: z.object({ 'content-type': z.string(), 'x-amz-checksum-sha256': z.string() }).strict(),
    sizeBytes: bytes, expiresIn: z.number().int().positive().max(120) }).strict(),
  z.object({ state: z.literal('committed'), uploadId: z.string().uuid(), result: driveContentResultSchema }).strict(),
])

export const driveReadyEntrySchema = z.object({ ...identity, kind: z.literal('file'), hydration: z.literal('ready'),
  sizeBytes: bytes, sha256: hash, metadataMac: mac, downloadMac: mac }).strict()
export const driveManifestEntrySchema = z.union([
  z.object({ ...identity, kind: z.literal('folder'), metadataMac: mac }).strict(),
  driveReadyEntrySchema,
  z.object({ ...identity, kind: z.literal('file'), hydration: z.literal('deferred'),
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), reason: z.enum(['file_limit', 'cache_limit']) }).strict(),
])
export const driveManifestFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manifest'), version: z.literal(1) }).strict(),
  z.object({ type: z.literal('entry'), entry: driveManifestEntrySchema }).strict(),
  z.object({ type: z.literal('complete'), entries: z.number().int().nonnegative().max(10000) }).strict(),
])
export type DriveManifestEntry = z.infer<typeof driveManifestEntrySchema>
export type DriveReadyEntry = z.infer<typeof driveReadyEntrySchema>
export type DriveUploadRequest = z.infer<typeof driveUploadBodySchema>
export type DriveUploadResponse = z.infer<typeof driveUploadResponseSchema>
export type DriveContentResult = z.infer<typeof driveContentResultSchema>
export type DriveMetadataRequest = z.infer<typeof driveMetadataBodySchema>
export type DriveMetadataResult = z.infer<typeof driveMetadataResultSchema>
