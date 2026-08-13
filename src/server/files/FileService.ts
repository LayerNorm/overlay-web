import 'server-only'

import { logger } from '@/server/observability/logger'
import { randomBytes, randomUUID } from 'node:crypto'
import { splitTextForConvexDocuments } from '@/shared/storage/convex-file-content'
import { findSubstringMatchesInText } from '@/shared/storage/file-text-search'
import { formatBytes } from '@/shared/storage/storage-limits'
import {
  deleteObject,
  deleteObjects,
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
  getMaxPresignedUploadBytes,
  getR2PresignTtlSeconds,
  headObject,
  keyForFile,
  uploadBuffer,
} from '@/server/storage/object-store'
import { checkGlobalR2Budget } from '@/server/storage/r2-budget'
import type { FileRepository, FileUploadIntentRecord } from './FileRepository'
import {
  assertAllowedMimeType,
  assignTextContent,
  buildFileListArgs,
  buildTextFilePartWrites,
  buildUpdateFileArgs,
  extOf,
  isBinaryProxyContent,
  isDocx,
  isPdf,
  isTextLike,
  isOwnedStorageKey,
  isOwnedStorageKeyForKind,
  normalizeMimeType,
  normalizedPositiveBytes,
  ownedStorageKeysForSubtree,
  parseCreateFileRequest,
  parseSearchTextRequest,
  sanitizeConvexIdParam,
  shouldSplitTextFile,
  utf8ByteLength,
} from './FileServicePayloads'
import { serviceError } from './FileServiceErrors'

const MAX_INGEST_BYTES = 12 * 1024 * 1024

export { FileServiceError } from './FileServiceErrors'

export type FileServiceStorage = {
  checkGlobalR2Budget(sizeBytes: number): Promise<void>
  deleteObject(key: string): Promise<void>
  deleteObjects(keys: string[]): Promise<void>
  generatePresignedDownloadUrl(key: string): Promise<string>
  generatePresignedUploadUrl(
    key: string,
    mimeType: string,
    sizeBytes: number,
    expiresIn: number,
  ): Promise<string>
  getMaxPresignedUploadBytes(): number
  getR2PresignTtlSeconds(): number
  headObject(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>
  keyForFile(userId: string, fileId: string, fileName: string): string
  uploadBuffer(key: string, body: Buffer | Uint8Array | string, mimeType: string): Promise<void>
}

export type FileServiceClock = {
  now(): number
  randomBytes(size: number): { toString(encoding: 'base64url'): string }
  randomUUID(): string
}

export type FileServiceDeps = {
  clock?: FileServiceClock
  repository: FileRepository
  storage?: FileServiceStorage
}

export type SearchTextMatchRow = {
  fileId: string
  fileName: string
  matchIndexInFile: number
  charStart: number
  charEnd: number
  snippet: string
}

export type ContentProxyResult =
  | { kind: 'json'; payload: Record<string, unknown>; status: number }
  | { kind: 'redirect'; url: string }
  | { kind: 'upstream'; name: string; url: string }

const defaultStorage: FileServiceStorage = {
  checkGlobalR2Budget,
  deleteObject,
  deleteObjects,
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
  getMaxPresignedUploadBytes,
  getR2PresignTtlSeconds,
  headObject,
  keyForFile,
  uploadBuffer,
}

const defaultClock: FileServiceClock = {
  now: () => Date.now(),
  randomBytes,
  randomUUID,
}

async function parsePdfBuffer(buf: Buffer): Promise<string> {
  const mod = await import('pdf-parse/lib/pdf-parse.js')
  const parsePdf = mod.default
  const data = await parsePdf(buf)
  return (data.text ?? '').trim()
}

async function extractTextFromBuffer(buf: Buffer, file: File, ext: string): Promise<string> {
  if (buf.length > MAX_INGEST_BYTES) {
    throw new Error('FILE_TOO_LARGE')
  }
  if (isPdf(file, ext)) {
    return parsePdfBuffer(buf)
  }
  if (isDocx(file, ext)) {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ buffer: buf })
    return (value ?? '').trim()
  }
  return buf.toString('utf-8').trim()
}

export class FileService {
  private readonly clock: FileServiceClock
  private readonly storage: FileServiceStorage

  constructor(private readonly deps: FileServiceDeps) {
    this.clock = deps.clock ?? defaultClock
    this.storage = deps.storage ?? defaultStorage
  }

  async getOrListFiles(args: {
    conversationId?: string | null
    cursor?: string | null
    fileId?: string | null
    kind?: string | null
    outputType?: string | null
    parentId?: string | null
    limit?: number
    paginated?: boolean
    projectId?: string | null
    summary?: boolean
    userId: string
    workspaceId?: string
  }): Promise<unknown> {
    if (args.fileId) {
      const file = await this.deps.repository.getFile({
        fileId: args.fileId,
        userId: args.userId,
      })
      if (!file || file.userId !== args.userId) {
        serviceError({ error: 'Not found' }, 404)
      }
      return file
    }

    const listArgs = buildFileListArgs(args)
    if (args.paginated) {
      if (this.deps.repository.listFilesPage) {
        return await this.deps.repository.listFilesPage(listArgs)
      }
      const data = await this.deps.repository.listFiles(listArgs)
      return { data, nextCursor: null, hasMore: false }
    }
    return await this.deps.repository.listFiles(listArgs)
  }

  async createFile(args: {
    body: Record<string, unknown>
    userId: string
    workspaceId?: string
  }): Promise<{ id: unknown; ids?: string[]; parts?: number }> {
    const createRequest = parseCreateFileRequest(args.body, args.userId)
    let id: unknown
    const ids: string[] = []

    if (createRequest.r2Key) {
      id = await this.createFileFromR2Object({
        declaredSizeBytes: createRequest.sizeBytes,
        fileArgs: createRequest.fileArgs,
        kind: createRequest.kind,
        r2Key: createRequest.r2Key,
        userId: args.userId,
      })
    } else if (shouldSplitTextFile(createRequest)) {
      for (const part of buildTextFilePartWrites(createRequest.fileArgs.name, createRequest.textValue ?? '')) {
        const partId = await this.deps.repository.createFile({
          ...createRequest.fileArgs,
          ...part,
        })
        if (!partId) {
          serviceError({ error: 'Failed to create file part' }, 500)
        }
        ids.push(partId)
      }
      id = ids[0]
    } else {
      assignTextContent(createRequest.fileArgs, createRequest.textValue)
      id = await this.deps.repository.createFile(createRequest.fileArgs)
    }

    return {
      id,
      ids: ids.length ? ids : undefined,
      parts: ids.length || undefined,
    }
  }

  async updateFile(args: {
    body: Record<string, unknown>
    userId: string
    workspaceId?: string
  }): Promise<{ success: true }> {
    await this.deps.repository.updateFile(buildUpdateFileArgs(args.body, args.userId))
    return { success: true }
  }

  async deleteFile(args: {
    fileId?: string | null
    userId: string
    workspaceId?: string
  }): Promise<{ success: true }> {
    if (!args.fileId) serviceError({ error: 'fileId required' }, 400)
    const r2Entries = await this.deps.repository.getR2KeysForSubtree({
      fileId: args.fileId,
      userId: args.userId,
    })
    const r2Keys = ownedStorageKeysForSubtree(args.userId, r2Entries)
    if (this.deps.repository.storageCleanupMode === 'immediate' && r2Keys.length > 0) {
      await this.storage.deleteObjects(r2Keys)
    }
    await this.deps.repository.removeFile({
      fileId: args.fileId,
      userId: args.userId,
      r2CleanupConfirmed: this.deps.repository.storageCleanupMode === 'immediate' && r2Keys.length > 0,
    })
    return { success: true }
  }

  async createUploadUrl(args: {
    mimeType?: string
    name?: string
    sizeBytes?: number
    userId: string
  }): Promise<{ uploadUrl: string; r2Key: string; expiresIn: number; maxSizeBytes: number }> {
    const normalizedSizeBytes = normalizedPositiveBytes(args.sizeBytes, {
      missing: 'sizeBytes is required',
    })
    await this.assertPresignedUploadAllowed({
      notEnoughStoragePayload: (remainingBytes) => ({
        error: 'Overlay storage limit reached.',
        message: `Not enough Overlay storage remaining. ${formatBytes(remainingBytes)} available, ${formatBytes(normalizedSizeBytes)} needed.`,
      }),
      sizeBytes: normalizedSizeBytes,
      userId: args.userId,
    })
    const resolvedMime = normalizeMimeType(args.mimeType)
    assertAllowedMimeType(resolvedMime)

    const fileName = args.name ?? `upload-${this.clock.now()}`
    const fileIdPlaceholder = `tmp-${this.clock.now()}-${this.clock.randomBytes(9).toString('base64url')}`
    const r2Key = this.storage.keyForFile(args.userId, fileIdPlaceholder, fileName)
    const expiresIn = this.storage.getR2PresignTtlSeconds()
    await this.deps.repository.cleanupExpiredUploadIntents({ userId: args.userId }).catch((error) => {
      logger.warn('[FilesUploadUrl] Failed to clean expired upload intents', error)
    })
    await this.deps.repository.createUploadIntent({
      userId: args.userId,
      r2Key,
      declaredSizeBytes: normalizedSizeBytes,
      mimeType: resolvedMime,
      expiresAt: this.clock.now() + expiresIn * 1000,
    })
    const uploadUrl = await this.storage.generatePresignedUploadUrl(
      r2Key,
      resolvedMime,
      normalizedSizeBytes,
      expiresIn,
    )
    return { uploadUrl, r2Key, expiresIn, maxSizeBytes: normalizedSizeBytes }
  }

  async createPresignedUpload(args: {
    mimeType?: string | null
    name?: string | null
    sizeBytesRaw?: string | null
    userId: string
  }): Promise<{ r2Key: string; presignedUrl: string; expiresIn: number; maxSizeBytes: number }> {
    const mimeType = normalizeMimeType(args.mimeType)
    assertAllowedMimeType(mimeType)
    if (!args.name) serviceError({ error: 'name required' }, 400)
    if (!args.sizeBytesRaw || isNaN(Number(args.sizeBytesRaw))) {
      serviceError({ error: 'sizeBytes required' }, 400)
    }
    const sizeBytes = normalizedPositiveBytes(args.sizeBytesRaw, {
      missing: 'sizeBytes required',
      nonPositive: 'sizeBytes must be greater than 0',
    })
    await this.assertPresignedUploadAllowed({
      notEnoughStoragePayload: () => ({
        error: 'storage_limit_exceeded',
        message: 'Not enough Overlay storage remaining.',
      }),
      sizeBytes,
      userId: args.userId,
    })

    const fileIdPlaceholder = `tmp-${this.clock.now()}-${this.clock.randomBytes(9).toString('base64url')}`
    const r2Key = this.storage.keyForFile(args.userId, fileIdPlaceholder, args.name)
    const expiresIn = this.storage.getR2PresignTtlSeconds()
    await this.deps.repository.cleanupExpiredUploadIntents({ userId: args.userId }).catch((error) => {
      logger.warn('[FilesPresign] Failed to clean expired upload intents', error)
    })
    await this.deps.repository.createUploadIntent({
      userId: args.userId,
      r2Key,
      declaredSizeBytes: sizeBytes,
      mimeType,
      expiresAt: this.clock.now() + expiresIn * 1000,
    })
    const presignedUrl = await this.storage.generatePresignedUploadUrl(r2Key, mimeType, sizeBytes, expiresIn)
    return { r2Key, presignedUrl, expiresIn, maxSizeBytes: sizeBytes }
  }

  async getContentProxy(args: {
    fileId: string
    userId: string
  }): Promise<ContentProxyResult> {
    const proxyTarget = await this.deps.repository.getStorageUrlForProxy(args)
    if (!proxyTarget) {
      return { kind: 'json', payload: { error: 'Not found' }, status: 404 }
    }

    if (proxyTarget.r2Key) {
      if (!isOwnedStorageKey(args.userId, proxyTarget.r2Key)) {
        return { kind: 'json', payload: { error: 'Not found' }, status: 404 }
      }
      await this.deps.repository.recordFileBandwidth({
        userId: args.userId,
        bytes: proxyTarget.sizeBytes ?? 0,
      }).catch((error) => logger.warn('[files/content] bandwidth accounting failed', error))
      const url = await this.storage.generatePresignedDownloadUrl(proxyTarget.r2Key)
      return { kind: 'upstream', name: proxyTarget.name, url }
    }

    if (proxyTarget.url) {
      return { kind: 'upstream', name: proxyTarget.name, url: proxyTarget.url }
    }

    return { kind: 'json', payload: { error: 'Not found' }, status: 404 }
  }

  async searchText(args: {
    accessToken?: string
    body: Record<string, unknown>
    userId: string
  }): Promise<{ success: true; matches: SearchTextMatchRow[]; truncated: boolean }> {
    const searchRequest = parseSearchTextRequest(args.body)
    const matches: SearchTextMatchRow[] = []
    let truncated = false
    let remainingSnippetBudget = searchRequest.maxTotalSnippetChars

    for (const fileId of searchRequest.fileIds) {
      if (remainingSnippetBudget <= 0) {
        truncated = true
        break
      }
      const fileRow = await this.deps.repository.getFile({
        fileId,
        userId: args.userId,
        accessToken: args.accessToken,
      })

      if (!fileRow || fileRow.userId !== args.userId) {
        serviceError({ error: 'Invalid or inaccessible file id', fileId }, 403)
      }

      const content = fileRow.content ?? ''
      if (!content.trim() || isBinaryProxyContent(content)) {
        continue
      }

      const { matches: found, truncated: fileTrunc, snippetCharsUsed } = findSubstringMatchesInText({
        fullText: content,
        query: searchRequest.query,
        contextChars: searchRequest.contextChars,
        maxMatches: searchRequest.maxMatchesPerFile,
        maxTotalSnippetChars: remainingSnippetBudget,
      })

      remainingSnippetBudget -= snippetCharsUsed
      if (fileTrunc) truncated = true
      if (remainingSnippetBudget <= 0 && found.length > 0) truncated = true

      found.forEach((m, i) => {
        matches.push({
          fileId,
          fileName: fileRow.name,
          matchIndexInFile: i,
          charStart: m.charStart,
          charEnd: m.charEnd,
          snippet: m.snippet,
        })
      })

      if (remainingSnippetBudget <= 0) break
    }

    return { success: true, matches, truncated }
  }

  async setShare(args: {
    fileId?: string
    origin: string
    userId: string
    visibility?: 'private' | 'public'
  }): Promise<{ visibility: 'private' | 'public'; token: string | null; url: string | null }> {
    if (!args.fileId) {
      serviceError({ error: 'fileId required' }, 400)
    }
    if (args.visibility !== 'private' && args.visibility !== 'public') {
      serviceError({ error: 'visibility must be "private" or "public"' }, 400)
    }
    const result = await this.deps.repository.setShare({
      fileId: args.fileId,
      userId: args.userId,
      visibility: args.visibility,
    })
    if (!result) {
      serviceError({ error: 'Failed to update share visibility' }, 500)
    }
    const base = args.origin.replace(/\/$/, '')
    return {
      visibility: result.visibility,
      token: result.token,
      url: result.token ? `${base}/share/f/${result.token}` : null,
    }
  }

  async ingestDocument(args: {
    file: File | null
    parentId?: string
    projectId?: string
    userId: string
  }): Promise<{ id: string | undefined; ids: string[]; name: string; parts: number }> {
    let uploadedR2Key: string | null = null
    let uploadedR2RetainedByFileRecord = false
    try {
      if (!(args.file instanceof File) || !args.file.name?.trim()) {
        serviceError({ error: 'file required' }, 400)
      }

      const safeName = args.file.name.replace(/[/\\]/g, '').slice(0, 240)
      const ext = extOf(safeName)

      if (args.file.size > MAX_INGEST_BYTES) {
        serviceError({ error: 'File too large (max 12MB)' }, 413)
      }

      if (!isPdf(args.file, ext) && !isDocx(args.file, ext) && !isTextLike(args.file, ext)) {
        serviceError(
          {
            error:
              'Unsupported format. Use PDF, Word (.docx), or text-based files (txt, md, csv, json, html, common code extensions).',
          },
          415,
        )
      }

      const buf = Buffer.from(await args.file.arrayBuffer())

      let text: string
      try {
        text = await extractTextFromBuffer(buf, args.file, ext)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (msg === 'FILE_TOO_LARGE') {
          serviceError({ error: 'File too large (max 12MB)' }, 413)
        }
        logger.error('[ingest-document] extract:', error)
        serviceError({ error: 'Could not read document' }, 400)
      }

      if (!text.trim()) {
        serviceError({ error: 'No extractable text in file' }, 400)
      }

      const parts = splitTextForConvexDocuments(text)
      if (parts.length === 0) {
        serviceError({ error: 'No extractable text in file' }, 400)
      }

      const requiredStorageBytes = parts.reduce(
        (sum, part, index) => sum + (index === 0 ? Math.max(utf8ByteLength(part), buf.byteLength) : utf8ByteLength(part)),
        0,
      )
      await this.assertStorageEntitlements({
        notEnoughStoragePayload: (remainingBytes) => ({
          error: 'Overlay storage limit reached.',
          message: `Not enough Overlay storage remaining. ${formatBytes(remainingBytes)} available, ${formatBytes(requiredStorageBytes)} needed.`,
        }),
        sizeBytes: requiredStorageBytes,
        userId: args.userId,
      })

      await this.storage.checkGlobalR2Budget(buf.byteLength)

      const uploadKeyId = this.clock.randomUUID()
      const r2Key = this.storage.keyForFile(args.userId, uploadKeyId, safeName)
      const mimeType = args.file.type?.trim() || 'application/octet-stream'
      uploadedR2Key = r2Key
      await this.storage.uploadBuffer(r2Key, buf, mimeType)

      const partWrites = buildTextFilePartWrites(safeName, text)
      const total = partWrites.length
      let ids: string[]
      try {
        ids = await this.deps.repository.createExtractedDocument({
          mimeType,
          parentId: sanitizeConvexIdParam(args.parentId),
          parts: partWrites,
          projectId: sanitizeConvexIdParam(args.projectId),
          r2Key,
          sourceSizeBytes: Math.max(0, Math.round(buf.byteLength)),
          userId: args.userId,
        })
        uploadedR2RetainedByFileRecord = ids.length > 0
        if (ids.length !== partWrites.length) {
          serviceError({ error: 'Could not save indexed document.' }, 500)
        }
      } catch (error) {
        await this.cleanupUploadedDocument(uploadedR2RetainedByFileRecord ? null : uploadedR2Key)
        this.throwIngestCreateError(error)
      }

      return { id: ids[0], ids, name: safeName, parts: total }
    } catch (error) {
      await this.cleanupUploadedDocument(uploadedR2RetainedByFileRecord ? null : uploadedR2Key)
      throw error
    }
  }

  private async createFileFromR2Object(args: {
    declaredSizeBytes: unknown
    fileArgs: Record<string, unknown> & { userId: string; name: string }
    kind: unknown
    r2Key: unknown
    userId: string
  }): Promise<unknown> {
    const r2Key = args.r2Key
    if (
      typeof r2Key !== 'string' ||
      !isOwnedStorageKeyForKind(args.userId, r2Key, args.kind)
    ) {
      serviceError({ error: 'Invalid storage key' }, 400)
    }
    const objectHead = await this.storage.headObject(r2Key)
    if (!objectHead) {
      serviceError({ error: 'Uploaded object not found' }, 400)
    }
    const uploadIntent = args.kind === 'output'
      ? null
      : await this.deps.repository.getUploadIntent({
          userId: args.userId,
          r2Key,
          now: this.clock.now(),
        })
    if (args.kind !== 'output' && !uploadIntent) {
      await this.storage.deleteObjects([r2Key]).catch((_error) => undefined)
      serviceError({ error: 'Upload authorization expired or was not found' }, 400)
    }
    const declaredSize =
      uploadIntent?.declaredSizeBytes ??
      (typeof args.declaredSizeBytes === 'number' ? Math.max(0, Math.round(args.declaredSizeBytes)) : 0)
    const actualSize = Math.max(0, Math.round(objectHead.sizeBytes))
    if (declaredSize > 0 && actualSize > declaredSize) {
      await this.storage.deleteObjects([r2Key]).catch((_error) => undefined)
      await this.expireUploadIntentBestEffort(args.userId, uploadIntent)
      serviceError({ error: 'Uploaded object exceeds authorized size' }, 413)
    }
    await this.storage.checkGlobalR2Budget(actualSize)
    if (args.kind === 'output') {
      return await this.deps.repository.createFile({
        ...args.fileArgs,
        type: 'file',
        r2Key,
        sizeBytes: actualSize,
      })
    }

    const { type: _type, ...storageArgs } = args.fileArgs
    void _type
    let id: string | null
    try {
      id = await this.deps.repository.createFileWithStorage({
        ...storageArgs,
        r2Key,
        sizeBytes: actualSize,
      })
    } catch (error) {
      await this.storage.deleteObjects([r2Key]).catch((_error) => undefined)
      await this.expireUploadIntentBestEffort(args.userId, uploadIntent)
      throw error
    }
    if (!id) throw new Error('File create returned no id')
    if (uploadIntent) {
      await this.deps.repository.finalizeUploadIntent({
        userId: args.userId,
        r2Key,
        actualSizeBytes: actualSize,
        fileId: id,
        now: this.clock.now(),
      }).catch(async (error) => {
        logger.warn('[FilesCreate] Uploaded file saved but upload intent finalization failed', error)
        await this.expireUploadIntentBestEffort(args.userId, uploadIntent)
      })
    }
    return id
  }

  private async assertPresignedUploadAllowed(args: {
    notEnoughStoragePayload: (remainingBytes: number) => Record<string, unknown>
    sizeBytes: number
    userId: string
  }): Promise<void> {
    const maxPresignedUploadBytes = this.storage.getMaxPresignedUploadBytes()
    if (args.sizeBytes > maxPresignedUploadBytes) {
      serviceError({
        error: 'File is too large for direct upload.',
        message: `Direct uploads are limited to ${formatBytes(maxPresignedUploadBytes)} per file.`,
      }, 413)
    }
    await this.assertStorageEntitlements(args)
    await this.storage.checkGlobalR2Budget(args.sizeBytes)
  }

  private async assertStorageEntitlements(args: {
    notEnoughStoragePayload: (remainingBytes: number) => Record<string, unknown>
    sizeBytes: number
    userId: string
  }): Promise<void> {
    const entitlements = await this.deps.repository.getStorageEntitlements({ userId: args.userId })
    if (!entitlements) {
      serviceError({ error: 'Could not verify subscription.' }, 401)
    }
    if (entitlements.overlayStorageBytesUsed + args.sizeBytes > entitlements.overlayStorageBytesLimit) {
      const remainingBytes = Math.max(0, entitlements.overlayStorageBytesLimit - entitlements.overlayStorageBytesUsed)
      serviceError(args.notEnoughStoragePayload(remainingBytes), 403)
    }
  }

  private async cleanupUploadedDocument(r2Key: string | null): Promise<void> {
    if (!r2Key) return
    await this.storage.deleteObject(r2Key).catch((error) => {
      logger.warn(`[ingest-document] failed to delete orphaned R2 object key=${r2Key}`, error)
    })
  }

  private async expireUploadIntentBestEffort(
    userId: string,
    uploadIntent: FileUploadIntentRecord | null | undefined,
  ): Promise<void> {
    if (!uploadIntent) return
    await this.deps.repository.expireUploadIntent({
      userId,
      intentId: uploadIntent._id,
      now: this.clock.now(),
    }).catch((_error) => undefined)
  }

  private throwIngestCreateError(error: unknown): never {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('[ingest-document] files:create:', error)
    if (/unauthorized/i.test(msg)) {
      serviceError(
        {
          error:
            'Cannot attach this document to the selected project. Check project access or open chat without an invalid project link.',
        },
        403,
      )
    }
    if (/storage|quota|limit exceeded/i.test(msg)) {
      serviceError({ error: 'Overlay storage limit reached.' }, 403)
    }
    if (/Value is too large|maximum size/i.test(msg)) {
      serviceError(
        { error: 'Document section is too large to index. Try splitting it into smaller text files.' },
        413,
      )
    }
    serviceError({ error: 'Could not save indexed document. Try again.' }, 500)
  }
}
