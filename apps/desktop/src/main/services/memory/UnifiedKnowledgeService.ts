import { getCloudMemoryService } from './CloudMemoryService'

export interface KnowledgeSearchOptions {
  query: string
  chatId?: string
  folderId?: string
  noteId?: string
  includeMemories?: boolean
  includeNotes?: boolean
  includeChats?: boolean
  includeDocuments?: boolean
  limit?: number
}

export interface UnifiedSearchResult {
  id: string
  type: 'memory' | 'note' | 'chat' | 'document'
  sourceId: string
  title?: string
  content: string
  folderId?: string | null
  chatId?: string | null
  filename?: string
  score: number
  priorityBoost: number
  finalScore: number
  createdAt: number
}

export interface RetrievalContext {
  memories: UnifiedSearchResult[]
  notes: UnifiedSearchResult[]
  chats: UnifiedSearchResult[]
  documents: UnifiedSearchResult[]
  all: UnifiedSearchResult[]
  totalTokensEstimate: number
}

export class UnifiedKnowledgeService {
  private memoryService = getCloudMemoryService()

  async initialize(): Promise<void> {
    await this.memoryService.initialize()
  }

  async search(options: KnowledgeSearchOptions): Promise<RetrievalContext> {
    const limit = options.limit ?? 20
    const includeMemories = options.includeMemories ?? true
    const includeDocuments = options.includeDocuments ?? true
    const sourceKind =
      includeMemories && !includeDocuments
        ? 'memory'
        : includeDocuments && !includeMemories
          ? 'file'
          : undefined

    const chunks = await this.memoryService.searchKnowledge(options.query, {
      sourceKind,
      projectId: options.folderId,
      limit
    })

    const now = Date.now()
    const all = chunks
      .filter((chunk) => {
        if (chunk.sourceKind === 'memory') return includeMemories
        if (chunk.sourceKind === 'file') return includeDocuments
        return false
      })
      .map((chunk, index): UnifiedSearchResult => {
        const isMemory = chunk.sourceKind === 'memory'
        const sourceId = chunk.sourceId || `${chunk.sourceKind || 'source'}:${index}`
        const score = chunk.score ?? 1
        return {
          id: `${sourceId}:${index}`,
          type: isMemory ? 'memory' : 'document',
          sourceId,
          title: chunk.title || (isMemory ? 'Memory' : 'Document'),
          content: chunk.text || '',
          folderId: options.folderId ?? null,
          chatId: options.chatId ?? null,
          filename: isMemory ? undefined : chunk.title,
          score,
          priorityBoost: 1,
          finalScore: score,
          createdAt: now
        }
      })

    return {
      memories: all.filter((item) => item.type === 'memory'),
      notes: [],
      chats: [],
      documents: all.filter((item) => item.type === 'document'),
      all,
      totalTokensEstimate: this.estimateTokens(all)
    }
  }

  async indexNote(...args: unknown[]): Promise<string[]> {
    void args
    return []
  }

  async removeNoteFromIndex(...args: unknown[]): Promise<void> {
    void args
  }

  async indexChat(...args: unknown[]): Promise<string[]> {
    void args
    return []
  }

  async removeChatFromIndex(...args: unknown[]): Promise<void> {
    void args
  }

  async getStats(): Promise<{
    memories: { total: number; byType: Record<string, number> }
    notes: { totalNotes: number; totalChunks: number }
    chats: { totalChats: number; totalEntries: number }
  }> {
    const memoryStats = await this.memoryService.getStats().catch(() => ({
      total: 0,
      byType: {}
    }))
    return {
      memories: { total: memoryStats.total, byType: memoryStats.byType },
      notes: { totalNotes: 0, totalChunks: 0 },
      chats: { totalChats: 0, totalEntries: 0 }
    }
  }

  private estimateTokens(results: UnifiedSearchResult[]): number {
    return Math.ceil(results.reduce((sum, result) => sum + result.content.length, 0) / 4)
  }
}

let unifiedKnowledgeInstance: UnifiedKnowledgeService | null = null

export function getUnifiedKnowledgeService(): UnifiedKnowledgeService {
  if (!unifiedKnowledgeInstance) {
    unifiedKnowledgeInstance = new UnifiedKnowledgeService()
  }
  return unifiedKnowledgeInstance
}
