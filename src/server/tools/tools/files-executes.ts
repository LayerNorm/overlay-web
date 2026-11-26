import 'server-only'
import { refusesRoomItem, roomCreateScope, roomListScope, ROOM_PERSONAL_ITEM_ERROR } from './room-scope'

import { utf8ByteLength } from '@/shared/storage/convex-file-content'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'
import { ownerField, ownerNamesFor, type OwnerLabel } from './owner-names'

/**
 * Agent tools over the workspace file system (`/api/v1/files`): list, read,
 * write text files, make folders, move/rename. Writes that replace an
 * existing file are guarded by the revision the agent read.
 */

const FILES_PATH = '/api/v1/files'
const READ_CHUNK_CHARS = 60_000
const LIST_LIMIT = 200
/** Text over the Convex document limit is kept in object storage, so this is a sanity cap, not a storage limit. */
const MAX_WRITE_BYTES = 10 * 1024 * 1024

type FileSummary = {
  _id: string
  name: string
  type: 'file' | 'folder'
  kind?: string
  parentId?: string | null
  path?: string
  mimeType?: string
  sizeBytes?: number
  updatedAt: number
  isStorageBacked?: boolean
  scope?: 'personal' | 'workspace'
  archivedAt?: number
  userId?: string
}

type FileDetail = FileSummary & { textContent?: string; textInObjectStore?: boolean }

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  html: 'text/html',
  xml: 'application/xml',
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
}

function mimeTypeFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'text/plain'
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch((_error) => null) as { error?: string } | null
  return body?.error ?? fallback
}

function failure(err: unknown, fallback: string) {
  return { success: false as const, error: err instanceof Error ? err.message : fallback }
}

function get(options: OverlayToolsOptions, params: URLSearchParams) {
  return callInternalApiGet(
    `${FILES_PATH}?${params}`,
    options.accessToken,
    options.baseUrl,
    options.forwardCookie,
    options.serverSecret,
    options.userId,
    options.workspaceId,
  )
}

function send(options: OverlayToolsOptions, method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  return callInternalApi(
    FILES_PATH,
    { ...body, ...toolAuthBody(options) },
    options.accessToken,
    options.baseUrl,
    { method, forwardCookie: options.forwardCookie },
  )
}

function summarize(file: FileSummary, owner?: OwnerLabel) {
  return {
    fileId: file._id,
    name: file.name,
    type: file.type,
    kind: file.kind,
    parentId: file.parentId ?? null,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    updatedAt: file.updatedAt,
    // Who can see it: Personal is the owner's alone; Workspace is every member's.
    scope: file.scope === 'workspace' ? 'workspace' as const : 'personal' as const,
    ...ownerField(owner),
    ...(file.archivedAt !== undefined ? { archived: true } : {}),
  }
}

/** A by-id edit in a workspace context may touch only Workspace items: read the item's scope first. */
async function roomEditRefusal(options: OverlayToolsOptions, fileId: string): Promise<{ success: false; error: string } | null> {
  if (!options.sharedRoom) return null
  const res = await get(options, new URLSearchParams({ fileId: fileId.trim() }))
  if (!res.ok) return { success: false, error: await errorMessage(res, 'File not found') }
  const file = await res.json() as FileSummary
  return refusesRoomItem(options, file) ? { success: false, error: ROOM_PERSONAL_ITEM_ERROR } : null
}

async function persistedFilePath(options: OverlayToolsOptions, file: FileSummary): Promise<string> {
  const folders: string[] = []
  const visited = new Set([file._id])
  let parentId = file.parentId ?? null
  while (parentId && !visited.has(parentId) && folders.length < 32) {
    visited.add(parentId)
    try {
      const res = await get(options, new URLSearchParams({ fileId: parentId }))
      if (!res.ok) break
      const parent = await res.json() as FileSummary
      folders.unshift(parent.name)
      parentId = parent.parentId ?? null
    } catch (_error) {
      break
    }
  }
  return folders.length ? folders.join(' / ') : 'Library'
}

async function savedFile(
  options: OverlayToolsOptions,
  fileId: string | undefined,
  record: FileSummary | undefined,
  fallback: { name?: string; path?: string },
) {
  let file = record
  if (!file && fileId) {
    try {
      const res = await get(options, new URLSearchParams({ fileId }))
      if (res.ok) file = await res.json() as FileSummary
    } catch (_error) {
      file = undefined
    }
  }
  if (file?.name) {
    return {
      name: file.name,
      path: file.path ?? await persistedFilePath(options, file),
    }
  }
  return {
    ...(fallback.name !== undefined ? { name: fallback.name } : {}),
    ...(fallback.path !== undefined ? { path: fallback.path } : {}),
  }
}

export async function executeListFiles(
  options: OverlayToolsOptions,
  input: { folderId?: string; scope?: 'personal' | 'workspace' },
) {
  try {
    // The list endpoint returns at most 100 rows per page.
    const files: FileSummary[] = []
    let cursor: string | null = null
    let hasMore = false
    do {
      const params = new URLSearchParams({ summary: 'true', page: 'true', limit: '100' })
      if (input.folderId) params.set('parentId', input.folderId)
      const scope = roomListScope(options, input.scope)
      if (scope) params.set('view', scope)
      if (cursor) params.set('cursor', cursor)
      const res = await get(options, params)
      if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to list files') }
      const page = await res.json() as { data: FileSummary[]; nextCursor: string | null; hasMore: boolean }
      files.push(...page.data)
      hasMore = page.hasMore
      cursor = page.nextCursor
    } while (hasMore && cursor && files.length < LIST_LIMIT)
    const listed = files.slice(0, LIST_LIMIT)
    const ownerOf = await ownerNamesFor(options, listed.map((file) => file.userId))
    return {
      success: true,
      files: listed.map((file) => summarize(file, ownerOf(file.userId))),
      ...(hasMore || files.length > LIST_LIMIT ? { truncated: true } : {}),
    }
  } catch (err) {
    return failure(err, 'Failed to list files')
  }
}

export async function executeReadFile(
  options: OverlayToolsOptions,
  input: { fileId: string; offset?: number },
) {
  try {
    const res = await get(options, new URLSearchParams({ fileId: input.fileId.trim(), fullText: 'true' }))
    if (!res.ok) return { success: false, error: await errorMessage(res, 'File not found') }
    const file = await res.json() as FileDetail
    if (refusesRoomItem(options, file)) return { success: false, error: ROOM_PERSONAL_ITEM_ERROR }
    if (file.type === 'folder') return { success: false, error: 'That is a folder; use list_files with its id.' }
    if (file.kind === 'note') return { success: false, error: 'That is a note; use get_note to read it.' }
    const text = file.textContent ?? ''
    const ownerOf = await ownerNamesFor(options, [file.userId])
    const base = { ...summarize(file, ownerOf(file.userId)), revision: String(file.updatedAt) }
    if (!text) {
      return {
        success: true,
        file: base,
        content: '',
        note: file.isStorageBacked && !file.textInObjectStore
          ? 'This file has no extracted text (it is a binary or unindexed upload).'
          : 'The file is empty.',
      }
    }
    const offset = Math.max(0, Math.floor(input.offset ?? 0))
    const content = text.slice(offset, offset + READ_CHUNK_CHARS)
    const nextOffset = offset + content.length
    return {
      success: true,
      file: base,
      content,
      totalChars: text.length,
      ...(nextOffset < text.length ? { nextOffset } : {}),
    }
  } catch (err) {
    return failure(err, 'Failed to read file')
  }
}

export async function executeWriteFile(
  options: OverlayToolsOptions,
  input: { fileId?: string; name?: string; folderId?: string; content: string; expectedRevision?: string; scope?: 'personal' | 'workspace' },
) {
  try {
    if (utf8ByteLength(input.content) > MAX_WRITE_BYTES) {
      return { success: false, error: 'Content is over 10 MB; split it into several files.' }
    }
    if (input.fileId) {
      const refused = await roomEditRefusal(options, input.fileId)
      if (refused) return refused
      const expectedUpdatedAt = input.expectedRevision ? Number(input.expectedRevision) : undefined
      if (input.expectedRevision && !Number.isFinite(expectedUpdatedAt)) {
        return { success: false, error: 'expectedRevision must be the revision returned by read_file.' }
      }
      const res = await send(options, 'PATCH', {
        fileId: input.fileId.trim(),
        textContent: input.content,
        byAgent: true,
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
      })
      if (res.status === 409) {
        return {
          success: false,
          conflict: true,
          error: 'The file changed since you read it. Call read_file again and redo the edit on the current text.',
        }
      }
      if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to write file') }
      const data = await res.json().catch((_error) => null) as { file?: FileSummary } | null
      return {
        success: true,
        fileId: input.fileId.trim(),
        saved: await savedFile(options, input.fileId.trim(), data?.file, { name: input.name?.trim() }),
      }
    }
    const name = input.name?.trim()
    if (!name) return { success: false, error: 'name is required to create a file.' }
    const res = await send(options, 'POST', {
      name,
      byAgent: true,
      type: 'file',
      kind: 'upload',
      mimeType: mimeTypeFor(name),
      textContent: input.content,
      scope: roomCreateScope(options, input.scope),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(input.folderId ? { parentId: input.folderId } : {}),
    })
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to create file') }
    const data = await res.json() as { id?: string; file?: FileSummary }
    return {
      success: true,
      fileId: data.id,
      saved: await savedFile(options, data.id, data.file, {
        name,
        path: input.folderId ?? 'Library',
      }),
    }
  } catch (err) {
    return failure(err, 'Failed to write file')
  }
}

export async function executeCreateFolder(
  options: OverlayToolsOptions,
  input: { name: string; parentId?: string; scope?: 'personal' | 'workspace' },
) {
  try {
    const name = input.name.trim()
    if (!name) return { success: false, error: 'name is required.' }
    const res = await send(options, 'POST', {
      name,
      type: 'folder',
      kind: 'folder',
      scope: roomCreateScope(options, input.scope),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    })
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to create folder') }
    const data = await res.json() as { id?: string; file?: FileSummary }
    return {
      success: true,
      folderId: data.id,
      saved: await savedFile(options, data.id, data.file, {
        name,
        path: input.parentId ?? 'Library',
      }),
    }
  } catch (err) {
    return failure(err, 'Failed to create folder')
  }
}

export async function executeMoveFile(
  options: OverlayToolsOptions,
  input: { fileId: string; folderId?: string | null; name?: string },
) {
  try {
    if (input.folderId === undefined && !input.name?.trim()) {
      return { success: false, error: 'Pass folderId (null for the top level) and/or a new name.' }
    }
    const refused = await roomEditRefusal(options, input.fileId)
    if (refused) return refused
    const res = await send(options, 'PATCH', {
      fileId: input.fileId.trim(),
      ...(input.folderId !== undefined ? { parentId: input.folderId } : {}),
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    })
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to move file') }
    const data = await res.json().catch((_error) => null) as { file?: FileSummary } | null
    return {
      success: true,
      fileId: input.fileId.trim(),
      saved: await savedFile(options, input.fileId.trim(), data?.file, {
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.folderId === null ? { path: 'Library' } : input.folderId ? { path: input.folderId } : {}),
      }),
    }
  } catch (err) {
    return failure(err, 'Failed to move file')
  }
}
