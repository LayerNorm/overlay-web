import { CloudMemoryService, MemoryType, getCloudMemoryService } from '../memory/CloudMemoryService'
import { Retriever, RetrievalQuery, RetrievedMemory } from './Retriever'
import { Ranker, RankedMemory } from './Ranker'
import {
  ContextAssembler,
  AssembledContext,
  ContextSection,
  ExplicitMentionContent
} from './ContextAssembler'

export interface ExplicitMention {
  id: string
  type: 'note' | 'chat' | 'document' | 'folder'
  title: string
  preview?: string
  folderId?: string
  filename?: string
}

export interface ContextRequest {
  query: string
  conversationHistory?: string[]
  chatId?: string
  folderId?: string
  noteId?: string
  projectInstructions?: string
  maxTokens?: number
  includeTypes?: MemoryType[]
  excludeTypes?: MemoryType[]
  includeNotes?: boolean
  includeChats?: boolean
  useUnifiedSearch?: boolean
  explicitMentions?: ExplicitMention[]
}

export interface ContextResult extends AssembledContext {
  retrievedMemories: RetrievedMemory[]
  rankedMemories: RankedMemory[]
}

export class ContextEngine {
  private retriever: Retriever
  private ranker: Ranker
  private assembler: ContextAssembler
  private memoryService: CloudMemoryService

  constructor(memoryService?: CloudMemoryService) {
    this.memoryService = memoryService ?? getCloudMemoryService()
    this.retriever = new Retriever(this.memoryService)
    this.ranker = new Ranker()
    this.assembler = new ContextAssembler()
  }

  async initialize(): Promise<void> {
    await this.memoryService.initialize()
  }

  async getContext(request: ContextRequest): Promise<ContextResult> {
    console.log('[ContextEngine] Building context for query:', request.query.substring(0, 50))

    // 0. Fetch explicit mentions first (highest priority)
    const explicitContent = await this.fetchExplicitMentions(
      request.explicitMentions || [],
      request.query
    )
    if (explicitContent.length > 0) {
      console.log(`[ContextEngine] Fetched ${explicitContent.length} explicit mentions`)
    }

    // 1. Retrieve relevant memories (use unified search if enabled)
    // Limit to 25 items to prevent context overflow (6000 token limit)
    const retrievalQuery: RetrievalQuery = {
      text: request.query,
      conversationContext: request.conversationHistory,
      chatId: request.chatId,
      folderId: request.folderId,
      noteId: request.noteId,
      types: request.includeTypes,
      includeNotes: request.includeNotes ?? true,
      includeChats: request.includeChats ?? true,
      limit: 25
    }

    // Use unified search for enhanced retrieval with notes and chats
    const retrieved =
      request.useUnifiedSearch !== false
        ? await this.retriever.retrieveUnified(retrievalQuery)
        : await this.retriever.retrieve(retrievalQuery)
    console.log(
      `[ContextEngine] Retrieved ${retrieved.length} items (unified: ${request.useUnifiedSearch !== false})`
    )

    // 2. Filter excluded types
    let filtered = retrieved
    if (request.excludeTypes?.length) {
      filtered = retrieved.filter((m) => !request.excludeTypes!.includes(m.type))
    }

    // 3. Rank and select
    const ranked = this.ranker.rank(filtered)
    const selected = this.ranker.selectForContext(ranked, request.maxTokens)
    console.log(`[ContextEngine] Selected ${selected.length} memories for context`)

    // 4. Assemble context (include explicit mentions with highest priority)
    const assembled = this.assembler.assemble(
      selected,
      request.projectInstructions,
      explicitContent
    )

    return {
      ...assembled,
      retrievedMemories: retrieved,
      rankedMemories: selected
    }
  }

  async streamContext(
    request: ContextRequest,
    onSection: (section: ContextSection) => void
  ): Promise<ContextResult> {
    // For real-time context updates during conversation
    const result = await this.getContext(request)

    for (const section of result.sections) {
      onSection(section)
      // Small delay for UI updates
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return result
  }

  /**
   * Get context specifically for a chat message
   * This is the main entry point for chat integration
   */
  async getContextForMessage(
    userMessage: string,
    chatId: string,
    folderId?: string,
    projectInstructions?: string,
    recentMessages?: string[]
  ): Promise<{
    contextPrompt: string
    memoriesUsed: number
    totalTokens: number
  }> {
    const result = await this.getContext({
      query: userMessage,
      conversationHistory: recentMessages,
      chatId,
      folderId,
      projectInstructions,
      maxTokens: 3000
    })

    return {
      contextPrompt: result.systemContext,
      memoriesUsed: result.memoriesUsed,
      totalTokens: result.totalTokens
    }
  }

  /**
   * Quick relevance check - returns true if there are relevant memories
   */
  async hasRelevantContext(query: string, chatId?: string, folderId?: string): Promise<boolean> {
    const retrieved = await this.retriever.retrieve({
      text: query,
      chatId,
      folderId,
      limit: 5
    })

    // Consider relevant if we have memories with decent scores
    return retrieved.some((m) => m.compositeScore > 0.3)
  }

  /**
   * Fetch full content for explicit mentions
   */
  private async fetchExplicitMentions(
    mentions: ExplicitMention[],
    userQuery?: string
  ): Promise<ExplicitMentionContent[]> {
    if (mentions.length === 0) return []

    const results: ExplicitMentionContent[] = []

    for (const mention of mentions) {
      try {
        let content = ''

        switch (mention.type) {
          case 'note': {
            content = mention.preview || mention.title
            break
          }
          case 'chat': {
            content = mention.preview || mention.title
            break
          }
          case 'document': {
            const searchQuery = userQuery || mention.title
            const docResults = await this.retriever.retrieveUnified({
              text: searchQuery,
              limit: 8,
              includeNotes: false,
              includeChats: false
            })
            const matchingDocs = docResults.filter(
              (result) => result.sourceId === mention.id || result.id.startsWith(mention.id)
            )
            if (matchingDocs.length > 0) {
              // Estimate tokens and trim if needed (1 token ≈ 4 chars)
              const MAX_DOC_TOKENS = 2000
              let totalChars = 0
              const selectedChunks: string[] = []
              for (const chunk of matchingDocs) {
                if (totalChars + chunk.content.length > MAX_DOC_TOKENS * 4) break
                selectedChunks.push(chunk.content)
                totalChars += chunk.content.length
              }
              content = selectedChunks.join('\n\n')
            }
            break
          }
          case 'folder': {
            // Folder context would include folder instructions/readme
            // For now, just include the folder name as context
            content = `Folder: ${mention.title}`
            break
          }
        }

        if (content) {
          results.push({
            id: mention.id,
            type: mention.type,
            title: mention.title,
            content
          })
        }
      } catch (error) {
        console.error(`[ContextEngine] Failed to fetch mention ${mention.id}:`, error)
      }
    }

    return results
  }
}

// Singleton instance
let contextEngineInstance: ContextEngine | null = null

export function getContextEngine(): ContextEngine {
  if (!contextEngineInstance) {
    contextEngineInstance = new ContextEngine()
  }
  return contextEngineInstance
}

// Re-export types for convenience
export type { RetrievedMemory, RankedMemory, ContextSection, AssembledContext }
