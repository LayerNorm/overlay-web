import 'server-only'

import { segmentMemoryForIngestion } from '@/shared/knowledge/memory-display-segments'
import type {
  MemoryActor,
  MemoryRecord,
  MemoryRepository,
  MemorySource,
  MemoryType,
} from './MemoryRepository'

const MAX_MEMORY_CONTENT_CHARS = 20_000
const MAX_MEMORY_CHUNKS = 20

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  get(args: { includeDeleted?: boolean; memoryId: string; userId: string }) {
    return this.repository.get(args)
  }

  list(args: {
    conversationId?: string
    includeDeleted?: boolean
    noteId?: string
    projectId?: string
    updatedSince?: number
    userId: string
  }) {
    return this.repository.list(args)
  }

  async create(args: {
    actor?: MemoryActor
    clientId?: string
    content: string
    conversationId?: string
    importance?: number
    messageId?: string
    noteId?: string
    projectId?: string
    source?: string
    tags?: string[]
    turnId?: string
    type?: MemoryType
    userId: string
  }): Promise<{ count: number; ids: string[]; memory: MemoryRecord }> {
    const content = validateRouteContent(args.content)
    const chunks = segmentMemoryForIngestion(content)
    if (chunks.length > MAX_MEMORY_CHUNKS) throw new MemoryServiceError('memory content produced too many chunks', 413)
    const source = normalizeSource(args.source)
    const ids: string[] = []
    let first: MemoryRecord | null = null
    for (const chunk of chunks) {
      const memory = await this.repository.create({
        ...args,
        clientId: chunks.length === 1 ? args.clientId?.trim() || undefined : undefined,
        content: chunk,
        source,
      })
      first ??= memory
      ids.push(memory._id)
    }
    if (!first) throw new MemoryServiceError('content required', 400)
    return { count: ids.length, ids, memory: first }
  }

  async update(args: {
    actor?: MemoryActor
    content: string
    conversationId?: string
    importance?: number
    memoryId: string
    messageId?: string
    noteId?: string
    projectId?: string
    source?: MemorySource
    tags?: string[]
    turnId?: string
    type?: MemoryType
    userId: string
  }): Promise<MemoryRecord> {
    const memory = await this.repository.update({
      ...args,
      content: validateRouteContent(args.content),
      source: args.source ?? 'manual',
    })
    if (!memory) throw new MemoryServiceError('Not found', 404)
    return memory
  }

  async remove(args: { memoryId: string; userId: string }) {
    const result = await this.repository.remove(args)
    if (!result) throw new MemoryServiceError('Not found', 404)
    return result
  }
}

export class MemoryServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'MemoryServiceError'
  }
}

function validateRouteContent(content: string): string {
  const value = content.trim()
  if (!value) throw new MemoryServiceError('content required', 400)
  if (value.length > MAX_MEMORY_CONTENT_CHARS) {
    throw new MemoryServiceError(`content cannot exceed ${MAX_MEMORY_CONTENT_CHARS} characters`, 413)
  }
  return value
}

function normalizeSource(source: string | undefined): MemorySource {
  return source === 'chat' || source === 'note' || source === 'manual' ? source : 'manual'
}
