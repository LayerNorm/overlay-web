import { appJson } from './appApi'
import type { KnowledgeFile, MemoryRow, OutputSummary } from './appContracts'

export async function listMemories(): Promise<MemoryRow[]> {
  return appJson<MemoryRow[]>('/api/app/memory')
}

export async function createMemory(
  content: string,
  options: { projectId?: string } = {},
): Promise<void> {
  await appJson('/api/app/memory', {
    method: 'POST',
    json: {
      content,
      source: 'manual',
      projectId: options.projectId,
    },
  })
}

export async function updateMemory(memoryId: string, content: string): Promise<void> {
  await appJson('/api/app/memory', {
    method: 'PATCH',
    json: { memoryId, content },
  })
}

export async function deleteMemory(memoryId: string): Promise<void> {
  await appJson('/api/app/memory', {
    method: 'DELETE',
    json: { memoryId },
  })
}

export async function listKnowledgeFiles(projectId?: string): Promise<KnowledgeFile[]> {
  return appJson<KnowledgeFile[]>('/api/app/files', {
    query: { projectId: projectId || undefined },
  })
}

export async function getKnowledgeFile(fileId: string): Promise<KnowledgeFile> {
  return appJson<KnowledgeFile>('/api/app/files', {
    query: { fileId },
  })
}

export async function createKnowledgeFile(
  input: { name: string; content?: string; projectId?: string; parentId?: string | null },
): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/app/files', {
    method: 'POST',
    json: {
      name: input.name,
      type: 'file',
      content: input.content || '',
      projectId: input.projectId,
      parentId: input.parentId ?? undefined,
    },
  })
}

export async function updateKnowledgeFile(
  fileId: string,
  patch: { name?: string; content?: string },
): Promise<void> {
  await appJson('/api/app/files', {
    method: 'PATCH',
    json: { fileId, ...patch },
  })
}

export async function deleteKnowledgeFile(fileId: string): Promise<void> {
  await appJson('/api/app/files', {
    method: 'DELETE',
    json: { fileId },
  })
}

export async function listOutputs(
  options: { type?: string; conversationId?: string } = {},
): Promise<OutputSummary[]> {
  return appJson<OutputSummary[]>('/api/app/outputs', {
    query: {
      type: options.type,
      conversationId: options.conversationId,
    },
  })
}
