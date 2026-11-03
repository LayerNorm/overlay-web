import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { action, internalAction } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const resourceValidator = v.optional(v.object({
  id: v.string(),
  revision: v.optional(v.string()),
  operation: v.optional(v.string()),
  page: v.optional(v.number()),
}))
const identity = {
  serverSecret: v.string(),
  actorUserId: v.string(),
  runId: v.string(),
  workflowRunId: v.string(),
}
function accessIdentity(args: { serverSecret: string; actorUserId: string; runId: string; workflowRunId: string }) {
  return { serverSecret: args.serverSecret, actorUserId: args.actorUserId, runId: args.runId, workflowRunId: args.workflowRunId }
}
const metadata = v.object({
  artifactId: v.string(),
  runId: v.string(),
  workflowRunId: v.string(),
  toolCallId: v.string(),
  toolName: v.string(),
  digest: v.string(),
  storageId: v.string(),
  byteSize: v.number(),
  mediaPartCount: v.number(),
  createdAt: v.number(),
  expiresAt: v.number(),
  resource: resourceValidator,
})
type ArtifactMetadata = {
  artifactId: string
  runId: string
  workflowRunId: string
  toolCallId: string
  toolName: string
  digest: string
  storageId: string
  byteSize: number
  mediaPartCount: number
  createdAt: number
  expiresAt: number
  resource?: { id: string; revision?: string; operation?: string; page?: number }
}

export const put = internalAction({
  args: {
    ...identity,
    artifactId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    digest: v.string(),
    data: v.bytes(),
    mediaPartCount: v.number(),
    resource: resourceValidator,
  },
  returns: metadata,
  handler: async (ctx, args): Promise<ArtifactMetadata> => {
    const bytes = new Uint8Array(args.data)
    if (!bytes.byteLength || bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error('HARNESS_ARTIFACT_LIMIT')
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (digest !== args.digest) throw new Error('HARNESS_ARTIFACT_DIGEST_MISMATCH')
    const existing: ArtifactMetadata | null = await ctx.runQuery(internal.harness.artifactMetadata.findByToolCall, {
      serverSecret: args.serverSecret, actorUserId: args.actorUserId, runId: args.runId,
      workflowRunId: args.workflowRunId, toolCallId: args.toolCallId,
    })
    if (existing) {
      if (existing.toolName !== args.toolName || existing.digest !== args.digest
        || existing.byteSize !== bytes.byteLength || existing.artifactId !== args.artifactId
        || existing.mediaPartCount !== args.mediaPartCount
        || JSON.stringify(existing.resource ?? null) !== JSON.stringify(args.resource ?? null)) {
        throw new Error('HARNESS_ARTIFACT_IDENTITY_CONFLICT')
      }
      return existing
    }
    const storageId = await ctx.storage.store(new Blob([bytes]))
    try {
      const attached = await ctx.runMutation(internal.harness.artifactMetadata.attach, {
        serverSecret: args.serverSecret, actorUserId: args.actorUserId, runId: args.runId,
        workflowRunId: args.workflowRunId, artifactId: args.artifactId, toolCallId: args.toolCallId,
        toolName: args.toolName, digest: args.digest, storageId, byteSize: bytes.byteLength,
        mediaPartCount: args.mediaPartCount,
        ...(args.resource ? { resource: args.resource } : {}),
      })
      if (attached.storageId !== String(storageId)) await ctx.storage.delete(storageId)
      return attached
    } catch (error) {
      await ctx.storage.delete(storageId)
      throw error
    }
  },
})

export const beginUpload = action({
  args: {
    serverSecret: v.string(), actorUserId: v.string(), runId: v.string(), workflowRunId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(internal.harness.artifactMetadata.authorizeArtifactAccess, args)
    if (!run) throw new Error('HARNESS_ARTIFACT_UNAUTHORIZED')
    return await ctx.storage.generateUploadUrl()
  },
})

export const attachUploaded = action({
  args: {
    ...identity,
    artifactId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    digest: v.string(),
    storageId: v.id('_storage'),
    byteSize: v.number(),
    mediaPartCount: v.number(),
    resource: resourceValidator,
  },
  returns: metadata,
  handler: async (ctx, args): Promise<ArtifactMetadata> => {
    const access = accessIdentity(args)
    const orphan = { ...access, storageId: args.storageId }
    try {
      const authorized = await ctx.runQuery(internal.harness.artifactMetadata.authorizeArtifactAccess, access)
      if (!authorized) throw new Error('HARNESS_ARTIFACT_UNAUTHORIZED')
      const blob = await ctx.storage.get(args.storageId)
      if (!blob || blob.size !== args.byteSize || !blob.size || blob.size > MAX_ARTIFACT_BYTES) {
        throw new Error('HARNESS_ARTIFACT_LIMIT')
      }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
        .map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (digest !== args.digest) throw new Error('HARNESS_ARTIFACT_DIGEST_MISMATCH')
      return await ctx.runMutation(internal.harness.artifactMetadata.attach, args)
    } catch (error) {
      await ctx.runAction(internal.harness.artifacts.deleteOrphan, orphan).catch(() => undefined)
      throw error
    }
  },
})

export const deleteOrphan = internalAction({
  args: { ...identity, storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorized = await ctx.runQuery(internal.harness.artifactMetadata.authorizeArtifactCleanup, accessIdentity(args))
    if (authorized) await ctx.storage.delete(args.storageId)
    return null
  },
})

export const read = internalAction({
  args: { ...identity, artifactId: v.string() },
  returns: v.union(v.bytes(), v.null()),
  handler: async (ctx, args): Promise<ArrayBuffer | null> => {
    const row: ArtifactMetadata | null = await ctx.runQuery(internal.harness.artifactMetadata.getMetadata, {
      ...accessIdentity(args), artifactId: args.artifactId,
    })
    if (!row) return null
    const blob: Blob | null = await ctx.storage.get(row.storageId as Id<'_storage'>)
    return blob ? await blob.arrayBuffer() : null
  },
})

export const readChunk = action({
  args: { ...identity, artifactId: v.string(), offset: v.number(), length: v.number() },
  returns: v.union(v.bytes(), v.null()),
  handler: async (ctx, args): Promise<ArrayBuffer | null> => {
    if (!Number.isSafeInteger(args.offset) || args.offset < 0 || !Number.isSafeInteger(args.length)
      || args.length < 1 || args.length > 256 * 1024) throw new Error('HARNESS_ARTIFACT_RANGE_INVALID')
    const row: ArtifactMetadata | null = await ctx.runQuery(internal.harness.artifactMetadata.getMetadata, {
      ...accessIdentity(args), artifactId: args.artifactId,
    })
    if (!row) return null
    const blob: Blob | null = await ctx.storage.get(row.storageId as Id<'_storage'>)
    if (!blob) return null
    return await blob.slice(args.offset, args.offset + args.length).arrayBuffer()
  },
})

export const cleanupExpired = internalAction({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!serverSecret) return null
    const now = Date.now()
    const rows: Array<{ _id: Id<'harnessContextArtifacts'>; storageId: Id<'_storage'> }> =
      await ctx.runQuery(internal.harness.artifactMetadata.listExpired, {
      serverSecret, now, limit: 100,
    })
    await Promise.all(rows.map(row => ctx.runMutation(
      internal.harness.artifactMetadata.deleteExpired, { serverSecret, id: row._id, now },
    )))
    return null
  },
})
