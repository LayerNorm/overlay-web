import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatMediaCache,
  cacheKeyFromChatMediaUrl,
  chatMediaUrl,
  parseMediaDataUrl
} from './chat-media-cache'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ChatMediaCache', () => {
  it('writes supported media beneath the versioned user-data cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'overlay-media-test-'))
    roots.push(root)
    const cache = new ChatMediaCache(root)
    const result = await cache.cacheDataUrl({
      chatId: 'chat_1',
      dataUrl: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
      name: 'capture.png'
    })

    expect(result.url).toBe(chatMediaUrl(result.cacheKey))
    expect(cacheKeyFromChatMediaUrl(result.url)).toBe(result.cacheKey)
    expect(await readFile(cache.resolveCacheKey(result.cacheKey), 'utf8')).toBe('png-bytes')
  })

  it('rejects arbitrary paths, traversal, malformed data URLs, and unsupported media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'overlay-media-test-'))
    roots.push(root)
    const cache = new ChatMediaCache(root)
    for (const key of [
      '../secret.png',
      'chat/../../secret.png',
      '/tmp/secret.png',
      'chat/file.txt'
    ]) {
      expect(() => cache.resolveCacheKey(key)).toThrow()
    }
    expect(() => cacheKeyFromChatMediaUrl('file:///tmp/secret.png')).toThrow()
    expect(() => cacheKeyFromChatMediaUrl('overlay-media://evil/chat/id.png')).toThrow()
    expect(() => parseMediaDataUrl('data:text/html;base64,PGgxPmJvb208L2gxPg==')).toThrow()
    expect(() => parseMediaDataUrl('data:image/png,not-base64')).toThrow()
  })
})
