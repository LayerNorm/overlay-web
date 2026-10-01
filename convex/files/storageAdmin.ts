import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { getOrCreateSubscription } from './lib/storageQuota'

const utf8Encoder = new TextEncoder()

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8Encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function measureRemoteSize(url: string): Promise<number> {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    const lengthHeader = head.headers.get('content-length')
    const headLength = lengthHeader ? Number(lengthHeader) : NaN
    if (head.ok && Number.isFinite(headLength) && headLength >= 0) {
      return Math.round(headLength)
    }
  } catch {
    // Fall through to a streamed GET when HEAD is unavailable.
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to measure remote asset: HTTP ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) {
    const arrayBuffer = await res.arrayBuffer()
    return arrayBuffer.byteLength
  }
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
  }
  return total
}

function topEntries<T>(entries: T[], limit = 10): T[] {
  return entries.slice(0, limit)
}

type BackfillFileRow = Pick<
  Doc<'files'>,
  '_id' | '_creationTime' | 'userId' | 'name' | 'type' | 'content' | 'storageId' | 'sizeBytes' | 'contentHash' | 'duplicateOfFileId'
>

type BackfillOutputRow = Pick<
  Doc<'outputs'>,
  '_id' | '_creationTime' | 'userId' | 'type' | 'storageId' | 'sizeBytes'
>

type BackfillSubscriptionRow = Pick<
  Doc<'subscriptions'>,
  '_id' | '_creationTime' | 'userId' | 'currentPeriodStart'
>

export const auditByServer = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, { serverSecret }) => {
    requireServerSecret(serverSecret)

    const [
      subscriptions,
      tokenUsage,
      toolInvocations,
      dailyUsage,
      sessionTransferTokens,
      projects,
      skills,
      conversations,
      conversationMessages,
      notes,
      memories,
      knowledgeChunks,
      sampledKnowledgeChunkEmbeddings,
      outputs,
      files,
    ] = await Promise.all([
      ctx.db.query('subscriptions').collect(),
      ctx.db.query('tokenUsage').collect(),
      ctx.db.query('toolInvocations').collect(),
      ctx.db.query('dailyUsage').collect(),
      ctx.db.query('sessionTransferTokens').collect(),
      ctx.db.query('projects').collect(),
      ctx.db.query('skills').collect(),
      ctx.db.query('conversations').collect(),
      ctx.db.query('conversationMessages').collect(),
      ctx.db.query('notes').collect(),
      ctx.db.query('memories').collect(),
      ctx.db.query('knowledgeChunks').collect(),
      ctx.db.query('knowledgeChunkEmbeddings').take(1),
      ctx.db.query('outputs').collect(),
      ctx.db.query('files').collect(),
    ])

    const tableCounts = {
      subscriptions: subscriptions.length,
      tokenUsage: tokenUsage.length,
      toolInvocations: toolInvocations.length,
      dailyUsage: dailyUsage.length,
      sessionTransferTokens: sessionTransferTokens.length,
      projects: projects.length,
      skills: skills.length,
      conversations: conversations.length,
      conversationMessages: conversationMessages.length,
      notes: notes.length,
      memories: memories.length,
      knowledgeChunks: knowledgeChunks.length,
      knowledgeChunkEmbeddings: knowledgeChunks.length,
      outputs: outputs.length,
      files: files.length,
    }

    const storageByUser = new Map<string, { fileBytes: number; outputBytes: number; fileCount: number; outputCount: number }>()
    for (const file of files) {
      if (file.type !== 'file') continue
      const entry = storageByUser.get(file.userId) ?? { fileBytes: 0, outputBytes: 0, fileCount: 0, outputCount: 0 }
      entry.fileBytes += Math.max(0, file.sizeBytes ?? (file.content ? utf8ByteLength(file.content) : 0))
      entry.fileCount += 1
      storageByUser.set(file.userId, entry)
    }
    for (const output of outputs) {
      const entry = storageByUser.get(output.userId) ?? { fileBytes: 0, outputBytes: 0, fileCount: 0, outputCount: 0 }
      entry.outputBytes += Math.max(0, output.sizeBytes ?? 0)
      entry.outputCount += 1
      storageByUser.set(output.userId, entry)
    }

    const topStorageUsers = topEntries(
      [...storageByUser.entries()]
        .map(([userId, entry]) => ({
          userId,
          fileBytes: entry.fileBytes,
          outputBytes: entry.outputBytes,
          totalBytes: entry.fileBytes + entry.outputBytes,
          fileCount: entry.fileCount,
          outputCount: entry.outputCount,
        }))
        .sort((a, b) => b.totalBytes - a.totalBytes),
    )

    const filesById = new Map(files.map((file) => [file._id, file]))
    const chunkCountsByFile = new Map<string, number>()
    for (const chunk of knowledgeChunks) {
      if (chunk.sourceKind !== 'file') continue
      chunkCountsByFile.set(chunk.sourceId, (chunkCountsByFile.get(chunk.sourceId) ?? 0) + 1)
    }
    const topChunkFiles = topEntries(
      [...chunkCountsByFile.entries()]
        .map(([fileId, chunkCount]) => {
          const file = filesById.get(fileId as Id<'files'>)
          return {
            fileId,
            chunkCount,
            fileName: file?.name ?? null,
            userId: file?.userId ?? null,
            duplicateOfFileId: file?.duplicateOfFileId ?? null,
          }
        })
        .sort((a, b) => b.chunkCount - a.chunkCount),
    )

    const duplicateGroups = new Map<string, { userId: string; contentHash: string; fileIds: string[]; names: string[] }>()
    for (const file of files) {
      if (file.type !== 'file' || file.storageId || !file.contentHash) continue
      const key = `${file.userId}:${file.contentHash}`
      const group = duplicateGroups.get(key) ?? { userId: file.userId, contentHash: file.contentHash, fileIds: [], names: [] }
      group.fileIds.push(file._id)
      group.names.push(file.name)
      duplicateGroups.set(key, group)
    }
    const duplicateHashes = topEntries(
      [...duplicateGroups.values()]
        .filter((group) => group.fileIds.length > 1)
        .map((group) => ({
          userId: group.userId,
          contentHash: group.contentHash,
          count: group.fileIds.length,
          fileIds: group.fileIds,
          names: group.names,
        }))
        .sort((a, b) => b.count - a.count),
    )

    const nonEmptyTables = Object.entries(tableCounts)
      .filter(([, count]) => count > 0)
      .map(([tableName]) => tableName)

    return {
      totalTables: Object.keys(tableCounts).length,
      nonEmptyTablesCount: nonEmptyTables.length,
      nonEmptyTables,
      tableCounts,
      assumptions: {
        knowledgeChunkEmbeddingsCountDerivedFromKnowledgeChunks: sampledKnowledgeChunkEmbeddings.length > 0,
      },
      totals: {
        inlineFileBytes: files.reduce((sum, file) => sum + (file.type === 'file' && !file.storageId ? Math.max(0, file.sizeBytes ?? (file.content ? utf8ByteLength(file.content) : 0)) : 0), 0),
        outputBytes: outputs.reduce((sum, output) => sum + Math.max(0, output.sizeBytes ?? 0), 0),
        knowledgeChunks: knowledgeChunks.length,
        knowledgeChunkEmbeddings: knowledgeChunks.length,
      },
      topStorageUsers,
      topChunkFiles,
      duplicateHashes,
    }
  },
})

export const getBackfillSnapshotInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [files, outputs, subscriptions] = await Promise.all([
      ctx.db.query('files').collect(),
      ctx.db.query('outputs').collect(),
      ctx.db.query('subscriptions').collect(),
    ])
    return {
      files: files.map((file) => ({
        _id: file._id,
        _creationTime: file._creationTime,
        userId: file.userId,
        name: file.name,
        type: file.type,
        content: file.content,
        storageId: file.storageId,
        sizeBytes: file.sizeBytes,
        contentHash: file.contentHash,
        duplicateOfFileId: file.duplicateOfFileId,
      })),
      outputs: outputs.map((output) => ({
        _id: output._id,
        _creationTime: output._creationTime,
        userId: output.userId,
        type: output.type,
        storageId: output.storageId,
        sizeBytes: output.sizeBytes,
      })),
      subscriptions: subscriptions.map((subscription) => ({
        _id: subscription._id,
        _creationTime: subscription._creationTime,
        userId: subscription.userId,
        currentPeriodStart: subscription.currentPeriodStart,
      })),
    }
  },
})

export const getFileStorageUrlInternal = internalQuery({
  args: { fileId: v.id('files') },
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get(fileId)
    if (!file?.storageId) return null
    return await ctx.storage.getUrl(file.storageId)
  },
})

export const getOutputStorageUrlInternal = internalQuery({
  args: { outputId: v.id('outputs') },
  handler: async (ctx, { outputId }) => {
    const output = await ctx.db.get(outputId)
    if (!output?.storageId) return null
    return await ctx.storage.getUrl(output.storageId)
  },
})

export const applyBackfillBatchInternal = internalMutation({
  args: {
    filePatches: v.array(v.object({
      fileId: v.id('files'),
      sizeBytes: v.number(),
      contentHash: v.optional(v.string()),
      duplicateOfFileId: v.union(v.id('files'), v.null()),
    })),
    outputPatches: v.array(v.object({
      outputId: v.id('outputs'),
      sizeBytes: v.number(),
    })),
    userStorageTotals: v.array(v.object({
      userId: v.string(),
      bytesUsed: v.number(),
    })),
  },
  handler: async (ctx, { filePatches, outputPatches, userStorageTotals }) => {
    await Promise.all(filePatches.map((patch) => ctx.db.patch(patch.fileId, {
      sizeBytes: patch.sizeBytes,
      contentHash: patch.contentHash,
      duplicateOfFileId: patch.duplicateOfFileId ?? undefined,
    })))

    await Promise.all(outputPatches.map((patch) => ctx.db.patch(patch.outputId, { sizeBytes: patch.sizeBytes })))

    const subscriptions = await Promise.all(userStorageTotals.map((usage) =>
      getOrCreateSubscription(ctx, usage.userId)))
    await Promise.all(userStorageTotals.map((usage, i) => ctx.db.patch(subscriptions[i]!._id, {
      overlayStorageBytesUsed: Math.max(0, usage.bytesUsed),
    })))

    return {
      filePatchesApplied: filePatches.length,
      outputPatchesApplied: outputPatches.length,
      subscriptionsUpdated: userStorageTotals.length,
    }
  },
})

export const listCanonicalFileIdsForReindexInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const files = await ctx.db.query('files').collect()
    return files
      .filter((file) => file.type === 'file' && !file.storageId && !file.duplicateOfFileId)
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((file) => file._id)
  },
})

export const backfillStorageUsageByServer = action({
  args: { serverSecret: v.string() },
  handler: async (ctx, { serverSecret }) => {
    requireServerSecret(serverSecret)

    const snapshot = await ctx.runQuery(internal.files.storageAdmin.getBackfillSnapshotInternal, {})
    const files = [...snapshot.files].sort((a, b) => a._creationTime - b._creationTime) as BackfillFileRow[]
    const outputs = [...snapshot.outputs].sort((a, b) => a._creationTime - b._creationTime) as BackfillOutputRow[]
    const existingSubscriptions = snapshot.subscriptions as BackfillSubscriptionRow[]

    const filePatches: Array<{
      fileId: Id<'files'>
      sizeBytes: number
      contentHash?: string
      duplicateOfFileId: Id<'files'> | null
    }> = []
    const outputPatches: Array<{ outputId: Id<'outputs'>; sizeBytes: number }> = []
    const duplicateFileIdsToPurge = new Set<Id<'files'>>()
    const canonicalByHash = new Map<string, Id<'files'>>()
    const measurementFailures: Array<{ kind: 'file' | 'output'; id: string; error: string }> = []
    const userStorageTotals = new Map<string, number>()

    const measuredFiles = await Promise.all(files.map(async (file) => {
      let sizeBytes = 0
      if (file.type === 'file') {
        if (file.storageId) {
          if (file.sizeBytes && file.sizeBytes > 0) {
            sizeBytes = Math.max(0, file.sizeBytes)
          } else {
            try {
              const url = await ctx.runQuery(internal.files.storageAdmin.getFileStorageUrlInternal, { fileId: file._id })
              sizeBytes = url ? await measureRemoteSize(url) : 0
            } catch (error) {
              measurementFailures.push({ kind: 'file', id: file._id, error: error instanceof Error ? error.message : String(error) })
            }
          }
        } else {
          sizeBytes = utf8ByteLength(file.content ?? '')
        }
      }

      let contentHash: string | undefined
      if (file.type === 'file' && !file.storageId && (file.content ?? '').trim().length > 0) {
        contentHash = await sha256Hex(file.content ?? '')
      }
      return { file, sizeBytes, contentHash }
    }))

    for (const { file, sizeBytes, contentHash } of measuredFiles) {
      let duplicateOfFileId: Id<'files'> | null = null
      if (file.type === 'file' && !file.storageId && contentHash) {
        const canonicalKey = `${file.userId}:${contentHash}`
        const canonicalFileId = canonicalByHash.get(canonicalKey)
        if (canonicalFileId) {
          duplicateOfFileId = canonicalFileId
          duplicateFileIdsToPurge.add(file._id)
        } else {
          canonicalByHash.set(canonicalKey, file._id)
        }
      }

      if (
        sizeBytes !== Math.max(0, file.sizeBytes ?? 0) ||
        (contentHash ?? undefined) !== (file.contentHash ?? undefined) ||
        duplicateOfFileId !== (file.duplicateOfFileId ?? null)
      ) {
        filePatches.push({
          fileId: file._id,
          sizeBytes,
          contentHash,
          duplicateOfFileId,
        })
      }

      if (file.type === 'file') {
        userStorageTotals.set(file.userId, (userStorageTotals.get(file.userId) ?? 0) + sizeBytes)
      }
    }

    const measuredOutputs = await Promise.all(outputs.map(async (output) => {
      let sizeBytes = Math.max(0, output.sizeBytes ?? 0)
      if (output.storageId && sizeBytes <= 0) {
        try {
          const url = await ctx.runQuery(internal.files.storageAdmin.getOutputStorageUrlInternal, { outputId: output._id })
          sizeBytes = url ? await measureRemoteSize(url) : 0
        } catch (error) {
          measurementFailures.push({ kind: 'output', id: output._id, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { output, sizeBytes }
    }))
    for (const { output, sizeBytes } of measuredOutputs) {
      if (sizeBytes !== Math.max(0, output.sizeBytes ?? 0)) {
        outputPatches.push({ outputId: output._id, sizeBytes })
      }
      userStorageTotals.set(output.userId, (userStorageTotals.get(output.userId) ?? 0) + sizeBytes)
    }

    const allUsers = new Set<string>([
      ...existingSubscriptions.map((subscription) => subscription.userId),
      ...userStorageTotals.keys(),
    ])

    const userStorageTotalRows = [...allUsers]
      .sort()
      .map((userId) => ({
        userId,
        bytesUsed: Math.max(0, userStorageTotals.get(userId) ?? 0),
      }))

    const batchSize = 100
    let filePatchesApplied = 0
    let outputPatchesApplied = 0
    let subscriptionsUpdated = 0

    const totalBatches = Math.ceil(Math.max(filePatches.length, outputPatches.length, userStorageTotalRows.length) / batchSize)
    const batchResults = await Promise.all(Array.from({ length: totalBatches }, (_, i) => {
      const start = i * batchSize
      return ctx.runMutation(internal.files.storageAdmin.applyBackfillBatchInternal, {
        filePatches: filePatches.slice(start, start + batchSize),
        outputPatches: outputPatches.slice(start, start + batchSize),
        userStorageTotals: userStorageTotalRows.slice(start, start + batchSize),
      })
    }))
    for (const result of batchResults) {
      filePatchesApplied += result.filePatchesApplied
      outputPatchesApplied += result.outputPatchesApplied
      subscriptionsUpdated += result.subscriptionsUpdated
    }

    let duplicateKnowledgePurged = 0
    await Promise.all([...duplicateFileIdsToPurge].map((fileId) =>
      ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'file',
        sourceId: fileId,
      })))
    duplicateKnowledgePurged = duplicateFileIdsToPurge.size

    return {
      filesInspected: files.length,
      outputsInspected: outputs.length,
      subscriptionsInspected: existingSubscriptions.length,
      filePatchesApplied,
      outputPatchesApplied,
      duplicateKnowledgePurged,
      subscriptionsUpdated,
      measurementFailures,
    }
  },
})

export const getTotalStorageBytesUsedByServer = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, { serverSecret }) => {
    requireServerSecret(serverSecret)
    const subscriptions = await ctx.db.query('subscriptions').collect()
    const total = subscriptions.reduce((sum, sub) => sum + Math.max(0, sub.overlayStorageBytesUsed ?? 0), 0)
    console.log(`[R2-Budget] getTotalStorageBytesUsedByServer: total=${total} across ${subscriptions.length} subscriptions`)
    return total
  },
})

export const reindexAllCanonicalFilesByServer = action({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { serverSecret, limit }): Promise<{ totalCanonicalFiles: number; reindexed: number }> => {
    requireServerSecret(serverSecret)
    const fileIds = await ctx.runQuery(internal.files.storageAdmin.listCanonicalFileIdsForReindexInternal, {}) as Id<'files'>[]
    const capped = fileIds.slice(0, limit ? Math.max(0, limit) : undefined)
    await Promise.all(capped.map((fileId) =>
      ctx.runAction(internal.knowledge.knowledge.reindexFileInternal, { fileId })))
    return {
      totalCanonicalFiles: fileIds.length,
      reindexed: capped.length,
    }
  },
})
