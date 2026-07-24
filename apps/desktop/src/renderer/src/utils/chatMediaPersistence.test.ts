import { describe, expect, it, vi } from 'vitest'
import type { Chat } from '../components/chat/types'
import { generationStateForPersistence, migrateLegacyChatMedia } from './chatMediaPersistence'

describe('chat media persistence', () => {
  it('does not persist base64 or blob generated output URLs', () => {
    const persisted = generationStateForPersistence({
      kind: 'image',
      modelIds: ['image-model'],
      results: [
        { type: 'image', status: 'completed', url: 'data:image/png;base64,abc', outputId: '1' },
        { type: 'image', status: 'completed', url: 'blob:local', outputId: '2' },
        { type: 'image', status: 'completed', url: 'https://cdn.example/image.png', outputId: '3' }
      ]
    })
    expect(persisted.results.map((result) => result.url)).toEqual([
      undefined,
      undefined,
      'https://cdn.example/image.png'
    ])
  })

  it('removes a legacy data URL only after the cache write succeeds', async () => {
    const chat: Chat = {
      id: 'chat_1',
      title: 'Legacy',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'message_1',
          role: 'user',
          content: 'look',
          timestamp: 1,
          imageData: 'data:image/png;base64,cG5n',
          screenshots: [
            {
              displayId: 'screen_1',
              name: 'capture.png',
              dataUrl: 'data:image/png;base64,cG5n'
            }
          ]
        }
      ]
    }
    const failure = await migrateLegacyChatMedia(chat, {
      cacheDataUrl: vi.fn().mockRejectedValue(new Error('disk full'))
    })
    expect(failure.changed).toBe(false)
    expect(failure.chat.messages[0].screenshots?.[0].dataUrl).toContain('data:')
    expect(failure.chat.messages[0].imageData).toContain('data:')

    const success = await migrateLegacyChatMedia(chat, {
      cacheDataUrl: vi.fn().mockResolvedValue({
        cacheKey: 'chat_1/11111111-1111-1111-1111-111111111111.png',
        url: 'overlay-media://cache/chat_1/11111111-1111-1111-1111-111111111111.png',
        mimeType: 'image/png',
        sizeBytes: 3,
        name: 'capture.png'
      })
    })
    expect(success.changed).toBe(true)
    expect(success.chat.messages[0].screenshots?.[0].dataUrl).toBeUndefined()
    expect(success.chat.messages[0].screenshots?.[0].cachedMedia?.url).toContain('overlay-media:')
    expect(success.chat.messages[0].imageData).toBeUndefined()
  })
})
