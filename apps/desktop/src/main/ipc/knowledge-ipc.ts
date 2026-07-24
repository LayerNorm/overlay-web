import { ipcMain } from '../services/security/secure-ipc-main'

import {
  getUnifiedKnowledgeService,
  UnifiedSearchResult
} from '../services/memory/UnifiedKnowledgeService'

type NoteSearchResult = {
  id: string
  noteId: string
  title?: string
  content: string
  folderId?: string | null
  score: number
}

type ChatSearchResult = {
  id: string
  chatId: string
  title?: string
  content: string
  folderId?: string | null
  score: number
}

type MentionSearchResult = {
  id: string
  type: 'note' | 'chat' | 'document' | 'folder'
  title: string
  preview: string
  folderId?: string
  filename?: string
  score: number
}

export function registerKnowledgeIpcHandlers(): void {
  const unifiedKnowledge = getUnifiedKnowledgeService()

  ipcMain.handle(
    'knowledge/knowledge:search',
    async (
      _,
      options: {
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
    ): Promise<{
      memories: UnifiedSearchResult[]
      notes: UnifiedSearchResult[]
      chats: UnifiedSearchResult[]
      documents: UnifiedSearchResult[]
      all: UnifiedSearchResult[]
      totalTokensEstimate: number
    }> => {
      try {
        return await unifiedKnowledge.search(options)
      } catch (error) {
        console.error('[KnowledgeIPC] Search failed:', error)
        return {
          memories: [],
          notes: [],
          chats: [],
          documents: [],
          all: [],
          totalTokensEstimate: 0
        }
      }
    }
  )

  ipcMain.handle(
    'knowledge/knowledge:search-notes',
    async (
      _,
      options: { query: string; folderId?: string; limit?: number; includeGlobal?: boolean }
    ): Promise<NoteSearchResult[]> => {
      try {
        void options.includeGlobal
        const results = await unifiedKnowledge.search({
          query: options.query,
          folderId: options.folderId,
          includeMemories: false,
          includeDocuments: true,
          includeNotes: false,
          includeChats: false,
          limit: options.limit
        })
        return results.documents.map((entry) => ({
          id: entry.id,
          noteId: entry.sourceId,
          title: entry.title,
          content: entry.content,
          folderId: entry.folderId,
          score: entry.score
        }))
      } catch (error) {
        console.error('[KnowledgeIPC] Search notes failed:', error)
        return []
      }
    }
  )

  ipcMain.handle('knowledge/knowledge:search-chats', async (): Promise<ChatSearchResult[]> => {
    return []
  })

  ipcMain.handle('knowledge/knowledge:index-note', async (): Promise<string[]> => [])
  ipcMain.handle('knowledge/knowledge:remove-note', async (): Promise<void> => {})
  ipcMain.handle('knowledge/knowledge:index-chat', async (): Promise<string[]> => [])
  ipcMain.handle('knowledge/knowledge:remove-chat', async (): Promise<void> => {})

  ipcMain.handle(
    'knowledge/knowledge:get-stats',
    async (): Promise<{
      memories: { total: number; byType: Record<string, number> }
      notes: { totalNotes: number; totalChunks: number }
      chats: { totalChats: number; totalEntries: number }
    }> => {
      try {
        return await unifiedKnowledge.getStats()
      } catch (error) {
        console.error('[KnowledgeIPC] Get stats failed:', error)
        return {
          memories: { total: 0, byType: {} },
          notes: { totalNotes: 0, totalChunks: 0 },
          chats: { totalChats: 0, totalEntries: 0 }
        }
      }
    }
  )

  ipcMain.handle('knowledge/knowledge:get-folder-notes', async (): Promise<NoteSearchResult[]> => [])
  ipcMain.handle('knowledge/knowledge:get-folder-chats', async (): Promise<ChatSearchResult[]> => [])

  ipcMain.handle(
    'knowledge/knowledge:mention-search',
    async (
      _,
      options: {
        query: string
        type: 'note' | 'chat' | 'document' | 'folder'
        folderId?: string
        limit?: number
      }
    ): Promise<MentionSearchResult[]> => {
      try {
        if (options.type !== 'document') return []
        const results = await unifiedKnowledge.search({
          query: options.query || '',
          folderId: options.folderId,
          includeMemories: false,
          includeDocuments: true,
          includeNotes: false,
          includeChats: false,
          limit: options.limit ?? 8
        })
        const seen = new Set<string>()
        const mentions: MentionSearchResult[] = []
        for (const doc of results.documents) {
          if (seen.has(doc.sourceId)) continue
          seen.add(doc.sourceId)
          mentions.push({
            id: doc.sourceId,
            type: 'document',
            title: doc.title || doc.filename || 'Document',
            preview: doc.content.slice(0, 100),
            folderId: doc.folderId || undefined,
            filename: doc.filename,
            score: doc.score
          })
        }
        return mentions
      } catch (error) {
        console.error('[KnowledgeIPC] Mention search failed:', error)
        return []
      }
    }
  )

  console.log('[KnowledgeIPC] Handlers registered')
}
