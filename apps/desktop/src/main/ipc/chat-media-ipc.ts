import { app, protocol } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { ChatMediaCache, cacheKeyFromChatMediaUrl } from '../services/chat-media-cache'
import { validateSender } from '../utils/ipc-security'

let cache: ChatMediaCache | null = null

export function registerChatMediaIPC(): void {
  cache = new ChatMediaCache(app.getPath('userData'))

  ipcMain.handle('chat-media:cache-data-url', async (event, input: unknown) => {
    validateSender(event, 'chat-media:cache-data-url')
    if (!input || typeof input !== 'object') throw new Error('Invalid chat media request')
    const value = input as { chatId?: unknown; dataUrl?: unknown; name?: unknown }
    if (typeof value.chatId !== 'string' || typeof value.dataUrl !== 'string') {
      throw new Error('Invalid chat media request')
    }
    return cache!.cacheDataUrl({
      chatId: value.chatId,
      dataUrl: value.dataUrl,
      name: typeof value.name === 'string' ? value.name : undefined
    })
  })

  protocol.handle('overlay-media', async (request) => {
    try {
      const cacheKey = cacheKeyFromChatMediaUrl(request.url)
      const media = await cache!.read(cacheKey)
      const body = media.bytes.buffer.slice(
        media.bytes.byteOffset,
        media.bytes.byteOffset + media.bytes.byteLength
      ) as ArrayBuffer
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': media.mimeType,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
