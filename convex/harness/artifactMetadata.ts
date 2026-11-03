import { v } from 'convex/values'
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_RUN_BYTES = 128 * 1024 * 1024
const MAX_RUN_ARTIFACTS = 1_024
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

async function findActiveRun(ctx: QueryCtx | MutationCtx, args: {
  actorUserId: string; runId: string; workflowRunId: string; serverSecret: string
}) {
  if (!validateServerSecret(args.serverSecret)) throw new Error('HARNESS_ARTIFACT_UNAUTHORIZED')
  const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
  const state = run ? JSON.parse(run.metadataJson) as { workflowRunId?: string; status?: string } : null
  if (!run || run.actorUserId !== args.actorUserId || state?.workflowRunId !== args.workflowRunId
    || ['completed', 'failed', 'cancelled'].includes(state.status ?? '')) {
    throw new Error('HARNESS_ARTIFACT_UNAUTHORIZED')
  }
  return run
}

function publicMetadata(row: {
  artifactId: string; runId: string; workflowRunId: string; toolCallId: string; toolName: string;
  digest: string; storageId: string; byteSize: number; mediaPartCount: number; createdAt: number; expiresAt: number;
  resource?: { id: string; revision?: string; operation?: string; page?: number }
}) {
  return {
    artifactId: row.artifactId,
    runId: row.runId,
    workflowRunId: row.workflowRunId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    digest: row.digest,
    storageId: String(row.storageId),
    byteSize: row.byteSize,
    mediaPartCount: row.mediaPartCount,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(row.resource ? { resource: row.resource } : {}),
  }
}

export const findByToolCall = internalQuery({
  args: { ...identity, toolCallId: v.string() },
  returns: v.union(metadata, v.null()),
  handler: async (ctx, args) => {
    await findActiveRun(ctx, args)
    const row = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_runId_toolCallId', q => q.eq('runId', args.runId).eq('toolCallId', args.toolCallId))
      .unique()
    return row ? publicMetadata(row) : null
  },
})

export const authorizeArtifactAccess = internalQuery({
  args: identity,
  returns: v.union(v.object({ _id: v.id('harnessRuns'), runId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const run = await findActiveRun(ctx, args)
    return run ? { _id: run._id, runId: run.runId } : null
  },
})

export const authorizeArtifactCleanup = internalQuery({
  args: identity,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return false
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', args.runId)).unique()
    const state = run ? JSON.parse(run.metadataJson) as { workflowRunId?: string } : null
    return Boolean(run && run.actorUserId === args.actorUserId && state?.workflowRunId === args.workflowRunId)
  },
})

export const attach = internalMutation({
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
  handler: async (ctx, args) => {
    await findActiveRun(ctx, args)
    if (!args.toolCallId.trim() || args.toolCallId.length > 256 || !args.toolName.trim() || args.toolName.length > 256
      || !/^ha_[a-f0-9]{64}$/.test(args.artifactId) || !/^[a-f0-9]{64}$/.test(args.digest)
      || !Number.isSafeInteger(args.byteSize) || args.byteSize < 1 || args.byteSize > MAX_ARTIFACT_BYTES
      || !Number.isSafeInteger(args.mediaPartCount) || args.mediaPartCount < 0 || args.mediaPartCount > 256) {
      throw new Error('HARNESS_ARTIFACT_INVALID')
    }
    if (args.resource && (!args.resource.id.trim() || args.resource.id.length > 512
      || args.resource.revision !== undefined && args.resource.revision.length > 512
      || args.resource.operation !== undefined && args.resource.operation.length > 128
      || args.resource.page !== undefined && (!Number.isSafeInteger(args.resource.page) || args.resource.page < 1))) {
      throw new Error('HARNESS_ARTIFACT_INVALID')
    }
    const previous = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_runId_toolCallId', q => q.eq('runId', args.runId).eq('toolCallId', args.toolCallId))
      .unique()
    if (previous) {
      if (previous.toolName !== args.toolName || previous.digest !== args.digest
        || previous.byteSize !== args.byteSize || previous.artifactId !== args.artifactId
        || previous.mediaPartCount !== args.mediaPartCount
        || JSON.stringify(previous.resource ?? null) !== JSON.stringify(args.resource ?? null)) {
        throw new Error('HARNESS_ARTIFACT_IDENTITY_CONFLICT')
      }
      if (previous.storageId !== args.storageId) await ctx.storage.delete(args.storageId)
      return publicMetadata(previous)
    }
    const runArtifacts = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_runId_createdAt', q => q.eq('runId', args.runId))
      .take(MAX_RUN_ARTIFACTS + 1)
    if (runArtifacts.length >= MAX_RUN_ARTIFACTS
      || runArtifacts.reduce((total: number, row: { byteSize: number }) => total + row.byteSize, 0) + args.byteSize > MAX_RUN_BYTES) {
      throw new Error('HARNESS_ARTIFACT_RUN_LIMIT')
    }
    const createdAt = Date.now()
    const row = {
      runId: args.runId, workflowRunId: args.workflowRunId, toolCallId: args.toolCallId,
      toolName: args.toolName, digest: args.digest, storageId: args.storageId,
      byteSize: args.byteSize, mediaPartCount: args.mediaPartCount, createdAt, expiresAt: Number.MAX_SAFE_INTEGER,
      artifactId: args.artifactId,
      ...(args.resource ? { resource: args.resource } : {}),
    }
    await ctx.db.insert('harnessContextArtifacts', row)
    return publicMetadata({ ...row, storageId: String(row.storageId) })
  },
})

export const getMetadata = internalQuery({
  args: { ...identity, artifactId: v.string() },
  returns: v.union(metadata, v.null()),
  handler: async (ctx, args) => {
    await findActiveRun(ctx, args)
    const row = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_runId_artifactId', q => q.eq('runId', args.runId).eq('artifactId', args.artifactId))
      .unique()
    if (!row || row.workflowRunId !== args.workflowRunId) return null
    return publicMetadata(row)
  },
})

export const getMetadataForServer = query({
  args: { ...identity, artifactId: v.string() },
  returns: v.union(metadata, v.null()),
  handler: async (ctx, args) => {
    await findActiveRun(ctx, args)
    const row = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_runId_artifactId', q => q.eq('runId', args.runId).eq('artifactId', args.artifactId))
      .unique()
    if (!row || row.workflowRunId !== args.workflowRunId) return null
    return publicMetadata(row)
  },
})

export const listExpired = internalQuery({
  args: { serverSecret: v.string(), now: v.number(), limit: v.number() },
  returns: v.array(v.object({ _id: v.id('harnessContextArtifacts'), storageId: v.id('_storage') })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return []
    const rows = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_expiresAt', q => q.lte('expiresAt', args.now))
      .take(Math.min(100, Math.max(1, args.limit)))
    return rows.map(row => ({ _id: row._id, storageId: row.storageId }))
  },
})

export const deleteExpired = internalMutation({
  args: { serverSecret: v.string(), id: v.id('harnessContextArtifacts'), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) return null
    const row = await ctx.db.get(args.id)
    if (!row || row.expiresAt > args.now) return null
    await ctx.storage.delete(row.storageId)
    await ctx.db.delete(row._id)
    return null
  },
})
