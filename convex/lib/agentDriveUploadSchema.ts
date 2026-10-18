import { v } from 'convex/values'

export const driveUploadOperation = v.union(
  v.object({ kind: v.literal('create'), name: v.string(), parentId: v.optional(v.id('files')) }),
  v.object({ kind: v.literal('replace'), fileId: v.id('files'), path: v.string(), updatedAt: v.number() }),
)
export const driveContentResult = v.object({ fileId: v.id('files'), updatedAt: v.number(),
  name: v.string(), conflict: v.boolean(), objectStored: v.boolean(), sha256: v.string(), sizeBytes: v.number() })
export const driveUploadState = v.union(
  v.object({ kind: v.literal('pending') }),
  v.object({ kind: v.literal('committed'), result: driveContentResult }),
)

export const driveUploadFields = {
  uploadId: v.string(), runId: v.string(), sessionId: v.string(), requestId: v.string(),
  attemptId: v.optional(v.string()), generation: v.optional(v.number()), fingerprint: v.string(),
  operation: driveUploadOperation, ownerUserId: v.string(), name: v.string(), parentId: v.optional(v.id('files')),
  sha256: v.string(), sizeBytes: v.number(), mimeType: v.string(), stagingKey: v.string(), finalKey: v.string(),
  state: driveUploadState, expiresAt: v.number(), retireAt: v.number(), createdAt: v.number(),
}
