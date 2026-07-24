import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { extname, resolve, sep } from 'path'

const CACHE_KEY_PATTERN =
  /^[a-zA-Z0-9_-]{1,128}\/[a-f0-9-]{36}\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i
const CHAT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
const MAX_MEDIA_BYTES = 75 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
}
const EXTENSION_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSIONS).map(([mime, extension]) => [extension, mime])
)

export interface CachedChatMedia {
  cacheKey: string
  url: string
  mimeType: string
  sizeBytes: number
  name: string
}

export class ChatMediaCache {
  readonly root: string

  constructor(userDataPath: string) {
    this.root = resolve(userDataPath, 'chat-media-cache', 'v1')
  }

  async cacheDataUrl(input: {
    chatId: string
    dataUrl: string
    name?: string
  }): Promise<CachedChatMedia> {
    if (!CHAT_ID_PATTERN.test(input.chatId)) throw new Error('Invalid chat media chat id')
    const parsed = parseMediaDataUrl(input.dataUrl)
    const extension = MIME_EXTENSIONS[parsed.mimeType]
    if (!extension) throw new Error('Unsupported chat media type')
    if (parsed.bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('Chat media exceeds cache limit')

    const fileName = `${randomUUID()}.${extension}`
    const cacheKey = `${input.chatId}/${fileName}`
    const destination = this.resolveCacheKey(cacheKey)
    await mkdir(resolve(this.root, input.chatId), { recursive: true })
    await writeFile(destination, parsed.bytes, { flag: 'wx', mode: 0o600 })
    return {
      cacheKey,
      url: chatMediaUrl(cacheKey),
      mimeType: parsed.mimeType,
      sizeBytes: parsed.bytes.byteLength,
      name: sanitizeMediaName(input.name, fileName)
    }
  }

  async read(cacheKey: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const path = this.resolveCacheKey(cacheKey)
    const extension = extname(path).slice(1).toLowerCase()
    const mimeType = EXTENSION_MIME[extension]
    if (!mimeType) throw new Error('Unsupported cached chat media type')
    return { bytes: new Uint8Array(await readFile(path)), mimeType }
  }

  resolveCacheKey(cacheKey: string): string {
    if (!CACHE_KEY_PATTERN.test(cacheKey)) throw new Error('Invalid chat media cache key')
    const path = resolve(this.root, cacheKey)
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error('Invalid chat media cache path')
    return path
  }
}

export function chatMediaUrl(cacheKey: string): string {
  if (!CACHE_KEY_PATTERN.test(cacheKey)) throw new Error('Invalid chat media cache key')
  return `overlay-media://cache/${cacheKey}`
}

export function cacheKeyFromChatMediaUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'overlay-media:' || url.hostname !== 'cache' || url.search || url.hash) {
    throw new Error('Invalid chat media URL')
  }
  const cacheKey = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!CACHE_KEY_PATTERN.test(cacheKey)) throw new Error('Invalid chat media URL')
  return cacheKey
}

export function parseMediaDataUrl(value: string): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=]+)$/.exec(value)
  if (!match) throw new Error('Invalid chat media data URL')
  const mimeType = match[1].toLowerCase()
  if (!MIME_EXTENSIONS[mimeType]) throw new Error('Unsupported chat media type')
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'))
  if (!bytes.byteLength) throw new Error('Empty chat media data URL')
  return { mimeType, bytes }
}

function sanitizeMediaName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  return trimmed ? trimmed.slice(0, 255) : fallback
}
