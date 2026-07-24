import { ipcMain } from '../services/security/secure-ipc-main'

import { getContextEngine } from '../services/context/ContextEngine'
import type { ContextRequest } from '../services/context/ContextEngine'

let isInitialized = false

export function registerContextHandlers(): void {
  const contextEngine = getContextEngine()

  // Initialize the context engine
  ipcMain.handle('context:initialize', async () => {
    if (isInitialized) return { success: true }

    try {
      await contextEngine.initialize()
      isInitialized = true
      console.log('[ContextIPC] Context engine initialized')
      return { success: true }
    } catch (error) {
      console.error('[ContextIPC] Failed to initialize context engine:', error)
      return { success: false, error: String(error) }
    }
  })

  // Get context for a message
  ipcMain.handle(
    'context:getForMessage',
    async (
      _event,
      {
        userMessage,
        chatId,
        folderId,
        projectInstructions,
        recentMessages
      }: {
        userMessage: string
        chatId: string
        folderId?: string
        projectInstructions?: string
        recentMessages?: string[]
      }
    ) => {
      try {
        if (!isInitialized) {
          await contextEngine.initialize()
          isInitialized = true
        }

        const result = await contextEngine.getContextForMessage(
          userMessage,
          chatId,
          folderId,
          projectInstructions,
          recentMessages
        )

        return {
          success: true,
          ...result
        }
      } catch (error) {
        console.error('[ContextIPC] Failed to get context:', error)
        return { success: false, error: String(error), contextPrompt: '', memoriesUsed: 0 }
      }
    }
  )

  // Full context retrieval with all details
  ipcMain.handle('context:getContext', async (_event, request: ContextRequest) => {
    try {
      if (!isInitialized) {
        await contextEngine.initialize()
        isInitialized = true
      }

      const result = await contextEngine.getContext(request)

      return {
        success: true,
        systemContext: result.systemContext,
        totalTokens: result.totalTokens,
        memoriesUsed: result.memoriesUsed,
        truncated: result.truncated,
        sections: result.sections.map((s) => ({
          title: s.title,
          content: s.content,
          priority: s.priority,
          tokenCount: s.tokenCount
        })),
        retrievedCount: result.retrievedMemories.length,
        rankedCount: result.rankedMemories.length
      }
    } catch (error) {
      console.error('[ContextIPC] Failed to get full context:', error)
      return { success: false, error: String(error) }
    }
  })

  // Check if there's relevant context for a query
  ipcMain.handle(
    'context:hasRelevant',
    async (
      _event,
      { query, chatId, folderId }: { query: string; chatId?: string; folderId?: string }
    ) => {
      try {
        if (!isInitialized) {
          await contextEngine.initialize()
          isInitialized = true
        }

        const hasRelevant = await contextEngine.hasRelevantContext(query, chatId, folderId)
        return { success: true, hasRelevant }
      } catch (error) {
        console.error('[ContextIPC] Failed to check relevance:', error)
        return { success: false, error: String(error), hasRelevant: false }
      }
    }
  )

  console.log('[ContextIPC] Handlers registered')
}
