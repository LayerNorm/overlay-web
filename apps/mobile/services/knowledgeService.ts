import { appJson, appRequest } from './appApi'
import type { KnowledgeFile, MemoryRow, OutputSummary } from '@overlay/app-core'

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
): Promise<{ chunks: KnowledgeSearchChunk[] }> {
  const trimmed = query.trim()
  if (!trimmed) return { chunks: [] }
  return appJson('/api/v1/knowledge/search', {
    method: 'POST',
    json: { query: trimmed, sourceKind },
  })
}

// ── Memories ──
export async function listMemories(): Promise<MemoryRow[]> {
  return appJson<MemoryRow[]>('/api/v1/memory')
}

export async function createMemory(
  content: string,
): Promise<void> {
  await appJson('/api/v1/memory', {
    method: 'POST',
    json: {
      content,
      source: 'manual',
    },
  })
}

export async function updateMemory(memoryId: string, content: string): Promise<void> {
  await appJson('/api/v1/memory', {
    method: 'PATCH',
    json: { memoryId, content },
  })
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await appJson('/api/v1/memory', {
    method: 'DELETE',
    json: { memoryId },
  })
}

export async function bulkDeleteMemories(memoryIds: string[]): Promise<void> {
  await Promise.all(memoryIds.map((id) => deleteMemory(id)))
}

// ── Files ──
export async function listKnowledgeFiles(): Promise<KnowledgeFile[]> {
  return appJson<KnowledgeFile[]>('/api/v1/files')
}

export async function getKnowledgeFile(fileId: string): Promise<KnowledgeFile> {
  return appJson<KnowledgeFile>('/api/v1/files', {
    query: { fileId },
  })
}

export async function getKnowledgeFileContent(fileId: string): Promise<string> {
  const response = await appRequest(`/api/v1/files/${fileId}/content`)
  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.status}`)
  }
  return response.text()
}

export async function createKnowledgeFile(
  input: { name: string; content?: string; parentId?: string | null },
): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/files', {
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
  return appJson<{ id: string }>('/api/v1/files', {
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
  await appJson('/api/v1/files', {
    method: 'PATCH',
    json: { fileId, ...patch },
  })
}

/** Public link visibility — PATCH /api/v1/files/share. Returns the share url. */
export async function shareKnowledgeFile(
  fileId: string,
  visibility: 'private' | 'public',
): Promise<{ visibility: 'private' | 'public'; token: string | null; url: string | null }> {
  return appJson('/api/v1/files/share', {
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
  await appJson('/api/v1/files', {
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
  return appJson<{ r2Key: string; presignedUrl: string; expiresIn: number }>('/api/v1/files/presign', {
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
  return appJson<{ id: string }>('/api/v1/files', {
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
