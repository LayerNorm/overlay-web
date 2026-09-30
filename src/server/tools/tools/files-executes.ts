import 'server-only'

import { MAX_FILE_CONTENT_UTF8_BYTES, utf8ByteLength } from '@/shared/storage/convex-file-content'
import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'

/**
 * Agent tools over the workspace file system (`/api/v1/files`): list, read,
 * write text files, make folders, move/rename. Writes that replace an
 * existing file are guarded by the revision the agent read.
 */

const FILES_PATH = '/api/v1/files'
const READ_CHUNK_CHARS = 60_000
const LIST_LIMIT = 200

type FileSummary = {
  _id: string
  name: string
  type: 'file' | 'folder'
  kind?: string
  parentId?: string | null
  mimeType?: string
  sizeBytes?: number
  updatedAt: number
  isStorageBacked?: boolean
}

type FileDetail = FileSummary & { textContent?: string }

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

function summarize(file: FileSummary) {
  return {
    fileId: file._id,
    name: file.name,
    type: file.type,
    kind: file.kind,
    parentId: file.parentId ?? null,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    updatedAt: file.updatedAt,
  }
}

export async function executeListFiles(
  options: OverlayToolsOptions,
  input: { folderId?: string },
) {
  try {
    const params = new URLSearchParams({ summary: 'true', limit: String(LIST_LIMIT) })
    if (input.folderId) params.set('parentId', input.folderId)
    const res = await get(options, params)
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to list files') }
    const files = await res.json() as FileSummary[]
    return {
      success: true,
      files: files.map(summarize),
      ...(files.length >= LIST_LIMIT ? { truncated: true } : {}),
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
    const res = await get(options, new URLSearchParams({ fileId: input.fileId.trim() }))
    if (!res.ok) return { success: false, error: await errorMessage(res, 'File not found') }
    const file = await res.json() as FileDetail
    if (file.type === 'folder') return { success: false, error: 'That is a folder; use list_files with its id.' }
    if (file.kind === 'note') return { success: false, error: 'That is a note; use get_note to read it.' }
    const text = file.textContent ?? ''
    const base = { ...summarize(file), revision: String(file.updatedAt) }
    if (!text) {
      return {
        success: true,
        file: base,
        content: '',
        note: file.isStorageBacked
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
  input: { fileId?: string; name?: string; folderId?: string; content: string; expectedRevision?: string },
) {
  try {
    if (utf8ByteLength(input.content) > MAX_FILE_CONTENT_UTF8_BYTES) {
      return { success: false, error: `Content is over ${Math.floor(MAX_FILE_CONTENT_UTF8_BYTES / 1000)} KB; split it into several files.` }
    }
    if (input.fileId) {
      const expectedUpdatedAt = input.expectedRevision ? Number(input.expectedRevision) : undefined
      if (input.expectedRevision && !Number.isFinite(expectedUpdatedAt)) {
        return { success: false, error: 'expectedRevision must be the revision returned by read_file.' }
      }
      const res = await send(options, 'PATCH', {
        fileId: input.fileId.trim(),
        textContent: input.content,
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
      return { success: true, fileId: input.fileId.trim() }
    }
    const name = input.name?.trim()
    if (!name) return { success: false, error: 'name is required to create a file.' }
    const res = await send(options, 'POST', {
      name,
      type: 'file',
      kind: 'upload',
      mimeType: mimeTypeFor(name),
      textContent: input.content,
      ...(input.folderId ? { parentId: input.folderId } : {}),
    })
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to create file') }
    const data = await res.json() as { id?: string }
    return { success: true, fileId: data.id }
  } catch (err) {
    return failure(err, 'Failed to write file')
  }
}

export async function executeCreateFolder(
  options: OverlayToolsOptions,
  input: { name: string; parentId?: string },
) {
  try {
    const name = input.name.trim()
    if (!name) return { success: false, error: 'name is required.' }
    const res = await send(options, 'POST', {
      name,
      type: 'folder',
      kind: 'folder',
      ...(input.parentId ? { parentId: input.parentId } : {}),
    })
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to create folder') }
    const data = await res.json() as { id?: string }
    return { success: true, folderId: data.id }
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
    const res = await send(options, 'PATCH', {
      fileId: input.fileId.trim(),
      ...(input.folderId !== undefined ? { parentId: input.folderId } : {}),
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    })
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Failed to move file') }
    return { success: true, fileId: input.fileId.trim() }
  } catch (err) {
    return failure(err, 'Failed to move file')
  }
}
