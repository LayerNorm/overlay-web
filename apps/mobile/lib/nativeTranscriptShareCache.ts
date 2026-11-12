import { Directory, File, Paths } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import * as Sharing from 'expo-sharing'
import { MAX_TRANSCRIPT_FILENAME_LENGTH, MAX_TRANSCRIPT_TEXT_LENGTH } from './nativeChatTranscriptActions'

export const NATIVE_TRANSCRIPT_SHARE_RETENTION_MS = 24 * 60 * 60 * 1_000
export const NATIVE_TRANSCRIPT_SHARE_MAX_FILES = 8

const CACHE_DIRECTORY = 'native-transcript-share-cache'
const OWNED_DIRECTORY_PREFIX = 'native-transcript-'
const OWNED_DIRECTORY_PATTERN = /^native-transcript-([a-z0-9]+)-[A-Za-z0-9_-]{16,200}$/

export interface NativeTranscriptShareFile {
  name: string
  uri: string
  create(options?: { intermediates?: boolean; overwrite?: boolean }): void
  write(text: string, options?: { encoding?: 'utf8' | 'base64' }): void
  delete(): void
}

export interface NativeTranscriptShareDirectory {
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void
  list(): readonly { name: string; delete(): void }[]
  createArtifactDirectory(name: string): NativeTranscriptShareArtifactDirectory
}

export interface NativeTranscriptShareArtifactDirectory {
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void
  createFile(name: string): NativeTranscriptShareFile
  delete(): void
}

export interface NativeTranscriptShareAdapters {
  isAvailable(): Promise<boolean>
  getDirectory(): NativeTranscriptShareDirectory
  share(uri: string): Promise<void>
  now(): number
  createId(): string
}

export class NativeTranscriptShareUnavailableError extends Error {
  constructor() {
    super('Text sharing is unavailable')
    this.name = 'NativeTranscriptShareUnavailableError'
  }
}

export class NativeTranscriptShareScopeExpiredError extends Error {
  constructor() {
    super('Transcript scope expired before sharing')
    this.name = 'NativeTranscriptShareScopeExpiredError'
  }
}

function safeBasename(value: string): string {
  const segment = value.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = segment.normalize('NFKC').replace(/[^A-Za-z0-9._ ()-]/g, '_').replace(/\.\.+/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '').slice(0, MAX_TRANSCRIPT_FILENAME_LENGTH - 4)
  const basename = cleaned || 'response'
  return basename.toLowerCase().endsWith('.txt') ? basename : `${basename}.txt`
}

function generatedDirectoryName(now: number, id: string): string {
  const safeId = id.replace(/-/g, '_')
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(safeId)) throw new Error('Invalid transcript share artifact id')
  return `${OWNED_DIRECTORY_PREFIX}${Math.max(0, Math.floor(now)).toString(36)}-${safeId}`
}

function artifactTimestamp(name: string): number | null {
  const match = OWNED_DIRECTORY_PATTERN.exec(name)
  if (!match) return null
  const timestamp = Number.parseInt(match[1]!, 36)
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
}

function pruneOwnedArtifacts(directory: NativeTranscriptShareDirectory, now: number): void {
  const owned = directory.list().flatMap((artifactDirectory) => {
    const timestamp = artifactTimestamp(artifactDirectory.name)
    return timestamp === null ? [] : [{ artifactDirectory, timestamp }]
  }).sort((left, right) => left.timestamp - right.timestamp)
  const retained: typeof owned = []
  for (const entry of owned) {
    if (now - entry.timestamp > NATIVE_TRANSCRIPT_SHARE_RETENTION_MS) {
      entry.artifactDirectory.delete()
    } else {
      retained.push(entry)
    }
  }
  while (retained.length >= NATIVE_TRANSCRIPT_SHARE_MAX_FILES) retained.shift()!.artifactDirectory.delete()
}

export async function shareNativeTranscriptText(input: {
  filename: string
  text: string
  isCurrent: () => boolean
  adapters: NativeTranscriptShareAdapters
}): Promise<void> {
  if (typeof input.text !== 'string' || input.text.length === 0 || input.text.length > MAX_TRANSCRIPT_TEXT_LENGTH) {
    throw new Error('Transcript text is outside the supported size limit')
  }
  const available = await input.adapters.isAvailable()
  if (!available) throw new NativeTranscriptShareUnavailableError()
  if (!input.isCurrent()) throw new NativeTranscriptShareScopeExpiredError()

  const directory = input.adapters.getDirectory()
  directory.create({ intermediates: true, idempotent: true })
  const now = input.adapters.now()
  pruneOwnedArtifacts(directory, now)
  const artifactDirectory = directory.createArtifactDirectory(generatedDirectoryName(now, input.adapters.createId()))
  let createdDirectory = false
  try {
    artifactDirectory.create({ intermediates: true, idempotent: false })
    createdDirectory = true
    const file = artifactDirectory.createFile(safeBasename(input.filename))
    file.create({ intermediates: true, overwrite: false })
    file.write(input.text, { encoding: 'utf8' })
    if (!input.isCurrent()) throw new NativeTranscriptShareScopeExpiredError()
    await input.adapters.share(file.uri)
  } catch (error) {
    if (createdDirectory) {
      try {
        artifactDirectory.delete()
      } catch {
        // Keep the original share error.
      }
    }
    throw error
  }
}

export const nativeTranscriptShareAdapters: NativeTranscriptShareAdapters = {
  isAvailable: () => Sharing.isAvailableAsync(),
  getDirectory: () => {
    const directory = new Directory(Paths.cache, CACHE_DIRECTORY)
    return {
      create: (options) => directory.create(options),
      list: () => directory.list().flatMap((entry) => entry instanceof Directory ? [{ name: entry.name, delete: () => entry.delete() }] : []),
      createArtifactDirectory: (name) => {
        const artifactDirectory = new Directory(directory, name)
        return {
          create: (options) => artifactDirectory.create(options),
          createFile: (fileName) => new File(artifactDirectory, fileName),
          delete: () => artifactDirectory.delete(),
        }
      },
    }
  },
  share: (uri) => Sharing.shareAsync(uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: 'Share transcript text' }),
  now: () => Date.now(),
  createId: () => Crypto.randomUUID(),
}
