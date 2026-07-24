/**
 * Document IPC Handlers - For document ingestion and search
 */

import { dialog, app } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { resolve } from 'path'
import { existsSync } from 'node:fs'
import { getDocumentIngestionService } from '../services/memory/DocumentIngestionService'

function validateDocumentPath(filepath: string): string | null {
  if (!filepath || typeof filepath !== 'string') {
    return 'File path is required'
  }
  const resolved = resolve(filepath)
  if (resolved.includes('..')) {
    return 'Path traversal not allowed'
  }
  const homeDir = app.getPath('home')
  const tempDir = app.getPath('temp')
  if (!resolved.startsWith(homeDir) && !resolved.startsWith(tempDir)) {
    return 'File must be within user home or temp directory'
  }
  if (!existsSync(resolved)) {
    return 'File does not exist'
  }
  return null
}

export function registerDocumentIpcHandlers(): void {
  const ingestionService = getDocumentIngestionService()

  // Ingest a document from file path
  ipcMain.handle(
    'document:ingest',
    async (
      _event,
      options: {
        filepath: string
        folderId?: string
        chatId?: string
      }
    ) => {
      try {
        const { filepath, folderId, chatId } = options

        const pathError = validateDocumentPath(filepath)
        if (pathError) {
          return { success: false, error: pathError }
        }

        if (!ingestionService.isSupported(filepath)) {
          return {
            success: false,
            error: `Unsupported file format. Supported: ${ingestionService.getSupportedExtensions().join(', ')}`
          }
        }

        // Parse the document
        const parsed = await ingestionService.parseDocument(filepath, {
          folderId,
          chatId
        })

        return {
          success: true,
          document: {
            id: parsed.metadata.id,
            filename: parsed.metadata.filename,
            mimeType: parsed.metadata.mimeType,
            size: parsed.metadata.size,
            pageCount: parsed.metadata.pageCount,
            chunkCount: parsed.chunks.length,
            folderId,
            chatId
          }
        }
      } catch (error) {
        console.error('[Document IPC] Ingest failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Open file dialog and ingest selected document
  // Returns immediately after file selection, indexing happens in background
  ipcMain.handle(
    'document:ingest-dialog',
    async (
      _event,
      options: {
        folderId?: string
        chatId?: string
        waitForIndex?: boolean
      }
    ) => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [
            {
              name: 'Documents',
              extensions: ingestionService.getSupportedExtensions()
            }
          ]
        })

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, canceled: true }
        }

        const filepath = result.filePaths[0]
        const { folderId, chatId, waitForIndex } = options
        const filename = filepath.split('/').pop() || filepath

        if (waitForIndex) {
          const parsed = await ingestionService.parseDocument(filepath, {
            folderId,
            chatId
          })
          return {
            success: true,
            document: {
              id: parsed.metadata.id,
              filename: parsed.metadata.filename,
              filepath: parsed.metadata.filepath,
              mimeType: parsed.metadata.mimeType,
              size: parsed.metadata.size,
              pageCount: parsed.metadata.pageCount,
              chunkCount: parsed.chunks.length,
              folderId,
              chatId
            }
          }
        }

        // Generate document ID immediately (same logic as parseDocument)
        const crypto = await import('crypto')
        const idBase = `${filepath}:${chatId || ''}:${folderId || ''}`
        const hash = crypto.createHash('md5').update(idBase).digest('hex').slice(0, 12)
        const docId = `doc_${hash}`

        // Return immediately with document info - let UI show pill right away
        const immediateResult = {
          success: true,
          document: {
            id: docId,
            filename,
            filepath,
            mimeType: ingestionService.getMimeType(ingestionService.getFormat(filepath)!),
            folderId,
            chatId,
            isIndexing: true // Flag to indicate indexing is in progress
          }
        }

        // Start indexing in background with delay to let UI settle
        setTimeout(async () => {
          try {
            console.log(`[Document IPC] Background indexing: ${filename}`)
            const parsed = await ingestionService.parseDocument(filepath, {
              folderId,
              chatId
            })
            console.log(
              `[Document IPC] Parsed document: ${filename} (${parsed.chunks.length} chunks)`
            )
          } catch (error) {
            console.error(`[Document IPC] Background indexing failed for ${filename}:`, error)
          }
        }, 100)

        return immediateResult
      } catch (error) {
        console.error('[Document IPC] Ingest dialog failed:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Search documents
  ipcMain.handle(
    'document:search',
    async (
      _event,
      options: {
        query: string
        folderId?: string
        chatId?: string
        limit?: number
        includeGlobal?: boolean
      }
    ) => {
      try {
        void options
        return { success: true, results: [] }
      } catch (error) {
        console.error('[Document IPC] Search failed:', error)
        return { success: false, error: String(error), results: [] }
      }
    }
  )

  // Remove a document
  ipcMain.handle('document:remove', async (_event, documentId: string) => {
    try {
      void documentId
      return { success: true }
    } catch (error) {
      console.error('[Document IPC] Remove failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // Get all indexed documents
  ipcMain.handle('document:get-all', async (_event, limit?: number) => {
    try {
      void limit
      return []
    } catch (error) {
      console.error('[Document IPC] Get all failed:', error)
      return []
    }
  })

  // Get documents in a folder
  ipcMain.handle('document:get-by-folder', async (_event, folderId: string, limit?: number) => {
    try {
      void folderId
      void limit
      return { success: true, documents: [] }
    } catch (error) {
      console.error('[Document IPC] Get by folder failed:', error)
      return { success: false, error: String(error), documents: [] }
    }
  })

  // Get documents attached to a chat
  ipcMain.handle('document:get-by-chat', async (_event, chatId: string, limit?: number) => {
    try {
      void chatId
      void limit
      return { success: true, documents: [] }
    } catch (error) {
      console.error('[Document IPC] Get by chat failed:', error)
      return { success: false, error: String(error), documents: [] }
    }
  })

  // Get document chunks
  ipcMain.handle('document:get-chunks', async (_event, documentId: string) => {
    try {
      void documentId
      return { success: true, chunks: [] }
    } catch (error) {
      console.error('[Document IPC] Get chunks failed:', error)
      return { success: false, error: String(error), chunks: [] }
    }
  })

  // Get document stats
  ipcMain.handle('document:get-stats', async () => {
    try {
      return { success: true, stats: { totalDocuments: 0, totalChunks: 0 } }
    } catch (error) {
      console.error('[Document IPC] Get stats failed:', error)
      return { success: false, error: String(error) }
    }
  })

  // Check if format is supported
  ipcMain.handle('document:is-supported', async (_event, filepath: string) => {
    return {
      supported: ingestionService.isSupported(filepath),
      format: ingestionService.getFormat(filepath),
      supportedFormats: ingestionService.getSupportedExtensions()
    }
  })

  console.log('[Document IPC] Handlers registered')
}
