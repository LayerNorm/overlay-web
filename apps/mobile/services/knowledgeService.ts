import { appJson, appRequest, getRequestWorkspaceId } from './appApi'
import type { KnowledgeFile, MemoryRow, OutputSummary } from '@overlay/app-core'
import { getFile, listFiles, moveFile, renameFile } from './filesService'
import { readMemories } from './settingsNativeService'
import { createIdempotencyKey } from '@overlay/api-client'

export interface KnowledgeSearchChunk {
  sourceId: string
  sourceKind: 'file' | 'memory' | 'message'
  chunkIndex: number
  score: number
  text: string
  title?: string
}

export async function searchKnowledge(
  query: string,
  sourceKind: 'file' | 'memory',
  idempotencyKey = createIdempotencyKey(),
): Promise<{ chunks: KnowledgeSearchChunk[] }> {
  const trimmed = query.trim()
  if (!trimmed) return { chunks: [] }
  return appJson('/api/v1/knowledge/search', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    json: { query: trimmed, sourceKind },
  })
}

// ── Memories ──
export async function listMemories(): Promise<MemoryRow[]> {
  const rows = await readMemories()
  if (!rows) throw new Error('Memories are unavailable in this workspace.')
  return rows
}

export async function createMemory(
  content: string,
): Promise<void> {
  await appJson('/api/v1/memory', { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: {
      content,
      source: 'manual',
    },
  })
}

export async function updateMemory(memoryId: string, content: string): Promise<void> {
  await appJson('/api/v1/memory', { workspaceId: getRequestWorkspaceId(),
    method: 'PATCH',
    json: { memoryId, content },
  })
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await appJson('/api/v1/memory', { workspaceId: getRequestWorkspaceId(),
    method: 'DELETE',
    json: { memoryId },
  })
}

export async function bulkDeleteMemories(memoryIds: string[]): Promise<void> {
  await Promise.all(memoryIds.map((id) => deleteMemory(id)))
}

// ── Files ──
export async function listKnowledgeFiles(): Promise<KnowledgeFile[]> {
  const files = await listFiles()
  if (files === null) throw new Error('Files are unavailable in this workspace.')
  return files
}

export async function getKnowledgeFile(fileId: string): Promise<KnowledgeFile> {
  const file = await getFile(fileId)
  if (!file) throw new Error('This file is no longer available.')
  return file
}

export async function getKnowledgeFileContent(fileId: string): Promise<string> {
  const response = await appRequest(`/api/v1/files/${fileId}/content`, { workspaceId: getRequestWorkspaceId() })
  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.status}`)
  }
  return response.text()
}

export async function createKnowledgeFile(
  input: { name: string; content?: string; parentId?: string | null },
): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/files', { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: {
      name: input.name,
      type: 'file',
      content: input.content || '',
      parentId: input.parentId ?? undefined,
    },
  })
}

export async function createKnowledgeFolder(
  input: { name: string; parentId?: string | null },
): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/files', { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: {
      name: input.name,
      type: 'folder',
      parentId: input.parentId ?? undefined,
    },
  })
}

export async function updateKnowledgeFile(
  fileId: string,
  patch: { name?: string; content?: string; parentId?: string | null },
): Promise<void> {
  const workspaceId = getRequestWorkspaceId()
  if (patch.name !== undefined) await renameFile(fileId, patch.name)
  if (getRequestWorkspaceId() !== workspaceId) throw new Error('Workspace changed. Try again.')
  if (patch.parentId !== undefined) await moveFile(fileId, patch.parentId)
  if (getRequestWorkspaceId() !== workspaceId) throw new Error('Workspace changed. Try again.')
  if (patch.content !== undefined) await appJson('/api/v1/files', { workspaceId, method: 'PATCH', json: { fileId, content: patch.content } })
}

/** Public link visibility — PATCH /api/v1/files/share. Returns the share url. */
export async function shareKnowledgeFile(
  fileId: string,
  visibility: 'private' | 'public',
): Promise<{ visibility: 'private' | 'public'; token: string | null; url: string | null }> {
  return appJson('/api/v1/files/share', { workspaceId: getRequestWorkspaceId(),
    method: 'PATCH',
    json: { fileId, visibility },
  })
}

export interface FileTextMatch {
  fileId: string
  fileName: string
  matchIndexInFile: number
  charStart: number
  charEnd: number
  snippet: string
}

/** Server-side full-text search inside specific files (`/files/search-text`). */
export async function searchTextInFiles(
  fileIds: string[],
  query: string,
): Promise<{ matches: FileTextMatch[]; truncated: boolean }> {
  return appJson('/api/v1/files/search-text', {
    method: 'POST',
    json: { fileIds, query },
  })
}

export async function deleteKnowledgeFile(fileId: string): Promise<void> {
  await appJson('/api/v1/files', { workspaceId: getRequestWorkspaceId(),
    method: 'DELETE',
    json: { fileId },
  })
}

export async function bulkDeleteKnowledgeFiles(fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map((id) => deleteKnowledgeFile(id)))
}

// Upload helpers
export async function getUploadUrl(options: {
  name: string
  mimeType: string
  sizeBytes: number
}): Promise<{ r2Key: string; presignedUrl: string; expiresIn: number }> {
  return appJson<{ r2Key: string; presignedUrl: string; expiresIn: number }>('/api/v1/files/presign', { workspaceId: getRequestWorkspaceId(),
    query: {
      name: options.name,
      mimeType: options.mimeType,
      sizeBytes: options.sizeBytes,
    },
  })
}

export async function uploadToR2(presignedUrl: string, body: ArrayBuffer | Uint8Array, mimeType: string): Promise<void> {
  const buffer = body instanceof Uint8Array ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : body
  const blob = new Blob([buffer as ArrayBuffer], { type: mimeType })
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  })
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`)
  }
}

export async function createFileWithStorage(
  input: { name: string; r2Key: string; sizeBytes: number; parentId?: string | null },
): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/files', { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: {
      name: input.name,
      type: 'file',
      r2Key: input.r2Key,
      sizeBytes: input.sizeBytes,
      parentId: input.parentId ?? undefined,
    },
  })
}

// ── Outputs ──
export async function listOutputs(
  options: { type?: string; conversationId?: string } = {},
): Promise<OutputSummary[]> {
  return appJson<OutputSummary[]>('/api/v1/outputs', {
    query: {
      type: options.type,
      conversationId: options.conversationId,
    },
  })
}

export async function deleteOutput(outputId: string): Promise<void> {
  await appJson('/api/v1/outputs', {
    method: 'DELETE',
    query: { outputId },
  })
}

export async function bulkDeleteOutputs(outputIds: string[]): Promise<void> {
  await Promise.all(outputIds.map((id) => deleteOutput(id)))
}

/** Public link visibility for an output — PATCH /api/v1/outputs. */
export async function shareOutput(
  outputId: string,
  visibility: 'private' | 'public',
): Promise<{ visibility: 'private' | 'public'; token: string | null; url: string | null }> {
  return appJson('/api/v1/outputs', {
    method: 'PATCH',
    json: { outputId, visibility },
  })
}
