import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'

import {
  KNOWLEDGE_MIGRATION_VERSION,
  type KnowledgeMigrationJournal,
} from '@overlay/app-core'

export interface LegacyKnowledgeNote {
  id: string
  title: string
  content: string
  updatedAt: number
  checksum: string
}

export interface LegacyKnowledgeAsset {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  checksum: string
  source: 'note-image' | 'document'
  documentId?: string
}

export interface LegacyKnowledgeDocument {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  createdAt: number
  checksum: string
  assetId: string
}

export interface LegacyKnowledgeInventory {
  notes: LegacyKnowledgeNote[]
  documents: LegacyKnowledgeDocument[]
  attachments: LegacyKnowledgeAsset[]
}

interface StoredAsset extends LegacyKnowledgeAsset {
  path: string
}

function checksumBytes(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function mimeTypeForName(name: string): string {
  const extension = extname(name).toLowerCase()
  const values: Record<string, string> = {
    '.avif': 'image/avif',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.md': 'text/markdown',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return values[extension] ?? 'application/octet-stream'
}

function safeName(value: string): string {
  const normalized = basename(value).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180)
  return normalized || 'Untitled'
}

function readNote(path: string, fallbackId: string): LegacyKnowledgeNote | null {
  try {
    const raw = readFileSync(path, 'utf8')
    const match = raw.match(/^---\n([\s\S]*?)\n---\n/)
    if (!match) return null
    const metadata = JSON.parse(match[1]) as { id?: string; title?: string; updatedAt?: number }
    const content = raw.slice(match[0].length)
    const id = metadata.id?.trim() || fallbackId
    const title = metadata.title?.trim() || 'Untitled'
    return {
      id,
      title,
      content,
      updatedAt: metadata.updatedAt ?? statSync(path).mtimeMs,
      checksum: checksumBytes(`${title.trim()}\0${content}`),
    }
  } catch {
    return null
  }
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  visit(root)
  return files
}

export class KnowledgeMigrationStore {
  private readonly notesRoot: string
  private readonly migrationRoot: string
  private readonly documentRoots: string[]

  constructor(private readonly userDataRoot: string) {
    this.notesRoot = resolve(userDataRoot, 'notes')
    this.migrationRoot = resolve(userDataRoot, 'knowledge-migration', 'v1')
    this.documentRoots = [
      resolve(userDataRoot, 'documents'),
      resolve(userDataRoot, 'indexed-documents'),
      resolve(userDataRoot, 'knowledge', 'documents'),
    ]
  }

  inventory(): LegacyKnowledgeInventory {
    const notes = existsSync(this.notesRoot)
      ? readdirSync(this.notesRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
          .map((entry) => readNote(join(this.notesRoot, entry.name), entry.name.slice(0, -3)))
          .filter((note): note is LegacyKnowledgeNote => Boolean(note))
          .sort((left, right) => left.id.localeCompare(right.id))
      : []

    const storedAssets = this.storedAssets()
    const documentAssets = storedAssets.filter((asset) => asset.source === 'document')
    const documents = documentAssets.map((asset) => ({
      id: asset.documentId ?? `document:${asset.checksum}`,
      name: asset.name,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      createdAt: statSync(asset.path).birthtimeMs || statSync(asset.path).mtimeMs,
      checksum: asset.checksum,
      assetId: asset.id,
    }))

    return {
      notes,
      documents,
      attachments: storedAssets.map(({ path: _path, ...asset }) => asset),
    }
  }

  readAsset(assetId: string): { dataBase64: string; asset: LegacyKnowledgeAsset } {
    const stored = this.storedAssets().find((asset) => asset.id === assetId)
    if (!stored) throw new Error('Migration asset was not found in the verified inventory')
    const { path, ...asset } = stored
    return { dataBase64: readFileSync(path).toString('base64'), asset }
  }

  createBackup(userId: string): { backupId: string; createdAt: number; itemCount: number } {
    const createdAt = Date.now()
    const backupId = `${createdAt}-${randomUUID()}`
    const userKey = checksumBytes(userId).slice(0, 24)
    const backupRoot = resolve(this.migrationRoot, 'backups', userKey, backupId)
    mkdirSync(backupRoot, { recursive: true })

    let itemCount = 0
    if (existsSync(this.notesRoot)) {
      cpSync(this.notesRoot, join(backupRoot, 'notes'), { recursive: true, errorOnExist: true })
      itemCount += walkFiles(this.notesRoot).length
    }
    const documentsRoot = join(backupRoot, 'documents')
    for (const asset of this.storedAssets().filter((entry) => entry.source === 'document')) {
      mkdirSync(documentsRoot, { recursive: true })
      copyFileSync(asset.path, join(documentsRoot, `${asset.checksum.slice(0, 12)}-${safeName(asset.name)}`))
      itemCount += 1
    }

    writeFileSync(
      join(backupRoot, 'manifest.json'),
      JSON.stringify({ version: KNOWLEDGE_MIGRATION_VERSION, backupId, createdAt, itemCount }, null, 2),
      'utf8',
    )
    return { backupId, createdAt, itemCount }
  }

  loadJournal(userId: string): KnowledgeMigrationJournal | null {
    const path = this.journalPath(userId)
    if (!existsSync(path)) return null
    try {
      const journal = JSON.parse(readFileSync(path, 'utf8')) as KnowledgeMigrationJournal
      if (journal.version !== KNOWLEDGE_MIGRATION_VERSION || journal.userId !== userId) return null
      return journal
    } catch {
      return null
    }
  }

  saveJournal(userId: string, journal: KnowledgeMigrationJournal): void {
    if (journal.version !== KNOWLEDGE_MIGRATION_VERSION || journal.userId !== userId) {
      throw new Error('Migration journal does not match the active user')
    }
    const path = this.journalPath(userId)
    mkdirSync(resolve(path, '..'), { recursive: true })
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, path)
  }

  private journalPath(userId: string): string {
    const userKey = checksumBytes(userId).slice(0, 24)
    return resolve(this.migrationRoot, 'journals', `${userKey}.json`)
  }

  private storedAssets(): StoredAsset[] {
    const values: StoredAsset[] = []
    const seenChecksums = new Set<string>()
    const add = (path: string, source: StoredAsset['source']): void => {
      const resolvedPath = resolve(path)
      const permitted =
        resolvedPath.startsWith(`${this.notesRoot}/`) ||
        this.documentRoots.some((root) => resolvedPath.startsWith(`${root}/`))
      if (!permitted || !existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) return
      const bytes = readFileSync(resolvedPath)
      const checksum = checksumBytes(bytes)
      if (seenChecksums.has(`${source}:${checksum}`)) return
      seenChecksums.add(`${source}:${checksum}`)
      const name = basename(resolvedPath)
      values.push({
        id: `asset:${checksumBytes(`${source}:${relative(this.userDataRoot, resolvedPath)}`).slice(0, 32)}`,
        name,
        mimeType: mimeTypeForName(name),
        sizeBytes: bytes.byteLength,
        checksum,
        source,
        documentId: source === 'document' ? `document:${checksum}` : undefined,
        path: resolvedPath,
      })
    }

    for (const path of walkFiles(join(this.notesRoot, 'images'))) add(path, 'note-image')
    for (const root of this.documentRoots) {
      for (const path of walkFiles(root)) add(path, 'document')
    }
    return values.sort((left, right) => left.id.localeCompare(right.id))
  }
}
