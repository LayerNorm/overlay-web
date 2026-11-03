import 'server-only'

import type { LanguageModelV4Prompt } from '@ai-sdk/provider'

export const HARNESS_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024
export const HARNESS_ARTIFACT_RUN_MAX_BYTES = 128 * 1024 * 1024
export const HARNESS_ARTIFACT_MAX_INLINE_TEXT = 16_000
export const HARNESS_ARTIFACT_MAX_READ_CHARS = 16_000
export const HARNESS_ARTIFACT_MAX_EXCERPT = 2_000

export type HarnessArtifactMetadata = {
  artifactId: string
  runId: string
  workflowRunId: string
  toolCallId: string
  toolName: string
  digest: string
  storageId: string
  byteSize: number
  mediaPartCount: number
  createdAt: number
  expiresAt: number
  resource?: { id: string; revision?: string; operation?: string; page?: number }
}

type SerializedArtifact = {
  version: 1
  output: unknown
  binaryParts: Array<{ index: number; mediaType: string; base64: string }>
}

function decodeBase64(value: string): Uint8Array {
  const input = value.replace(/\s/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    throw new Error('Harness artifact media encoding is invalid.')
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes = new Uint8Array(Math.max(0, input.length / 4 * 3 - (input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0)))
  let offset = 0
  for (let index = 0; index < input.length; index += 4) {
    const a = alphabet.indexOf(input[index] ?? '')
    const b = alphabet.indexOf(input[index + 1] ?? '')
    const c = input[index + 2] === '=' ? 0 : alphabet.indexOf(input[index + 2] ?? '')
    const d = input[index + 3] === '=' ? 0 : alphabet.indexOf(input[index + 3] ?? '')
    bytes[offset++] = (a << 2) | (b >> 4)
    if (input[index + 2] !== '=') bytes[offset++] = ((b & 15) << 4) | (c >> 2)
    if (input[index + 3] !== '=') bytes[offset++] = ((c & 3) << 6) | d
  }
  return bytes
}

function base64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const chunks: string[] = []
  const chunkSize = 24_576
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize)
    let chunk = ''
    for (let index = offset; index < end; index += 3) {
      const first = bytes[index] ?? 0
      const second = bytes[index + 1]
      const third = bytes[index + 2]
      chunk += alphabet[first >> 2]
      chunk += alphabet[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)]
      chunk += second === undefined ? '=' : alphabet[((second & 15) << 2) | (third === undefined ? 0 : third >> 6)]
      chunk += third === undefined ? '=' : alphabet[third & 63]
    }
    chunks.push(chunk)
  }
  return chunks.join('')
}

export function serializeHarnessArtifactOutput(output: unknown): Uint8Array {
  const binaryParts: SerializedArtifact['binaryParts'] = []
  let index = 0
  const visit = (value: unknown, inheritedMediaType = 'application/octet-stream'): unknown => {
    if (value instanceof Uint8Array) {
      const binaryIndex = index++
      binaryParts.push({ index: binaryIndex, mediaType: inheritedMediaType, base64: base64(value) })
      return { __harnessBinaryPart: binaryIndex }
    }
    if (Array.isArray(value)) return value.map(item => visit(item, inheritedMediaType))
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const mediaType = typeof record.mediaType === 'string' ? record.mediaType
        : typeof record.mimeType === 'string' ? record.mimeType : inheritedMediaType
      const isMedia = record.type === 'image' || record.type === 'file' || mediaType.startsWith('image/')
      if (typeof record.data === 'string' && (record.type === 'data' || isMedia)
        && (record.data.startsWith('data:') && record.data.includes(';base64,') || isMedia)) {
        const [header, encoded = ''] = record.data.startsWith('data:') ? record.data.split(',', 2) : ['', record.data]
        const dataMediaType = header.startsWith('data:') ? header.slice(5).split(';')[0] || mediaType : mediaType
        const binaryIndex = index++
        binaryParts.push({ index: binaryIndex, mediaType: dataMediaType, base64: encoded })
        return { ...Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'data')), __harnessBinaryPart: binaryIndex }
      }
      return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, visit(entry, mediaType)]))
    }
    return value
  }
  const serialized: SerializedArtifact = { version: 1, output: visit(output), binaryParts }
  const bytes = new TextEncoder().encode(JSON.stringify(serialized))
  if (bytes.byteLength > HARNESS_ARTIFACT_MAX_BYTES) throw new Error('Harness tool output exceeds the private artifact limit.')
  return bytes
}

export function parseHarnessArtifactOutput(bytes: Uint8Array): SerializedArtifact {
  if (bytes.byteLength > HARNESS_ARTIFACT_MAX_BYTES) throw new Error('Harness artifact exceeds the private artifact limit.')
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SerializedArtifact>
  if (parsed.version !== 1 || !Array.isArray(parsed.binaryParts)) throw new Error('Harness artifact content is invalid.')
  return parsed as SerializedArtifact
}

export async function harnessArtifactDigest(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function harnessArtifactId(runId: string, toolCallId: string, digest: string): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify([runId, toolCallId, digest]))
  const hashed = await globalThis.crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer)
  const identity = Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, '0')).join('')
  return `ha_${identity}`
}

export function harnessToolResultText(output: unknown, maxChars = HARNESS_ARTIFACT_MAX_EXCERPT): string {
  const chunks: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (!value.startsWith('data:') && value.length < 512) chunks.push(value)
      else if (value.length >= 512) chunks.push(value.slice(0, maxChars))
      return
    }
    if (value instanceof Uint8Array) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (['data', 'base64', 'bytes', 'image', 'binary'].includes(key.toLowerCase())) continue
        visit(entry)
      }
    }
  }
  visit(output)
  return chunks.join('\n').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

export function harnessArtifactReference(metadata: HarnessArtifactMetadata, excerpt: string): string {
  const resource = metadata.resource ? `; resource ${metadata.resource.id}`
    + (metadata.resource.revision ? ` revision ${metadata.resource.revision}` : '')
    + (metadata.resource.page ? ` page ${metadata.resource.page}` : '') : ''
  const media = metadata.mediaPartCount ? `; media parts 0-${metadata.mediaPartCount - 1}` : ''
  return `[Incomplete tool output; artifact ${metadata.artifactId}; ${metadata.toolName} call ${metadata.toolCallId}${resource}${media}. Excerpt: ${excerpt || '(no text excerpt)'}. Use harness_read_artifact for bounded text or a selected media part.]`
}

function countText(value: string): number {
  return Math.ceil(value.length / 4)
}

function base64Bytes(value: string): number {
  return Math.max(0, Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0))
}

export function estimateHarnessPromptTokens(value: unknown): number {
  if (typeof value === 'string') return countText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return 1
  if (value instanceof Uint8Array) return Math.max(1, Math.ceil(value.byteLength / 4))
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateHarnessPromptTokens(item), 0)
  if (typeof value !== 'object') return 256
  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  const mediaType = typeof record.mediaType === 'string' ? record.mediaType
    : typeof record.mimeType === 'string' ? record.mimeType : ''
  if (type === 'image' || type === 'file' && mediaType.startsWith('image/')) {
    return 8_192 + Object.entries(record).filter(([key]) => !['data', 'image', 'bytes'].includes(key))
      .reduce((sum, [key, entry]) => sum + countText(key) + estimateHarnessPromptTokens(entry), 0)
  }
  let tokens = 0
  for (const [key, entry] of Object.entries(record)) {
    tokens += countText(key)
    if (['data', 'image', 'bytes', 'base64'].includes(key.toLowerCase()) && typeof entry === 'string') {
      tokens += Math.ceil(base64Bytes(entry) / 4)
    } else {
      tokens += estimateHarnessPromptTokens(entry)
    }
  }
  return tokens
}

export function shouldExternalizeHarnessToolOutput(output: unknown): boolean {
  let hasMedia = false
  const inspect = (value: unknown) => {
    if (value instanceof Uint8Array) hasMedia = true
    else if (Array.isArray(value)) value.forEach(inspect)
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if ((record.type === 'image' || record.type === 'file')
        && typeof (record.mediaType ?? record.mimeType) === 'string'
        && String(record.mediaType ?? record.mimeType).startsWith('image/')) hasMedia = true
      Object.values(record).forEach(inspect)
    }
  }
  inspect(output)
  if (hasMedia) return true
  try {
    return serializeHarnessArtifactOutput(output).byteLength > HARNESS_ARTIFACT_MAX_INLINE_TEXT
  } catch (_error) {
    return true
  }
}

export function externalizeOlderHarnessToolResults(
  messages: LanguageModelV4Prompt,
  metadataByCallId: Map<string, HarnessArtifactMetadata>,
): LanguageModelV4Prompt {
  const lastToolResult = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role !== 'tool') continue
      for (let j = message.content.length - 1; j >= 0; j--) {
        const part = message.content[j]
        if (part.type === 'tool-result') return part.toolCallId
      }
    }
    return undefined
  })()
  return messages.map(message => {
    if (message.role !== 'tool') return message
    return { ...message, content: message.content.map(part => {
      if (part.type !== 'tool-result' || !shouldExternalizeHarnessToolOutput(part.output)) return part
      if (part.toolCallId === lastToolResult && estimateHarnessPromptTokens(part.output) <= 16_000) return part
      const metadata = metadataByCallId.get(part.toolCallId)
      if (!metadata) throw new Error('A large Harness tool result was not persisted as an artifact.')
      const excerpt = harnessToolResultText(part.output)
      return { ...part, output: { type: 'text', value: harnessArtifactReference(metadata, excerpt) } }
    }) }
  })
}

export function readHarnessArtifactText(bytes: Uint8Array, start: number, end: number): string {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
    || end - start > HARNESS_ARTIFACT_MAX_READ_CHARS) throw new Error('Harness artifact text range exceeds its bounds.')
  const content = parseHarnessArtifactOutput(bytes)
  const chunks: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === 'string' && !value.startsWith('data:')) chunks.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!['data', 'base64'].includes(key.toLowerCase()) && !(entry && typeof entry === 'object' && '__harnessBinaryPart' in entry)) visit(entry)
      }
    }
  }
  visit(content.output)
  const text = chunks.join('\n')
  const excerpt = text.slice(start, end)
  const prefix = start > 0 ? `[Incomplete: characters before ${start} were omitted.]\n` : ''
  const suffix = end < text.length ? `\n[Incomplete: more artifact text is available after character ${end}.]` : ''
  return `${prefix}${excerpt}${suffix}`
}

export function readHarnessArtifactMedia(bytes: Uint8Array, partIndex: number): { data: Uint8Array; mediaType: string } {
  if (!Number.isSafeInteger(partIndex) || partIndex < 0) throw new Error('Harness artifact media part is invalid.')
  const content = parseHarnessArtifactOutput(bytes)
  const part = content.binaryParts.find(item => item.index === partIndex)
  if (!part) throw new Error('Harness artifact media part was not found.')
  return { data: decodeBase64(part.base64), mediaType: part.mediaType }
}
