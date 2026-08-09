import { v } from 'convex/values'
import { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { selectNoteClientIdCandidate } from '../../src/shared/knowledge/note-client-id'
import { mutation, query, type MutationCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import {
  applyStorageUsageDelta,
  ensureStorageAvailable,
  getOrCreateSubscription,
  getStorageBytesUsed,
  getStorageLimitForSubscription,
} from './lib/storageQuota'
import { assertOwnedFileR2Key, isOwnedFileR2Key, isOwnedOutputR2Key } from '../../src/shared/storage/storage-keys'

const utf8Encoder = new TextEncoder()

type FileKind = 'folder' | 'note' | 'upload' | 'output'
type MutationDb = MutationCtx['db']
const UPLOAD_INTENT_FINALIZE_GRACE_MS = 15 * 60_000
const FILE_PREVIEW_CHARS = 1200

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length
}

function buildProxyUrl(fileId: Id<'files'>): string {
  return `/api/v1/files/${fileId}/content`
}

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) return
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

function requireServerAccess(serverSecret: string) {
  if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
}

function extensionOf(name: string): string | undefined {
  const clean = name.trim()
  const dot = clean.lastIndexOf('.')
  if (dot <= 0 || dot === clean.length - 1) return undefined
  return clean.slice(dot + 1).toLowerCase()
}

function inferKind(file: Partial<Doc<'files'>>): FileKind {
  if (file.kind) return file.kind as FileKind
  return file.type === 'folder' ? 'folder' : 'upload'
}

function textOf(file: Partial<Doc<'files'>>): string {
  return file.textContent ?? file.content ?? ''
}

function isTextIndexable(kind: FileKind, text: string): boolean {
  if (kind === 'folder') return false
  return text.trim().length > 0
}

function normalizeFile(file: Doc<'files'>) {
  const kind = inferKind(file)
  const text = textOf(file)
  const blobBacked = Boolean(file.storageId ?? file.r2Key)
  const hasInlineText = Boolean(text.trim())
  const storageBackedForDownload = blobBacked && !hasInlineText
  return {
    _id: file._id,
    userId: file.userId,
    clientId: file.clientId,
    name: file.name,
    type: file.type,
    kind,
    parentId: file.parentId ?? null,
    content: storageBackedForDownload ? buildProxyUrl(file._id) : text,
    textContent: text,
    storageId: file.storageId ?? null,
    r2Key: file.r2Key ?? null,
    mimeType: file.mimeType,
    extension: file.extension ?? extensionOf(file.name),
    sizeBytes: file.sizeBytes ?? (text ? utf8ByteLength(text) : 0),
    contentHash: file.contentHash,
    duplicateOfFileId: file.duplicateOfFileId,
    indexable: file.indexable ?? isTextIndexable(kind, text),
    indexStatus: file.indexStatus ?? (isTextIndexable(kind, text) ? 'pending' : 'skipped'),
    indexedAt: file.indexedAt,
    indexError: file.indexError,
    isStorageBacked: storageBackedForDownload,
    downloadUrl: storageBackedForDownload ? buildProxyUrl(file._id) : undefined,
    conversationId: file.conversationId,
    turnId: file.turnId,
    modelId: file.modelId,
    prompt: file.prompt,
    outputType: file.outputType,
    outputSource: file.outputSource,
    outputStatus: file.outputStatus,
    outputUrl: file.outputUrl,
    outputMetadata: file.outputMetadata,
    outputErrorMessage: file.outputErrorMessage,
    outputCompletedAt: file.outputCompletedAt,
    expiresAt: file.expiresAt,
    legacyNoteId: file.legacyNoteId,
    legacyOutputId: file.legacyOutputId,
    projectId: file.projectId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    deletedAt: file.deletedAt,
  }
}

function previewTextOf(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, FILE_PREVIEW_CHARS)
}

function normalizeFileSummary(file: Doc<'files'>) {
  const {
    content: _content,
    textContent: _textContent,
    ...normalized
  } = normalizeFile(file)
  void _content
  void _textContent
  return {
    ...normalized,
    previewText: inferKind(file) === 'note' ? previewTextOf(textOf(file)) : undefined,
  }
}

type FilesCtxLike = {
  db: {
    query: (table: 'files') => {
      withIndex: (
        index: string,
        cb: (q: { eq: (field: string, value: unknown) => { eq: (field: string, value: unknown) => unknown } }) => unknown,
      ) => { collect: () => Promise<Doc<'files'>[]> }
    }
    patch: (id: Id<'files'>, value: Partial<Doc<'files'>>) => Promise<void>
  }
}

async function findCanonicalDuplicate(
  ctx: FilesCtxLike,
  userId: string,
  contentHash: string | undefined,
  ignoreFileId?: Id<'files'>,
): Promise<Doc<'files'> | null> {
  if (!contentHash) return null
  const matches = await ctx.db
    .query('files')
    .withIndex('by_userId_contentHash', (q) => q.eq('userId', userId).eq('contentHash', contentHash))
    .collect()

  for (const match of matches) {
    if (ignoreFileId && match._id === ignoreFileId) continue
    if (match.duplicateOfFileId) continue
    if (match.deletedAt) continue
    return match
  }
  return null
}

async function maybePromoteDuplicate(
  ctx: FilesCtxLike,
  userId: string,
  canonicalFileId: Id<'files'>,
): Promise<Id<'files'> | null> {
  const duplicates = await ctx.db
    .query('files')
    .withIndex('by_duplicateOfFileId', (q) => q.eq('duplicateOfFileId', canonicalFileId))
    .collect()
  const promoted = duplicates.find((candidate) => candidate.userId === userId && !candidate.deletedAt)
  if (!promoted) return null
  await ctx.db.patch(promoted._id, { duplicateOfFileId: undefined, indexStatus: 'pending' })
  for (const duplicate of duplicates) {
    if (duplicate._id === promoted._id || duplicate.userId !== userId || duplicate.deletedAt) continue
    await ctx.db.patch(duplicate._id, { duplicateOfFileId: promoted._id, updatedAt: Date.now() })
  }
  return promoted._id
}

function shouldCountStorage(kind: FileKind, type: 'file' | 'folder', sizeBytes: number): boolean {
  return type === 'file' && kind !== 'output' && sizeBytes > 0
}

function validStorageKeyForKind(userId: string, kind: FileKind, r2Key: string): boolean {
  return kind === 'output' ? isOwnedOutputR2Key(userId, r2Key) : isOwnedFileR2Key(userId, r2Key)
}

async function assertParentAndProject(ctx: { db: { get: (id: Id<'files'> | Id<'projects'>) => Promise<unknown> } }, args: {
  fileId?: Id<'files'>
  userId: string
  parentId?: string
  projectId?: string
}) {
  if (args.parentId) {
    const parent = await ctx.db.get(args.parentId as Id<'files'>) as Doc<'files'> | null
    if (!parent || parent.userId !== args.userId || parent.deletedAt || inferKind(parent) !== 'folder') {
      throw new Error('Unauthorized')
    }
    const seen = new Set<string>(args.fileId ? [args.fileId] : [])
    let cursor: Doc<'files'> | null = parent
    while (cursor) {
      if (seen.has(cursor._id)) throw new Error('File parent cycle detected')
      seen.add(cursor._id)
      cursor = cursor.parentId
        ? await ctx.db.get(cursor.parentId as Id<'files'>) as Doc<'files'> | null
        : null
      if (cursor && (cursor.userId !== args.userId || cursor.deletedAt)) {
        throw new Error('Unauthorized')
      }
    }
  }
  if (args.projectId) {
    const project = await ctx.db.get(args.projectId as Id<'projects'>) as Doc<'projects'> | null
    if (!project || project.userId !== args.userId || project.deletedAt) {
      throw new Error('Unauthorized')
    }
  }
}

async function getPendingUploadIntentBytes(ctx: { db: MutationDb }, userId: string): Promise<number> {
  const pending = await ctx.db
    .query('r2UploadIntents')
    .withIndex('by_userId_status_expiresAt', (q) => q.eq('userId', userId).eq('status', 'pending'))
    .collect()
  return pending.reduce((sum, intent) => sum + Math.max(0, intent.declaredSizeBytes), 0)
}

// ─── R2 Upload Intents ───────────────────────────────────────────────────────

export const createUploadIntentByServer = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
    r2Key: v.string(),
    declaredSizeBytes: v.number(),
    mimeType: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireServerAccess(args.serverSecret)
    assertOwnedFileR2Key(args.userId, args.r2Key)
    const declaredSizeBytes = Math.round(args.declaredSizeBytes)
    if (!Number.isFinite(declaredSizeBytes) || declaredSizeBytes <= 0) {
      throw new Error('invalid_upload_intent_size')
    }

    const existing = await ctx.db
      .query('r2UploadIntents')
      .withIndex('by_r2Key', (q) => q.eq('r2Key', args.r2Key))
      .first()
    if (existing) {
      throw new Error('upload_intent_already_exists')
    }

    const subscription = await getOrCreateSubscription(ctx, args.userId)
    const pendingBytes = await getPendingUploadIntentBytes(ctx, args.userId)
    const nextReservedBytes = getStorageBytesUsed(subscription) + pendingBytes + declaredSizeBytes
    const storageLimitBytes = getStorageLimitForSubscription(subscription)
    if (nextReservedBytes > storageLimitBytes) {
      throw new Error(`storage_limit_exceeded:${nextReservedBytes}:${storageLimitBytes}`)
    }

    return await ctx.db.insert('r2UploadIntents', {
      userId: args.userId,
      r2Key: args.r2Key,
      declaredSizeBytes,
      mimeType: args.mimeType,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    })
  },
})

export const getUploadIntentByServer = query({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
    r2Key: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      _id: v.id('r2UploadIntents'),
      declaredSizeBytes: v.number(),
      mimeType: v.optional(v.string()),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    requireServerAccess(args.serverSecret)
    assertOwnedFileR2Key(args.userId, args.r2Key)
    const intent = await ctx.db
      .query('r2UploadIntents')
      .withIndex('by_r2Key', (q) => q.eq('r2Key', args.r2Key))
      .first()
    if (!intent || intent.userId !== args.userId || intent.status !== 'pending') return null
    if (args.now > intent.expiresAt + UPLOAD_INTENT_FINALIZE_GRACE_MS) return null
    return {
      _id: intent._id,
      declaredSizeBytes: intent.declaredSizeBytes,
      mimeType: intent.mimeType,
      expiresAt: intent.expiresAt,
    }
  },
})

export const finalizeUploadIntentByServer = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
    r2Key: v.string(),
    actualSizeBytes: v.number(),
    fileId: v.optional(v.id('files')),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerAccess(args.serverSecret)
    assertOwnedFileR2Key(args.userId, args.r2Key)
    const intent = await ctx.db
      .query('r2UploadIntents')
      .withIndex('by_r2Key', (q) => q.eq('r2Key', args.r2Key))
      .first()
    if (!intent || intent.userId !== args.userId || intent.status !== 'pending') {
      throw new Error('upload_intent_not_found')
    }
    const actualSizeBytes = Math.max(0, Math.round(args.actualSizeBytes))
    if (actualSizeBytes > intent.declaredSizeBytes) {
      throw new Error('upload_size_exceeds_intent')
    }
    const patch: Partial<Doc<'r2UploadIntents'>> = {
      status: 'finalized',
      actualSizeBytes,
      finalizedAt: args.now,
    }
    if (args.fileId) patch.fileId = args.fileId
    await ctx.db.patch(intent._id, patch)
    return null
  },
})

export const listExpiredUploadIntentsByServer = query({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id('r2UploadIntents'),
    r2Key: v.string(),
  })),
  handler: async (ctx, args) => {
    requireServerAccess(args.serverSecret)
    const limit = Math.max(1, Math.min(100, Math.round(args.limit ?? 25)))
    const rows = await ctx.db
      .query('r2UploadIntents')
      .withIndex('by_userId_status_expiresAt', (q) =>
        q.eq('userId', args.userId).eq('status', 'pending').lt('expiresAt', args.now - UPLOAD_INTENT_FINALIZE_GRACE_MS)
      )
      .take(limit)
    return rows.map((row) => ({ _id: row._id, r2Key: row.r2Key }))
  },
})

export const expireUploadIntentsByServer = mutation({
  args: {
    userId: v.string(),
    serverSecret: v.string(),
    intentIds: v.array(v.id('r2UploadIntents')),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerAccess(args.serverSecret)
    for (const intentId of args.intentIds) {
      const intent = await ctx.db.get(intentId)
      if (!intent || intent.userId !== args.userId || intent.status !== 'pending') continue
      await ctx.db.patch(intentId, {
        status: 'expired',
        expiredAt: args.now,
      })
    }
    return null
  },
})

// ─── Queries ──────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    projectId: v.optional(v.string()),
    parentId: v.optional(v.union(v.string(), v.null())),
    conversationId: v.optional(v.string()),
    outputType: v.optional(v.string()),
    kind: v.optional(v.union(
      v.literal('folder'),
      v.literal('note'),
      v.literal('upload'),
      v.literal('output'),
    )),
    summary: v.optional(v.boolean()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, {
    userId,
    workspaceId,
    accessToken,
    serverSecret,
    projectId,
    parentId,
    conversationId,
    outputType,
    kind,
    summary,
    includeDeleted,
  }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const allFiles = await ctx.db
      .query('files')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()

    const filteredFiles = allFiles
      .filter((file) => (includeDeleted ? true : !file.deletedAt))
      .filter((file) => (projectId !== undefined ? file.projectId === projectId : true))
      .filter((file) => (parentId !== undefined ? (file.parentId ?? null) === parentId : true))
      .filter((file) => (conversationId !== undefined ? file.conversationId === conversationId : true))
      .filter((file) => (outputType !== undefined ? file.outputType === outputType : true))
      .filter((file) => (kind !== undefined ? inferKind(file) === kind : true))
      .filter((file) => (workspaceId !== undefined ? file.workspaceId === workspaceId : true))

    return summary
      ? filteredFiles.map(normalizeFileSummary)
      : filteredFiles.map(normalizeFile)
  },
})

export const get = query({
  args: {
    fileId: v.id('files'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, { fileId, userId, workspaceId, accessToken, serverSecret, includeDeleted }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const file = await ctx.db.get(fileId)
    if (!file || file.userId !== userId || (workspaceId !== undefined && file.workspaceId !== workspaceId)) return null
    if (file.deletedAt && !includeDeleted) return null
    return normalizeFile(file)
  },
})

export const getByLegacyNoteId = query({
  args: {
    noteId: v.id('notes'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { noteId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const file = await ctx.db
      .query('files')
      .withIndex('by_legacyNoteId', (q) => q.eq('legacyNoteId', noteId))
      .first()
    return file && file.userId === userId && !file.deletedAt ? normalizeFile(file) : null
  },
})

export const getByLegacyOutputId = query({
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
    const file = await ctx.db
      .query('files')
      .withIndex('by_legacyOutputId', (q) => q.eq('legacyOutputId', outputId))
      .first()
    return file && file.userId === userId && !file.deletedAt ? normalizeFile(file) : null
  },
})

export const getStorageUrlForProxy = query({
  args: {
    fileId: v.id('files'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { fileId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const file = await ctx.db.get(fileId)
    if (!file || file.userId !== userId || file.deletedAt) return null
    if (file.r2Key) {
      if (!validStorageKeyForKind(userId, inferKind(file), file.r2Key)) return null
      return {
        r2Key: file.r2Key,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes ?? 0,
      }
    }
    if (file.storageId) {
      const url = await ctx.storage.getUrl(file.storageId)
      if (!url) return null
      return {
        url,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes ?? 0,
      }
    }
    return null
  },
})

export const getR2KeysForSubtree = query({
  args: {
    fileId: v.id('files'),
    userId: v.string(),
    serverSecret: v.optional(v.string()),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, { fileId, userId, serverSecret, accessToken }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const root = await ctx.db.get(fileId)
    if (!root || root.userId !== userId) return []
    const results: Array<{ fileId: Id<'files'>; r2Key?: string; storageId?: string; kind: FileKind }> = []
    async function collectSubtree(id: Id<'files'>) {
      const children = await ctx.db
        .query('files')
        .withIndex('by_parentId', (q) => q.eq('parentId', id as string))
        .collect()
      for (const child of children) {
        if (child.userId !== userId || child.deletedAt) continue
        await collectSubtree(child._id)
      }
      const file = await ctx.db.get(id)
      if (file && !file.deletedAt) {
        results.push({
          fileId: id,
          r2Key: file.r2Key,
          storageId: file.storageId as string | undefined,
          kind: inferKind(file),
        })
      }
    }
    await collectSubtree(fileId)
    return results
  },
})

// ─── Mutations ────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    clientId: v.optional(v.string()),
    name: v.string(),
    type: v.optional(v.union(v.literal('file'), v.literal('folder'))),
    kind: v.optional(v.union(
      v.literal('folder'),
      v.literal('note'),
      v.literal('upload'),
      v.literal('output'),
    )),
    parentId: v.optional(v.string()),
    content: v.optional(v.string()),
    textContent: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    projectId: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    sizeBytes: v.optional(v.number()),
    sizeBytesOverride: v.optional(v.number()),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    prompt: v.optional(v.string()),
    outputType: v.optional(v.string()),
    outputSource: v.optional(v.union(
      v.literal('image_generation'),
      v.literal('video_generation'),
      v.literal('browser'),
      v.literal('sandbox'),
    )),
    outputStatus: v.optional(v.union(
      v.literal('pending'),
      v.literal('completed'),
      v.literal('failed'),
    )),
    outputUrl: v.optional(v.string()),
    outputMetadata: v.optional(v.any()),
    outputErrorMessage: v.optional(v.string()),
    outputCompletedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    legacyNoteId: v.optional(v.id('notes')),
    legacyOutputId: v.optional(v.id('outputs')),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const kind = args.kind ?? (args.type === 'folder' ? 'folder' : 'upload')
    const type = kind === 'folder' ? 'folder' : 'file'
    if (args.r2Key) {
      if (kind === 'output') {
        if (!isOwnedOutputR2Key(args.userId, args.r2Key)) throw new Error('Invalid storage key')
      } else {
        assertOwnedFileR2Key(args.userId, args.r2Key)
      }
    }
    await assertParentAndProject(ctx, args)
    const now = Date.now()
    const textContent = args.textContent ?? args.content ?? ''
    const textBytes = type === 'file' ? utf8ByteLength(textContent) : 0
    const explicitSize = args.sizeBytesOverride ?? args.sizeBytes ?? 0
    const sizeBytes = type === 'file' ? Math.max(textBytes, explicitSize) : 0
    const clientId = args.clientId?.trim() || undefined
    if (kind === 'note' && clientId) {
      const exactCandidate = await ctx.db
        .query('files')
        .withIndex('by_userId_clientId', (q) =>
          q.eq('userId', args.userId).eq('clientId', clientId),
        )
        .first()
      const candidates = exactCandidate
        ? [exactCandidate]
        : await ctx.db
            .query('files')
            .withIndex('by_userId', (q) => q.eq('userId', args.userId))
            .collect()
      const existingNote = selectNoteClientIdCandidate(candidates, {
        clientId,
        title: args.name,
        contentHash: args.contentHash,
      })

      if (existingNote) {
        const previousText = textOf(existingNote)
        const previousSize = existingNote.deletedAt
          ? 0
          : (existingNote.sizeBytes ?? utf8ByteLength(previousText))
        const storageDelta = sizeBytes - previousSize
        if (storageDelta > 0) await ensureStorageAvailable(ctx as never, args.userId, storageDelta)
        const canonicalDuplicate = args.contentHash
          ? await findCanonicalDuplicate(
              ctx as never,
              args.userId,
              args.contentHash,
              existingNote._id,
            )
          : null
        const indexable = isTextIndexable(kind, textContent)
        const contentChanged = previousText !== textContent || Boolean(existingNote.deletedAt)
        await ctx.db.patch(existingNote._id, {
          clientId,
          name: args.name,
          content: textContent,
          textContent: undefined,
          sizeBytes,
          contentHash: args.contentHash,
          duplicateOfFileId: canonicalDuplicate?._id,
          indexable,
          indexStatus: indexable && !canonicalDuplicate ? 'pending' : 'skipped',
          indexError: undefined,
          projectId: args.projectId,
          deletedAt: undefined,
          updatedAt: args.updatedAt ?? now,
        })
        if (storageDelta !== 0) {
          await applyStorageUsageDelta(ctx as never, args.userId, storageDelta)
        }
        if (contentChanged) {
          await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
            sourceKind: 'file',
            sourceId: existingNote._id,
            userId: args.userId,
          })
          if (indexable && !canonicalDuplicate) {
            await ctx.scheduler.runAfter(
              0,
              internal.knowledge.knowledge.reindexFileInternal,
              { fileId: existingNote._id },
            )
          }
        }
        return existingNote._id
      }
    }
    if (shouldCountStorage(kind, type, sizeBytes)) {
      await ensureStorageAvailable(ctx as never, args.userId, sizeBytes)
    }
    const indexable = isTextIndexable(kind, textContent)
    const canonicalDuplicate =
      type === 'file' && indexable && args.contentHash
        ? await findCanonicalDuplicate(ctx as never, args.userId, args.contentHash)
        : null
    const id = await ctx.db.insert('files', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      clientId,
      name: args.name,
      type,
      kind,
      parentId: args.parentId,
      content: textContent,
      storageId: args.storageId,
      r2Key: args.r2Key,
      mimeType: args.mimeType,
      extension: args.extension ?? extensionOf(args.name),
      sizeBytes,
      contentHash: args.contentHash,
      duplicateOfFileId: canonicalDuplicate?._id,
      indexable,
      indexStatus: indexable && !canonicalDuplicate ? 'pending' : 'skipped',
      conversationId: args.conversationId,
      turnId: args.turnId,
      modelId: args.modelId,
      prompt: args.prompt,
      outputType: args.outputType,
      outputSource: args.outputSource,
      outputStatus: args.outputStatus,
      outputUrl: args.outputUrl,
      outputMetadata: args.outputMetadata,
      outputErrorMessage: args.outputErrorMessage,
      outputCompletedAt: args.outputCompletedAt,
      expiresAt: args.expiresAt,
      legacyNoteId: args.legacyNoteId,
      legacyOutputId: args.legacyOutputId,
      projectId: args.projectId,
      createdAt: args.createdAt ?? now,
      updatedAt: args.updatedAt ?? now,
    })
    if (shouldCountStorage(kind, type, sizeBytes)) {
      await applyStorageUsageDelta(ctx as never, args.userId, sizeBytes)
    }
    if (indexable && !canonicalDuplicate) {
      await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId: id })
    }
    return id
  },
})

export const createWithStorage = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.string(),
    parentId: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    r2Key: v.optional(v.string()),
    sizeBytes: v.number(),
    projectId: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.storageId) {
      throw new Error('Convex file storage is deprecated; upload to R2 and pass r2Key only')
    }
    if (!args.r2Key) throw new Error('createWithStorage requires r2Key')
    await authorizeUserAccess(args)
    assertOwnedFileR2Key(args.userId, args.r2Key)
    await assertParentAndProject(ctx, args)
    await ensureStorageAvailable(ctx as never, args.userId, args.sizeBytes)
    const now = Date.now()
    const id = await ctx.db.insert('files', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      name: args.name,
      type: 'file',
      kind: 'upload',
      parentId: args.parentId,
      r2Key: args.r2Key,
      mimeType: args.mimeType,
      extension: args.extension ?? extensionOf(args.name),
      sizeBytes: args.sizeBytes,
      indexable: false,
      indexStatus: 'skipped',
      projectId: args.projectId,
      createdAt: now,
      updatedAt: now,
    })
    await applyStorageUsageDelta(ctx as never, args.userId, args.sizeBytes)
    return id
  },
})

export const createExtractedDocument = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    r2Key: v.string(),
    mimeType: v.string(),
    sourceSizeBytes: v.number(),
    parentId: v.optional(v.string()),
    projectId: v.optional(v.string()),
    parts: v.array(v.object({
      name: v.string(),
      content: v.string(),
      contentHash: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    assertOwnedFileR2Key(args.userId, args.r2Key)
    await assertParentAndProject(ctx, args)
    if (args.parts.length === 0) throw new Error('Extracted document requires at least one part')

    const totalBytes = args.parts.reduce((total, part, index) => (
      total + (index === 0
        ? Math.max(utf8ByteLength(part.content), args.sourceSizeBytes)
        : utf8ByteLength(part.content))
    ), 0)
    await ensureStorageAvailable(ctx as never, args.userId, totalBytes)

    const ids: Id<'files'>[] = []
    const now = Date.now()
    for (let index = 0; index < args.parts.length; index += 1) {
      const part = args.parts[index]!
      const canonicalDuplicate = await findCanonicalDuplicate(
        ctx as never,
        args.userId,
        part.contentHash,
      )
      const id = await ctx.db.insert('files', {
        userId: args.userId,
        workspaceId: args.workspaceId,
        name: part.name,
        type: 'file',
        kind: 'upload',
        parentId: args.parentId,
        content: part.content,
        r2Key: index === 0 ? args.r2Key : undefined,
        mimeType: index === 0 ? args.mimeType : 'text/plain',
        extension: extensionOf(part.name),
        sizeBytes: index === 0
          ? Math.max(utf8ByteLength(part.content), args.sourceSizeBytes)
          : utf8ByteLength(part.content),
        contentHash: part.contentHash,
        duplicateOfFileId: canonicalDuplicate?._id,
        indexable: true,
        indexStatus: canonicalDuplicate ? 'skipped' : 'pending',
        projectId: args.projectId,
        createdAt: now,
        updatedAt: now,
      })
      ids.push(id)
      if (!canonicalDuplicate) {
        await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId: id })
      }
    }
    await applyStorageUsageDelta(ctx as never, args.userId, totalBytes)
    return ids
  },
})

export const update = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    fileId: v.id('files'),
    name: v.optional(v.string()),
    content: v.optional(v.string()),
    textContent: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    parentId: v.optional(v.union(v.string(), v.null())),
    projectId: v.optional(v.union(v.string(), v.null())),
    indexStatus: v.optional(v.union(
      v.literal('pending'),
      v.literal('indexed'),
      v.literal('skipped'),
      v.literal('failed'),
    )),
    indexError: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    modelId: v.optional(v.string()),
    outputType: v.optional(v.string()),
    outputSource: v.optional(v.union(
      v.literal('image_generation'),
      v.literal('video_generation'),
      v.literal('browser'),
      v.literal('sandbox'),
    )),
    outputStatus: v.optional(v.union(
      v.literal('pending'),
      v.literal('completed'),
      v.literal('failed'),
    )),
    outputUrl: v.optional(v.string()),
    outputMetadata: v.optional(v.any()),
    outputErrorMessage: v.optional(v.string()),
    outputCompletedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    expectedUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, fileId, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const existing = await ctx.db.get(fileId)
    if (!existing || existing.userId !== userId || existing.deletedAt || (workspaceId !== undefined && existing.workspaceId !== workspaceId)) throw new Error('Unauthorized')
    if (updates.expectedUpdatedAt !== undefined && existing.updatedAt !== updates.expectedUpdatedAt) {
      throw new Error('NOTE_REVISION_CONFLICT')
    }
    if (updates.parentId !== undefined || updates.projectId !== undefined) {
      await assertParentAndProject(ctx, {
        fileId,
        userId,
        parentId: updates.parentId === null ? undefined : updates.parentId,
        projectId: updates.projectId === null ? undefined : updates.projectId,
      })
    }

    const kind = inferKind(existing)
    const existingText = textOf(existing)
    const nextText = updates.textContent ?? updates.content
    const blobOnly = (existing.storageId || existing.r2Key) && !existingText.trim()
    if (blobOnly && nextText !== undefined && kind !== 'output') {
      throw new Error('Storage-backed files cannot be edited inline.')
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.name !== undefined) {
      patch.name = updates.name
      patch.extension = extensionOf(updates.name)
    }
    if (updates.parentId !== undefined) patch.parentId = updates.parentId || undefined
    if (updates.projectId !== undefined) patch.projectId = updates.projectId || undefined
    if (updates.indexStatus !== undefined) patch.indexStatus = updates.indexStatus
    if (updates.indexError !== undefined) patch.indexError = updates.indexError
    if (updates.r2Key !== undefined) {
      if (updates.r2Key && !isOwnedOutputR2Key(userId, updates.r2Key)) throw new Error('Invalid storage key')
      patch.r2Key = updates.r2Key || undefined
    }
    if (updates.mimeType !== undefined) patch.mimeType = updates.mimeType
    if (updates.sizeBytes !== undefined) patch.sizeBytes = updates.sizeBytes
    if (updates.modelId !== undefined) patch.modelId = updates.modelId
    if (updates.outputType !== undefined) patch.outputType = updates.outputType
    if (updates.outputSource !== undefined) patch.outputSource = updates.outputSource
    if (updates.outputStatus !== undefined) patch.outputStatus = updates.outputStatus
    if (updates.outputUrl !== undefined) patch.outputUrl = updates.outputUrl
    if (updates.outputMetadata !== undefined) patch.outputMetadata = updates.outputMetadata
    if (updates.outputErrorMessage !== undefined) patch.outputErrorMessage = updates.outputErrorMessage
    if (updates.outputCompletedAt !== undefined) patch.outputCompletedAt = updates.outputCompletedAt
    if (updates.expiresAt !== undefined) patch.expiresAt = updates.expiresAt

    let shouldReindex = false
    let shouldPurge = false
    let storageDelta = 0
    if (updates.sizeBytes !== undefined && nextText === undefined) {
      const previousSizeBytes = existing.sizeBytes ?? 0
      storageDelta = shouldCountStorage(kind, existing.type, updates.sizeBytes)
        ? updates.sizeBytes - previousSizeBytes
        : 0
      if (storageDelta > 0) await ensureStorageAvailable(ctx as never, userId, storageDelta)
    }
    if (nextText !== undefined) {
      const nextSizeBytes = utf8ByteLength(nextText)
      const previousSizeBytes = existing.sizeBytes ?? utf8ByteLength(existingText)
      storageDelta = shouldCountStorage(kind, existing.type, nextSizeBytes)
        ? nextSizeBytes - previousSizeBytes
        : 0
      if (storageDelta > 0) await ensureStorageAvailable(ctx as never, userId, storageDelta)
      const indexable = isTextIndexable(kind, nextText)
      const canonicalDuplicate =
        indexable && updates.contentHash
          ? await findCanonicalDuplicate(ctx as never, userId, updates.contentHash, fileId)
          : null
      patch.content = nextText
      patch.sizeBytes = nextSizeBytes
      patch.contentHash = updates.contentHash
      patch.duplicateOfFileId = canonicalDuplicate?._id
      patch.indexable = indexable
      patch.indexStatus = indexable && !canonicalDuplicate ? 'pending' : 'skipped'
      patch.indexError = undefined
      shouldPurge = true
      shouldReindex = indexable && !canonicalDuplicate
    }
    await ctx.db.patch(fileId, patch)
    if (storageDelta !== 0) await applyStorageUsageDelta(ctx as never, userId, storageDelta)
    if (existing.type === 'file' && shouldPurge) {
      await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
        sourceKind: 'file',
        sourceId: fileId,
        userId,
      })
    }
    if (shouldReindex) {
      await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId })
    }
  },
})

export const remove = mutation({
  args: {
    fileId: v.id('files'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    r2CleanupConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, { fileId, userId, workspaceId, accessToken, serverSecret, r2CleanupConfirmed }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const root = await ctx.db.get(fileId)
    if (!root || root.userId !== userId || root.deletedAt || (workspaceId !== undefined && root.workspaceId !== workspaceId)) throw new Error('Unauthorized')
    const now = Date.now()
    async function deleteSubtree(id: Id<'files'>) {
      const children = await ctx.db
        .query('files')
        .withIndex('by_parentId', (q) => q.eq('parentId', id as string))
        .collect()
      for (const child of children) {
        if (child.userId !== userId || child.deletedAt) continue
        await deleteSubtree(child._id)
      }
      const file = await ctx.db.get(id)
      if (!file || file.deletedAt) return
      let promotedDuplicateId: Id<'files'> | null = null
      if (file.type === 'file' && !file.duplicateOfFileId) {
        promotedDuplicateId = await maybePromoteDuplicate(ctx as never, userId, id)
      }
      if (file.type === 'file') {
        await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, {
          sourceKind: 'file',
          sourceId: id,
          userId,
        })
      }
      if (file.storageId) await ctx.storage.delete(file.storageId)
      const kind = inferKind(file)
      const storageCleanupConfirmed = !file.r2Key || r2CleanupConfirmed === true
      if (storageCleanupConfirmed && shouldCountStorage(kind, file.type, file.sizeBytes ?? 0)) {
        await applyStorageUsageDelta(ctx as never, userId, -(file.sizeBytes ?? 0))
      }
      await ctx.db.patch(id, { deletedAt: now, updatedAt: now, indexStatus: 'skipped' })
      if (promotedDuplicateId) {
        await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId: promotedDuplicateId })
      }
    }
    await deleteSubtree(fileId)
  },
})

// ─── Migration / backfill ─────────────────────────────────────────────────────

export const backfillCanonicalFilesystem = mutation({
  args: {
    serverSecret: v.string(),
    dryRun: v.optional(v.boolean()),
    userId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { serverSecret, dryRun, userId, limit }) => {
    if (!validateServerSecret(serverSecret)) throw new Error('Unauthorized')
    const max = Math.min(5000, Math.max(1, limit ?? 1000))
    const notes = await ctx.db.query('notes').collect()
    const outputs = await ctx.db.query('outputs').collect()
    const existingFiles = await ctx.db.query('files').collect()
    const targetNotes = notes.filter((note) => !userId || note.userId === userId).slice(0, max)
    const targetOutputs = outputs.filter((output) => !userId || output.userId === userId).slice(0, max)
    const targetFiles = existingFiles.filter((file) => !userId || file.userId === userId).slice(0, max)

    const existingNoteIds = new Set(
      existingFiles.flatMap((file) => file.legacyNoteId ? [String(file.legacyNoteId)] : []),
    )
    const existingOutputIds = new Set(
      existingFiles.flatMap((file) => file.legacyOutputId ? [String(file.legacyOutputId)] : []),
    )

    let notesMigrated = 0
    let outputsMigrated = 0
    let filesPatched = 0
    let notesSkipped = 0
    let outputsSkipped = 0
    const now = Date.now()

    for (const file of targetFiles) {
      if (file.kind) continue
      filesPatched += 1
      if (!dryRun) {
        const text = textOf(file)
        const kind = file.type === 'folder' ? 'folder' : 'upload'
        await ctx.db.patch(file._id, {
          kind,
          extension: file.extension ?? extensionOf(file.name),
          indexable: isTextIndexable(kind, text),
          indexStatus: isTextIndexable(kind, text) ? 'pending' : 'skipped',
        })
        if (isTextIndexable(kind, text)) {
          await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId: file._id })
        }
      }
    }

    for (const note of targetNotes) {
      if (note.deletedAt || existingNoteIds.has(String(note._id))) {
        notesSkipped += 1
        continue
      }
      notesMigrated += 1
      if (!dryRun) {
        const fileId = await ctx.db.insert('files', {
          userId: note.userId,
          name: note.title || 'Untitled',
          type: 'file',
          kind: 'note',
          content: note.content,
          sizeBytes: utf8ByteLength(note.content),
          contentHash: undefined,
          extension: 'md',
          indexable: note.content.trim().length > 0,
          indexStatus: note.content.trim().length > 0 ? 'pending' : 'skipped',
          projectId: note.projectId,
          legacyNoteId: note._id,
          createdAt: note.createdAt ?? note.updatedAt,
          updatedAt: note.updatedAt,
        })
        if (note.content.trim()) {
          await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId })
        }
      }
    }

    for (const output of targetOutputs) {
      if (existingOutputIds.has(String(output._id))) {
        outputsSkipped += 1
        continue
      }
      outputsMigrated += 1
      if (!dryRun) {
        const name = output.fileName || `${output.type}-${output._id}`
        const textContent =
          output.type === 'text' || output.type === 'code' || output.type === 'document'
            ? String(output.metadata?.text ?? output.metadata?.content ?? '')
            : ''
        const fileId = await ctx.db.insert('files', {
          userId: output.userId,
          name,
          type: 'file',
          kind: 'output',
          content: textContent,
          storageId: output.storageId,
          r2Key: output.r2Key,
          mimeType: output.mimeType,
          extension: extensionOf(name),
          sizeBytes: output.sizeBytes ?? (textContent ? utf8ByteLength(textContent) : 0),
          indexable: textContent.trim().length > 0,
          indexStatus: textContent.trim().length > 0 ? 'pending' : 'skipped',
          conversationId: output.conversationId,
          turnId: output.turnId,
          modelId: output.modelId,
          prompt: output.prompt,
          outputType: output.type,
          legacyOutputId: output._id,
          createdAt: output.createdAt,
          updatedAt: output.completedAt ?? output.createdAt,
        })
        await ctx.db.patch(output._id, { fileId })
        if (textContent.trim()) {
          await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId })
        }
      }
    }

    return {
      dryRun: Boolean(dryRun),
      filesInspected: targetFiles.length,
      filesPatched,
      notesInspected: targetNotes.length,
      notesMigrated,
      notesSkipped,
      outputsInspected: targetOutputs.length,
      outputsMigrated,
      outputsSkipped,
      completedAt: now,
    }
  },
})

// ─── Sharing ──────────────────────────────────────────────────────────────────

function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const setShare = mutation({
  args: {
    fileId: v.id('files'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    visibility: v.union(v.literal('private'), v.literal('public')),
  },
  handler: async (ctx, { fileId, userId, accessToken, serverSecret, visibility }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const file = await ctx.db.get(fileId)
    if (!file || file.userId !== userId || file.deletedAt) throw new Error('Unauthorized')
    if (file.type === 'folder') throw new Error('Folders cannot be shared')
    const now = Date.now()
    if (visibility === 'public') {
      const token = file.shareToken ?? generateShareToken()
      await ctx.db.patch(fileId, {
        shareToken: token,
        shareVisibility: 'public',
        sharedAt: now,
        updatedAt: now,
      })
      return { token, visibility: 'public' as const }
    }
    await ctx.db.patch(fileId, {
      shareToken: generateShareToken(),
      shareVisibility: 'private',
      updatedAt: now,
    })
    return { token: null, visibility: 'private' as const }
  },
})

export const getPublicR2KeyByTokenByServer = query({
  args: { token: v.string(), serverSecret: v.string() },
  handler: async (ctx, { token, serverSecret }) => {
    requireServerAccess(serverSecret)
    const file = await ctx.db
      .query('files')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', token))
      .first()
    if (!file || file.deletedAt || file.shareVisibility !== 'public' || file.type === 'folder') {
      return null
    }
    return {
      r2Key: file.r2Key ?? null,
      mimeType: file.mimeType ?? null,
      name: file.name,
      sizeBytes: file.sizeBytes ?? 0,
      userId: file.userId,
    }
  },
})

export const getPublicByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const file = await ctx.db
      .query('files')
      .withIndex('by_shareToken', (q) => q.eq('shareToken', token))
      .first()
    if (!file || file.deletedAt || file.shareVisibility !== 'public' || file.type === 'folder') {
      return null
    }
    return {
      _id: file._id,
      name: file.name,
      kind: file.kind ?? 'upload',
      mimeType: file.mimeType ?? null,
      extension: file.extension ?? null,
      sizeBytes: file.sizeBytes ?? null,
      content: file.content ?? null,
      textContent: file.textContent ?? null,
      hasBinary: Boolean(file.r2Key),
      createdAt: file.createdAt,
      sharedAt: file.sharedAt ?? file.createdAt,
    }
  },
})
