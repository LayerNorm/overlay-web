import { partedFileName, splitTextForConvexDocuments } from '@/shared/storage/convex-file-content'
import {
  DEFAULT_CONTEXT_CHARS,
  DEFAULT_MAX_MATCHES_PER_FILE,
  DEFAULT_MAX_TOTAL_SNIPPET_CHARS,
  MAX_FILE_IDS_PER_REQUEST,
  MAX_QUERY_CHARS,
  dedupeFileIdsPreserveOrder,
} from '@/shared/storage/file-text-search'
import { hashTextContent } from '@/server/storage/text-content-hash'
import { isOwnedFileR2Key, isOwnedOutputR2Key } from '@/server/storage/storage-keys'
import type { FileSubtreeStorageEntry } from './FileRepository'
import { serviceError } from './FileServiceErrors'

const BLOCKED_MIME_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'application/javascript',
  'text/javascript',
])

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'html',
  'htm',
  'xml',
  'log',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'yaml',
  'yml',
  'toml',
  'sh',
  'py',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
])

const FILE_KIND_VALUES = new Set(['folder', 'note', 'upload', 'output'])
const CREATE_FILE_STRING_FIELDS = [
  'type',
  'mimeType',
  'extension',
  'conversationId',
  'turnId',
  'modelId',
  'prompt',
  'outputType',
  'legacyOutputId',
] as const

const utf8Encoder = new TextEncoder()

export interface ParsedCreateFileRequest {
  fileArgs: Record<string, unknown> & { userId: string; name: string }
  kind: unknown
  r2Key: unknown
  sizeBytes: unknown
  textValue?: string
}

export interface ParsedSearchTextRequest {
  contextChars: number
  fileIds: string[]
  maxMatchesPerFile: number
  maxTotalSnippetChars: number
  query: string
}

export function buildFileListArgs(args: {
  conversationId?: string | null
  kind?: string | null
  outputType?: string | null
  parentId?: string | null
  projectId?: string | null
  summary?: boolean
  userId: string
  workspaceId?: string
}): Record<string, unknown> & { userId: string } {
  const listArgs: Record<string, unknown> & { userId: string } = { userId: args.userId }
  assignIfPresent(listArgs, 'projectId', args.projectId)
  if (args.parentId !== null && args.parentId !== undefined) {
    listArgs.parentId = args.parentId === 'null' ? null : args.parentId
  }
  assignIfPresent(listArgs, 'conversationId', args.conversationId)
  assignIfPresent(listArgs, 'outputType', args.outputType)
  if (isFileKind(args.kind)) listArgs.kind = args.kind
  if (args.summary) listArgs.summary = true
  assignIfPresent(listArgs, 'workspaceId', args.workspaceId)
  return listArgs
}

export function parseCreateFileRequest(
  body: Record<string, unknown>,
  userId: string,
): ParsedCreateFileRequest {
  const name = body.name
  if (typeof name !== 'string') {
    serviceError({ error: 'name required' }, 400)
  }
  if (body.storageId) {
    serviceError(
      { error: 'Convex file storage is no longer supported. Upload to R2 and pass r2Key from the upload-url flow.' },
      400,
    )
  }

  const fileArgs: Record<string, unknown> & { userId: string; name: string } = { userId, name }
  for (const field of CREATE_FILE_STRING_FIELDS) {
    if (typeof body[field] === 'string') fileArgs[field] = body[field]
  }
  if (isFileKind(body.kind)) fileArgs.kind = body.kind
  if (body.parentId) fileArgs.parentId = body.parentId
  if (body.projectId) fileArgs.projectId = body.projectId

  const textValue = getTextValue(body)
  return {
    fileArgs,
    kind: body.kind,
    r2Key: body.r2Key,
    sizeBytes: body.sizeBytes,
    ...(textValue ? { textValue } : {}),
  }
}

export function shouldSplitTextFile(request: ParsedCreateFileRequest): boolean {
  return request.kind !== 'note' && request.fileArgs.type === 'file' && Boolean(request.textValue)
}

export function buildTextFilePartWrites(
  name: string,
  fullText: string,
): Array<{ name: string; content: string; contentHash: string }> {
  const parts = splitTextForConvexDocuments(fullText)
  const total = parts.length
  return parts.map((content, index) => ({
    name: partedFileName(name, index + 1, total),
    content,
    contentHash: hashTextContent(content),
  }))
}

export function assignTextContent(
  fileArgs: Record<string, unknown>,
  textValue: string | undefined,
): void {
  if (!textValue) return
  fileArgs.content = textValue
  fileArgs.contentHash = hashTextContent(textValue)
}

export function buildUpdateFileArgs(
  body: Record<string, unknown>,
  userId: string,
): Record<string, unknown> & { fileId: string; userId: string } {
  const { fileId, name, content, textContent, parentId, projectId } = body
  if (!fileId) serviceError({ error: 'fileId required' }, 400)
  const updateArgs: Record<string, unknown> & { fileId: string; userId: string } = {
    fileId: String(fileId),
    userId,
  }
  if (name !== undefined) updateArgs.name = name
  if (parentId !== undefined) updateArgs.parentId = parentId || null
  if (projectId !== undefined) updateArgs.projectId = projectId || null
  const nextContent = textContent ?? content
  if (typeof nextContent === 'string') {
    updateArgs.content = nextContent
    updateArgs.contentHash = hashTextContent(nextContent)
  } else if (nextContent !== undefined) {
    updateArgs.content = nextContent
  }
  return updateArgs
}

export function ownedStorageKeysForSubtree(
  userId: string,
  entries: FileSubtreeStorageEntry[] | null | undefined,
): string[] {
  return (entries ?? []).flatMap((entry) => (
    entry.r2Key && isOwnedStorageKey(userId, entry.r2Key)
      ? [entry.r2Key]
      : []
  ))
}

export function isOwnedStorageKey(userId: string, r2Key: string): boolean {
  return isOwnedFileR2Key(userId, r2Key) || isOwnedOutputR2Key(userId, r2Key)
}

export function isOwnedStorageKeyForKind(userId: string, r2Key: string, kind: unknown): boolean {
  return kind === 'output'
    ? isOwnedOutputR2Key(userId, r2Key)
    : isOwnedFileR2Key(userId, r2Key)
}

export function parseSearchTextRequest(body: Record<string, unknown>): ParsedSearchTextRequest {
  const rawIds = Array.isArray(body.fileIds) ? body.fileIds : []
  const fileIds = dedupeFileIdsPreserveOrder(rawIds.map((id) => String(id)))
  if (fileIds.length === 0) serviceError({ error: 'fileIds is required' }, 400)
  if (fileIds.length > MAX_FILE_IDS_PER_REQUEST) {
    serviceError({ error: `At most ${MAX_FILE_IDS_PER_REQUEST} file ids per request` }, 400)
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) serviceError({ error: 'query is required' }, 400)
  if (query.length > MAX_QUERY_CHARS) {
    serviceError({ error: `query too long (max ${MAX_QUERY_CHARS} characters)` }, 400)
  }

  return {
    fileIds,
    query,
    contextChars: boundedInteger(body.contextChars, 0, 2000, DEFAULT_CONTEXT_CHARS),
    maxMatchesPerFile: boundedInteger(body.maxMatchesPerFile, 1, 200, DEFAULT_MAX_MATCHES_PER_FILE),
    maxTotalSnippetChars: boundedInteger(
      body.maxTotalSnippetChars,
      1000,
      500_000,
      DEFAULT_MAX_TOTAL_SNIPPET_CHARS,
    ),
  }
}

export function normalizeMimeType(value: string | null | undefined): string {
  return (value ?? 'application/octet-stream').toLowerCase().split(';')[0]!.trim()
}

export function assertAllowedMimeType(mimeType: string): void {
  if (BLOCKED_MIME_TYPES.has(mimeType)) {
    serviceError({ error: `File type not allowed: ${mimeType}` }, 415)
  }
}

export function normalizedPositiveBytes(value: unknown, messages: {
  missing: string
  nonPositive?: string
}): number {
  const sizeBytes = parseRoundedNumber(value)
  if (sizeBytes <= 0) {
    serviceError({ error: messages.nonPositive ?? messages.missing }, 400)
  }
  return sizeBytes
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length
}

export function sanitizeConvexIdParam(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const s = value.trim()
  if (!/^[a-z0-9]+$/i.test(s) || s.length < 16 || s.length > 64) return undefined
  return s
}

export function isPdf(file: File, ext: string): boolean {
  return ext === 'pdf' || file.type === 'application/pdf'
}

export function isDocx(file: File, ext: string): boolean {
  return (
    ext === 'docx' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

export function isTextLike(file: File, ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext) || (!!file.type && file.type.startsWith('text/'))
}

export function isBinaryProxyContent(content: string): boolean {
  return content.startsWith('/api/v1/files/')
}

function assignIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): void {
  if (value !== null && value !== undefined) target[key] = value
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && value >= min && value <= max ? Math.floor(value) : fallback
}

function getTextValue(body: Record<string, unknown>): string | undefined {
  const value = body.textContent ?? body.content
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isFileKind(value: unknown): value is 'folder' | 'note' | 'upload' | 'output' {
  return typeof value === 'string' && FILE_KIND_VALUES.has(value)
}

function parseRoundedNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.round(Number(value))
  }
  return 0
}
