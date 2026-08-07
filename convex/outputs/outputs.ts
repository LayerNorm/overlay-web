import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { applyStorageUsageDelta, ensureStorageAvailable } from '../files/lib/storageQuota'
import { classifyOutputType } from '../../src/shared/tools/output-types'
import { assertOwnedOutputR2Key, isOwnedOutputR2Key } from '../../src/shared/storage/storage-keys'

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

function buildProxyUrl(outputId: Id<'outputs'>): string {
  return `/api/v1/outputs/${outputId}/content`
}

function resolveStoredType(output: {
  type: string
  fileName?: string
  mimeType?: string
}) {
    return output.fileName || output.mimeType
    ? classifyOutputType(output.fileName, output.mimeType)
    : output.type
}

function outputFileName(args: { fileName?: string; type: string; id?: string }) {
  return args.fileName?.trim() || `${args.type}-${args.id ?? Date.now()}`
}

function outputTextContent(args: { type: string; metadata?: unknown }): string {
  if (args.type !== 'text' && args.type !== 'code' && args.type !== 'document') return ''
  const metadata = args.metadata as { text?: unknown; content?: unknown } | undefined
  const value = metadata?.text ?? metadata?.content
  return typeof value === 'string' ? value : ''
}

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    type: v.union(
      v.literal('image'),
      v.literal('video'),
      v.literal('audio'),
      v.literal('document'),
      v.literal('archive'),
      v.literal('code'),
      v.literal('text'),
      v.literal('other'),
    ),
    source: v.optional(
      v.union(
        v.literal('image_generation'),
        v.literal('video_generation'),
        v.literal('sandbox'),
      ),
    ),
    status: v.union(v.literal('pending'), v.literal('completed'), v.literal('failed')),
    prompt: v.string(),
    modelId: v.string(),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    url: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    metadata: v.optional(v.any()),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess({
      userId: args.userId,
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
    })
    if (args.r2Key) {
      assertOwnedOutputR2Key(args.userId, args.r2Key)
    }
    const sizeBytes = Math.max(0, args.sizeBytes ?? 0)
    if (sizeBytes > 0) {
      await ensureStorageAvailable(ctx as never, args.userId, sizeBytes)
    }
    const id = await ctx.db.insert('outputs', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      type: args.type,
      source:
        args.source ??
        (args.type === 'image'
          ? 'image_generation'
          : args.type === 'video'
            ? 'video_generation'
            : 'sandbox'),
      status: args.status,
      prompt: args.prompt,
      modelId: args.modelId,
      storageId: args.storageId,
      r2Key: args.r2Key,
      sizeBytes: sizeBytes || undefined,
      url: args.url,
      fileName: args.fileName,
      mimeType: args.mimeType,
      metadata: args.metadata,
      conversationId: args.conversationId,
      turnId: args.turnId,
      errorMessage: args.errorMessage,
      createdAt: Date.now(),
      completedAt: args.status === 'completed' ? Date.now() : undefined,
    })
    const textContent = outputTextContent({ type: args.type, metadata: args.metadata })
    const name = outputFileName({ fileName: args.fileName, type: args.type, id })
    const fileId = await ctx.db.insert('files', {
      userId: args.userId,
      name,
      type: 'file',
      kind: 'output',
      content: textContent,
      storageId: args.storageId,
      r2Key: args.r2Key,
      mimeType: args.mimeType,
      extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
      sizeBytes: args.sizeBytes ?? (textContent ? new TextEncoder().encode(textContent).length : 0),
      indexable: textContent.trim().length > 0,
      indexStatus: textContent.trim().length > 0 ? 'pending' : 'skipped',
      conversationId: args.conversationId,
      turnId: args.turnId,
      modelId: args.modelId,
      prompt: args.prompt,
      outputType: args.type,
      legacyOutputId: id,
      createdAt: Date.now(),
      updatedAt: args.status === 'completed' ? Date.now() : Date.now(),
    })
    await ctx.db.patch(id, { fileId })
    if (sizeBytes > 0) {
      await applyStorageUsageDelta(ctx as never, args.userId, sizeBytes)
    }
    return id
  },
})

export const update = mutation({
  args: {
    outputId: v.id('outputs'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    status: v.optional(v.union(v.literal('pending'), v.literal('completed'), v.literal('failed'))),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    url: v.optional(v.string()),
    modelId: v.optional(v.string()),
    source: v.optional(
      v.union(
        v.literal('image_generation'),
        v.literal('video_generation'),
        v.literal('sandbox'),
      ),
    ),
    type: v.optional(
      v.union(
        v.literal('image'),
        v.literal('video'),
        v.literal('audio'),
        v.literal('document'),
        v.literal('archive'),
        v.literal('code'),
        v.literal('text'),
        v.literal('other'),
      ),
    ),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    metadata: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { outputId, userId, accessToken, serverSecret, status, storageId, r2Key, sizeBytes, url, modelId, source, type, fileName, mimeType, metadata, errorMessage },
  ) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const output = await ctx.db.get(outputId)
    if (!output || output.userId !== userId) {
      throw new Error('Unauthorized')
    }
    if (r2Key !== undefined && r2Key) {
      assertOwnedOutputR2Key(userId, r2Key)
    }
    const updates: Record<string, unknown> = {}
    const previousSizeBytes = output.sizeBytes ?? 0
    const nextSizeBytes = sizeBytes ?? previousSizeBytes
    const storageDelta = nextSizeBytes - previousSizeBytes
    if (storageDelta > 0) {
      await ensureStorageAvailable(ctx as never, userId, storageDelta)
    }
    if (status !== undefined) updates.status = status
    if (storageId !== undefined) updates.storageId = storageId
    if (r2Key !== undefined) updates.r2Key = r2Key
    if (sizeBytes !== undefined) updates.sizeBytes = sizeBytes
    if (url !== undefined) updates.url = url
    if (modelId !== undefined) updates.modelId = modelId
    if (source !== undefined) updates.source = source
    if (type !== undefined) updates.type = type
    if (fileName !== undefined) updates.fileName = fileName
    if (mimeType !== undefined) updates.mimeType = mimeType
    if (metadata !== undefined) updates.metadata = metadata
    if (errorMessage !== undefined) updates.errorMessage = errorMessage
    if (status === 'completed' || status === 'failed') updates.completedAt = Date.now()
    await ctx.db.patch(outputId, updates)
    const nextOutput = await ctx.db.get(outputId)
    const fileId = nextOutput?.fileId
    if (nextOutput && fileId) {
      const resolvedType = type ?? nextOutput.type
      const textContent = outputTextContent({ type: resolvedType, metadata: metadata ?? nextOutput.metadata })
      const name = outputFileName({ fileName: fileName ?? nextOutput.fileName, type: resolvedType, id: outputId })
      await ctx.db.patch(fileId, {
        name,
        content: textContent,
        storageId: storageId !== undefined ? storageId : nextOutput.storageId,
        r2Key: r2Key !== undefined ? r2Key : nextOutput.r2Key,
        mimeType: mimeType !== undefined ? mimeType : nextOutput.mimeType,
        extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
        sizeBytes: nextSizeBytes || (textContent ? new TextEncoder().encode(textContent).length : 0),
        indexable: textContent.trim().length > 0,
        indexStatus: textContent.trim().length > 0 ? 'pending' : 'skipped',
        modelId: modelId !== undefined ? modelId : nextOutput.modelId,
        outputType: resolvedType,
        updatedAt: Date.now(),
      })
      if (textContent.trim()) {
        await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId })
      }
    }
    if (storageDelta !== 0) {
      await applyStorageUsageDelta(ctx as never, userId, storageDelta)
    }
  },
})

export const get = query({
  args: { outputId: v.id('outputs'), userId: v.string(), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { outputId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const output = await ctx.db.get(outputId)
    if (!output || output.userId !== userId) return null
    return {
      ...output,
      type: resolveStoredType(output),
      url: (output.storageId ?? output.r2Key) ? buildProxyUrl(output._id) : output.url,
    }
  },
})

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal('image'),
        v.literal('video'),
        v.literal('audio'),
        v.literal('document'),
        v.literal('archive'),
        v.literal('code'),
        v.literal('text'),
        v.literal('other'),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, type, limit }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const taken = await ctx.db
      .query('outputs')
      .withIndex('by_userId_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .take(limit ?? 100)

    const all = workspaceId !== undefined ? taken.filter((output) => output.workspaceId === workspaceId) : taken

    const normalized = all.map((output) => ({
      ...output,
      type: resolveStoredType(output),
      url: (output.storageId ?? output.r2Key) ? buildProxyUrl(output._id) : output.url,
    }))

    return type ? normalized.filter((output) => output.type === type) : normalized
  },
})

export const listByConversationId = query({
  args: { conversationId: v.string(), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { conversationId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const all = await ctx.db
      .query('outputs')
      .withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
      .order('desc')
      .collect()
    return all
      .filter((output) => output.userId === userId)
      .filter((output) => (workspaceId !== undefined ? output.workspaceId === workspaceId : true))
      .map((output) => ({
        ...output,
        type: resolveStoredType(output),
        url: (output.storageId ?? output.r2Key) ? buildProxyUrl(output._id) : output.url,
      }))
  },
})

export const listByTurnId = query({
  args: { turnId: v.string(), userId: v.string(), workspaceId: v.optional(v.string()), accessToken: v.optional(v.string()), serverSecret: v.optional(v.string()) },
  handler: async (ctx, { turnId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const all = await ctx.db
      .query('outputs')
      .withIndex('by_turnId', (q) => q.eq('turnId', turnId))
      .order('desc')
      .collect()
    return all
      .filter((output) => output.userId === userId)
      .filter((output) => (workspaceId !== undefined ? output.workspaceId === workspaceId : true))
      .map((output) => ({
        ...output,
        type: resolveStoredType(output),
        url: (output.storageId ?? output.r2Key) ? buildProxyUrl(output._id) : output.url,
      }))
  },
})

export const getStorageUrlForProxy = query({
  args: {
    outputId: v.id('outputs'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { outputId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const output = await ctx.db.get(outputId)
    if (!output || output.userId !== userId) return null
    if (output.r2Key) {
      if (!isOwnedOutputR2Key(userId, output.r2Key)) {
        return null
      }
      return {
        r2Key: output.r2Key,
        sizeBytes: output.sizeBytes ?? 0,
        type: resolveStoredType(output),
        fileName: output.fileName,
        mimeType: output.mimeType,
      }
    }
    if (output.storageId) {
      const url = await ctx.storage.getUrl(output.storageId)
      if (!url) return null
      return {
        url,
        sizeBytes: output.sizeBytes ?? 0,
        type: resolveStoredType(output),
        fileName: output.fileName,
        mimeType: output.mimeType,
      }
    }
    return null
  },
})

export const remove = mutation({
  args: {
    outputId: v.id('outputs'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    r2CleanupConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, { outputId, userId, accessToken, serverSecret, r2CleanupConfirmed }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const output = await ctx.db.get(outputId)
    if (!output || output.userId !== userId) throw new Error('Unauthorized')
    if (output.storageId) {
      await ctx.storage.delete(output.storageId)
    }
    if (output.sizeBytes && (!output.r2Key || r2CleanupConfirmed === true)) {
      await applyStorageUsageDelta(ctx as never, userId, -output.sizeBytes)
    }
    if (output.fileId) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'file',
        sourceId: output.fileId,
        userId,
      })
      await ctx.db.patch(output.fileId, {
        deletedAt: Date.now(),
        updatedAt: Date.now(),
        indexStatus: 'skipped',
      })
    }
    await ctx.db.delete(outputId)
    return { success: true }
  },
})
