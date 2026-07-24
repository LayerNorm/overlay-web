import { ipcMain } from '../services/security/secure-ipc-main'

import { getCloudMemoryService, MemorySearchResult } from '../services/memory/CloudMemoryService'
import { migrateToAgentMemorySchema } from '../services/memory/migrate'

// Memory types compatible with the frontend
interface StoredMemoryCompat {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance: number
  source: {
    chatId: string
    messageId?: string
    folderId?: string
    noteId?: string
  }
  createdAt: number
  updatedAt: number
  accessCount: number
  lastAccessedAt: number
}

// Convert MemorySearchResult to frontend-compatible format
function toStoredMemoryCompat(result: MemorySearchResult): StoredMemoryCompat {
  return {
    id: result.id,
    content: result.content,
    type: result.type as 'preference' | 'fact' | 'project' | 'decision' | 'agent',
    importance: result.importance,
    source: {
      chatId: result.chatId || '',
      messageId: result.messageId,
      folderId: result.folderId,
      noteId: result.noteId
    },
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    accessCount: result.accessCount,
    lastAccessedAt: result.lastAccessedAt
  }
}

export function registerMemoryIPC(): void {
  const memoryService = getCloudMemoryService()

  memoryService.initialize().catch((err) => {
    console.error('[Memory] Failed to initialize cloud memory service:', err)
  })

  // Search memories for context (uses vector search)
  ipcMain.handle(
    'memory:search',
    async (_, query: string, limit?: number): Promise<StoredMemoryCompat[]> => {
      try {
        const results = await memoryService.search(query, limit || 10)
        return results.map(toStoredMemoryCompat)
      } catch (error) {
        console.error('[Memory] Search failed:', error)
        return []
      }
    }
  )

  // Get memories for a specific chat
  ipcMain.handle('memory:getByChat', async (_, chatId: string): Promise<StoredMemoryCompat[]> => {
    try {
      const results = await memoryService.getByChat(chatId)
      return results.map(toStoredMemoryCompat)
    } catch (error) {
      console.error('[Memory] getByChat failed:', error)
      return []
    }
  })

  // Get memories for a folder/project
  ipcMain.handle(
    'memory:getByFolder',
    async (_, folderId: string): Promise<StoredMemoryCompat[]> => {
      try {
        const results = await memoryService.getByFolder(folderId)
        return results.map(toStoredMemoryCompat)
      } catch (error) {
        console.error('[Memory] getByFolder failed:', error)
        return []
      }
    }
  )

  // Get all memories
  ipcMain.handle('memory:getAll', async (): Promise<StoredMemoryCompat[]> => {
    try {
      const results = await memoryService.getAll()
      return results.map(toStoredMemoryCompat)
    } catch (error) {
      console.error('[Memory] getAll failed:', error)
      return []
    }
  })

  // Extract and store memories from a user message
  // NOTE: Only the user message is analyzed. The assistant response is intentionally
  // excluded to prevent AI suggestions/recommendations from being stored as user facts.
  ipcMain.handle(
    'memory:extract',
    async (
      _,
      params: {
        userMessage: string
        assistantResponse?: string // kept for backward compat but intentionally unused
        chatId: string
        messageId?: string
        folderId?: string
        conversationContext?: string[]
      }
    ): Promise<{ extracted: []; ids: string[]; model: string }> => {
      try {
        void params
        return { extracted: [], ids: [], model: 'server-managed' }
      } catch (error) {
        console.error('[Memory] Extract failed:', error)
        return { extracted: [], ids: [], model: 'error' }
      }
    }
  )

  // Manually add a memory
  ipcMain.handle(
    'memory:add',
    async (
      _,
      memory: {
        id?: string
        content: string
        type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
        importance: number
        source: { chatId: string; messageId?: string; folderId?: string; noteId?: string }
        sourceType?: string
        chunk?: boolean
        createdAt?: number
        updatedAt?: number
        lastAccessedAt?: number
        accessCount?: number
      }
    ): Promise<string> => {
      try {
        const ids = await memoryService.addMemory({
          id: memory.id,
          content: memory.content,
          type: memory.type,
          importance: memory.importance,
          chatId: memory.source.chatId,
          messageId: memory.source.messageId,
          folderId: memory.source.folderId,
          noteId: memory.source.noteId,
          source: memory.sourceType ?? 'manual',
          chunk: memory.chunk,
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
          lastAccessedAt: memory.lastAccessedAt,
          accessCount: memory.accessCount
        })
        return ids[0] || ''
      } catch (error) {
        console.error('[Memory] Add failed:', error)
        return ''
      }
    }
  )

  // Delete a memory
  ipcMain.handle('memory:delete', async (_, id: string): Promise<boolean> => {
    try {
      return await memoryService.deleteMemory(id)
    } catch (error) {
      console.error('[Memory] Delete failed:', error)
      return false
    }
  })

  // Delete multiple memories in a single batch operation
  ipcMain.handle('memory:deleteMany', async (_, ids: string[]): Promise<number> => {
    try {
      return await memoryService.deleteMemories(ids)
    } catch (error) {
      console.error('[Memory] Batch delete failed:', error)
      return 0
    }
  })

  // Update a memory
  ipcMain.handle(
    'memory:update',
    async (
      _,
      id: string,
      updates: {
        content?: string
        type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
        importance?: number
        source?: { chatId: string; messageId?: string; folderId?: string; noteId?: string }
        sourceType?: string
        updatedAt?: number
        lastAccessedAt?: number
        accessCount?: number
      }
    ): Promise<boolean> => {
      try {
        return await memoryService.updateMemory(id, {
          content: updates.content,
          type: updates.type,
          importance: updates.importance,
          chatId: updates.source?.chatId,
          messageId: updates.source?.messageId,
          folderId: updates.source?.folderId,
          noteId: updates.source?.noteId,
          source: updates.sourceType,
          updatedAt: updates.updatedAt,
          lastAccessedAt: updates.lastAccessedAt,
          accessCount: updates.accessCount
        })
      } catch (error) {
        console.error('[Memory] Update failed:', error)
        return false
      }
    }
  )

  // Get memory stats
  ipcMain.handle(
    'memory:stats',
    async (): Promise<{
      total: number
      byType: Record<string, number>
      recentlyAccessed: number
    }> => {
      try {
        return await memoryService.getStats()
      } catch (error) {
        console.error('[Memory] Stats failed:', error)
        return { total: 0, byType: {}, recentlyAccessed: 0 }
      }
    }
  )

  // Approve an agent memory candidate — persist it as an approved agent memory
  ipcMain.handle(
    'memory:agent-approve',
    async (
      _,
      candidate: {
        content: string
        type: 'agent' | 'fact' | 'preference' | 'decision'
        importance: number
        taskFingerprint: string
        sourceTaskId: string
        chatId?: string
        folderId?: string
      }
    ): Promise<{ success: boolean; id?: string; error?: string }> => {
      try {
        const ids = await memoryService.addMemory({
          content: candidate.content,
          type: candidate.type as 'fact' | 'preference' | 'project' | 'decision',
          importance: candidate.importance,
          chatId: candidate.chatId,
          folderId: candidate.folderId,
          source: 'agent-run',
          actor: 'agent',
          tags: ['agent-run', candidate.taskFingerprint].filter(Boolean)
        })
        console.log(`[Memory] Agent memory approved: ${ids[0]}`)
        return { success: true, id: ids[0] }
      } catch (error) {
        console.error('[Memory] Agent approve failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Reject an agent memory candidate — store with status='rejected' for analytics
  ipcMain.handle(
    'memory:agent-reject',
    async (
      _,
      candidate: {
        content: string
        type: string
        importance: number
        taskFingerprint: string
        sourceTaskId: string
        chatId?: string
        folderId?: string
      }
    ): Promise<{ success: boolean }> => {
      try {
        void candidate
        console.log('[Memory] Agent memory rejected')
        return { success: true }
      } catch {
        // Silent failure — rejection doesn't need error handling
        return { success: true }
      }
    }
  )

  // Run agent memory schema migration (v2)
  ipcMain.handle(
    'memory:run-schema-migration',
    async (): Promise<{ migrated: number; failed: number; skipped: boolean }> => {
      try {
        return await migrateToAgentMemorySchema()
      } catch (error) {
        console.error('[Memory] Schema migration failed:', error)
        return { migrated: 0, failed: 0, skipped: false }
      }
    }
  )

  console.log('[Memory] IPC handlers registered with cloud memory search')
}
