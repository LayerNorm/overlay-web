import { CloudMemoryService, MemorySearchResult, MemoryType } from '../memory/CloudMemoryService'
import {
  UnifiedKnowledgeService,
  getUnifiedKnowledgeService
} from '../memory/UnifiedKnowledgeService'

export interface RetrievalQuery {
  text: string
  conversationContext?: string[]
  chatId?: string
  folderId?: string
  noteId?: string
  recencyWeight?: number
  types?: MemoryType[]
  includeNotes?: boolean
  includeChats?: boolean
  limit?: number
}

export interface RetrievedMemory extends MemorySearchResult {
  relevanceScore: number
  recencyScore: number
  importanceScore: number
  compositeScore: number
  tags: string[]
  sourceType?: 'memory' | 'note' | 'chat'
  sourceId?: string
  title?: string
}

export class Retriever {
  private unifiedKnowledge: UnifiedKnowledgeService

  constructor(private memoryService: CloudMemoryService) {
    this.unifiedKnowledge = getUnifiedKnowledgeService()
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievedMemory[]> {
    const limit = query.limit || 20
    const recencyWeight = query.recencyWeight ?? 0.2

    // 1. Semantic search on main query
    let semanticResults = await this.memoryService.search(query.text, limit * 2)

    // 2. Apply scope filters (folder/chat level)
    if (query.folderId) {
      const folderResults = await this.memoryService.getByFolder(query.folderId)
      const folderIds = new Set(folderResults.map((r) => r.id))
      // Boost results that are in the current folder
      semanticResults = semanticResults.map((r) => ({
        ...r,
        score: folderIds.has(r.id) ? r.score * 1.3 : r.score
      }))
    }

    if (query.chatId) {
      const chatResults = await this.memoryService.getByChat(query.chatId)
      const chatIds = new Set(chatResults.map((r) => r.id))
      // Boost results from the current chat
      semanticResults = semanticResults.map((r) => ({
        ...r,
        score: chatIds.has(r.id) ? r.score * 1.5 : r.score
      }))
    }

    // 3. If conversation context exists, also search with context
    let contextualResults: MemorySearchResult[] = []
    if (query.conversationContext?.length) {
      const contextQuery = query.conversationContext.slice(-3).join(' ')
      contextualResults = await this.memoryService.search(contextQuery, limit)
    }

    // 4. Merge and score all results
    const scoredMemories = this.scoreAndMerge(semanticResults, contextualResults, recencyWeight)

    // 5. Filter by type if specified
    let filtered = scoredMemories
    if (query.types?.length) {
      filtered = scoredMemories.filter((m) => query.types!.includes(m.type))
    }

    return filtered.slice(0, limit)
  }

  private scoreAndMerge(
    semantic: MemorySearchResult[],
    contextual: MemorySearchResult[],
    recencyWeight: number
  ): RetrievedMemory[] {
    const memoryMap = new Map<string, RetrievedMemory>()
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000

    // Process semantic results
    for (const memory of semantic) {
      const recencyScore = this.calculateRecency(memory.createdAt, now, dayMs)

      memoryMap.set(memory.id, {
        ...memory,
        tags: [],
        relevanceScore: memory.score,
        recencyScore,
        importanceScore: memory.importance,
        compositeScore: this.calculateComposite(
          memory.score,
          recencyScore,
          memory.importance,
          recencyWeight
        )
      })
    }

    // Boost memories that also appear in contextual results
    for (const memory of contextual) {
      if (memoryMap.has(memory.id)) {
        const existing = memoryMap.get(memory.id)!
        existing.compositeScore *= 1.2 // 20% boost for contextual relevance
      } else {
        const recencyScore = this.calculateRecency(memory.createdAt, now, dayMs)
        memoryMap.set(memory.id, {
          ...memory,
          tags: [],
          relevanceScore: memory.score * 0.8, // Lower base score for context-only matches
          recencyScore,
          importanceScore: memory.importance,
          compositeScore: this.calculateComposite(
            memory.score * 0.8,
            recencyScore,
            memory.importance,
            recencyWeight
          )
        })
      }
    }

    return Array.from(memoryMap.values()).sort((a, b) => b.compositeScore - a.compositeScore)
  }

  private calculateRecency(createdAt: number, now: number, dayMs: number): number {
    const ageInDays = (now - createdAt) / dayMs
    // Exponential decay: half-life of 7 days
    return Math.exp(-ageInDays / 7)
  }

  private calculateComposite(
    relevance: number,
    recency: number,
    importance: number,
    recencyWeight: number
  ): number {
    const relevanceWeight = 0.6 - recencyWeight / 2
    const importanceWeight = 0.4 - recencyWeight / 2

    return relevance * relevanceWeight + recency * recencyWeight + importance * importanceWeight
  }

  /**
   * Enhanced retrieval using UnifiedKnowledgeService
   * Retrieves from memories, notes, and chats with priority-based scoring
   */
  async retrieveUnified(query: RetrievalQuery): Promise<RetrievedMemory[]> {
    const limit = query.limit || 20

    // Use unified knowledge search (don't multiply limit - causes token overflow)
    const unifiedResults = await this.unifiedKnowledge.search({
      query: query.text,
      chatId: query.chatId,
      folderId: query.folderId,
      noteId: query.noteId,
      includeMemories: true,
      includeNotes: query.includeNotes ?? true,
      includeChats: query.includeChats ?? true,
      limit: limit
    })

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000

    // Convert unified results to RetrievedMemory format
    const retrievedMemories: RetrievedMemory[] = unifiedResults.all.map((result) => {
      const recencyScore = this.calculateRecency(result.createdAt, now, dayMs)
      const importance = result.type === 'memory' ? 0.7 : 0.5

      return {
        id: result.id,
        content: result.content,
        type: 'conversation' as const,
        importance,
        score: result.score,
        source: result.type,
        chatId: result.type === 'chat' ? result.sourceId : undefined,
        folderId: result.folderId ?? undefined,
        noteId: result.type === 'note' ? result.sourceId : undefined,
        createdAt: result.createdAt,
        updatedAt: result.createdAt,
        accessCount: 0,
        lastAccessedAt: result.createdAt,
        relevanceScore: result.score,
        recencyScore,
        importanceScore: importance,
        compositeScore: result.finalScore,
        tags: [],
        sourceType:
          result.type === 'document' ? undefined : (result.type as 'memory' | 'note' | 'chat'),
        sourceId: result.sourceId,
        title: result.title
      }
    })

    // Apply conversation context boost if available
    if (query.conversationContext?.length) {
      const contextQuery = query.conversationContext.slice(-3).join(' ')
      const contextResults = await this.memoryService.search(contextQuery, limit)
      const contextIds = new Set(contextResults.map((r) => r.id))

      for (const memory of retrievedMemories) {
        if (contextIds.has(memory.id)) {
          memory.compositeScore *= 1.2
        }
      }
    }

    // Filter by type if specified (only applies to memories)
    let filtered = retrievedMemories
    if (query.types?.length) {
      filtered = retrievedMemories.filter(
        (m) => m.sourceType !== 'memory' || query.types!.includes(m.type)
      )
    }

    return filtered.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, limit)
  }
}
