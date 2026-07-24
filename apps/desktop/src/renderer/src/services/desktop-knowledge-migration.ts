import {
  KNOWLEDGE_RECONCILE_EVENT,
  createKnowledgeMigrationJournal,
  resolveKnowledgeMigrationConflictName,
  rewriteKnowledgeMigrationReferences,
  type KnowledgeFile,
  type KnowledgeMigrationEntry,
  type KnowledgeMigrationJournal,
  type NoteDoc
} from '@overlay/app-core'

import { overlayDesktopAppClient } from './app-api-client'
import { registerMigratedNoteMappings } from './desktop-sync-service'

interface LocalNote {
  id: string
  title: string
  content: string
  updatedAt: number
  checksum: string
}

interface LocalAsset {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  checksum: string
  source: 'note-image' | 'document'
  documentId?: string
}

interface LocalDocument {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  createdAt: number
  checksum: string
  assetId: string
}

interface LocalInventory {
  notes: LocalNote[]
  documents: LocalDocument[]
  attachments: LocalAsset[]
}

interface MigrationAssetPayload extends LocalAsset {
  data: Uint8Array
}

export interface DesktopKnowledgeMigrationLocalPort {
  inventory(): Promise<LocalInventory>
  readAsset(assetId: string): Promise<{ dataBase64: string; asset: LocalAsset }>
  createBackup(userId: string): Promise<{ backupId: string }>
  loadJournal(userId: string): Promise<KnowledgeMigrationJournal | null>
  saveJournal(userId: string, journal: KnowledgeMigrationJournal): Promise<unknown>
}

export interface DesktopKnowledgeMigrationRemotePort {
  listNotes(): Promise<NoteDoc[]>
  listFiles(): Promise<KnowledgeFile[]>
  getNote(noteId: string): Promise<NoteDoc | null>
  getFile(fileId: string): Promise<KnowledgeFile | null>
  createNote(input: { clientId: string; title: string; content: string }): Promise<NoteDoc>
  updateNote(input: { noteId: string; title: string; content: string }): Promise<NoteDoc>
  uploadFile(
    input: MigrationAssetPayload & { clientId: string; resolvedName: string }
  ): Promise<KnowledgeFile>
}

export interface DesktopKnowledgeMigrationDependencies {
  local: DesktopKnowledgeMigrationLocalPort
  remote: DesktopKnowledgeMigrationRemotePort
  now?: () => number
  onMappingsVerified?: (
    mappings: Readonly<Record<string, string>>,
    notes: readonly LocalNote[]
  ) => void
}

export interface DesktopKnowledgeMigrationResult {
  journal: KnowledgeMigrationJournal
  migrated: number
  deduplicated: number
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(typeof value === 'string' ? new TextEncoder().encode(value) : value)
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function noteChecksum(title: string, content: string): Promise<string> {
  return sha256(`${title.trim()}\0${content}`)
}

function migrationClientId(checksum: string): string {
  return `desktop-migration:${checksum}`
}

function checksumFromMigrationClientId(clientId?: string): string | null {
  return clientId?.startsWith('desktop-migration:')
    ? clientId.slice('desktop-migration:'.length)
    : null
}

function extensionFromName(name: string): string | undefined {
  const index = name.lastIndexOf('.')
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : undefined
}

function embeddedDataAssets(notes: readonly LocalNote[]): MigrationAssetPayload[] {
  const values = new Map<string, MigrationAssetPayload>()
  const pattern = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)/gi
  for (const note of notes) {
    for (const match of note.content.matchAll(pattern)) {
      try {
        const data = base64Bytes(match[2])
        const mimeType = match[1].toLowerCase()
        const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'
        const temporaryId = `${note.id}:${match.index ?? 0}:${data.byteLength}`
        values.set(temporaryId, {
          id: temporaryId,
          name: `embedded-${note.id}-${match.index ?? 0}.${extension}`,
          mimeType,
          sizeBytes: data.byteLength,
          checksum: '',
          source: 'note-image',
          data
        })
      } catch {
        // Malformed data URLs remain in the recoverable note backup and do not
        // prevent the rest of the migration from resuming.
      }
    }
  }
  return Array.from(values.values())
}

function ensureEntry(
  journal: KnowledgeMigrationJournal,
  input: Omit<KnowledgeMigrationEntry, 'status' | 'attempts' | 'updatedAt'>,
  now: number
): KnowledgeMigrationEntry {
  const existing = journal.entries[input.key]
  if (existing?.checksum === input.checksum) return existing
  const entry: KnowledgeMigrationEntry = {
    ...input,
    status: 'pending',
    attempts: 0,
    updatedAt: now
  }
  journal.entries[input.key] = entry
  return entry
}

async function defaultRemotePort(): Promise<DesktopKnowledgeMigrationRemotePort> {
  return {
    async listNotes() {
      const notes = await overlayDesktopAppClient.notes.get<NoteDoc[]>({ limit: 250 })
      return Array.isArray(notes) ? notes : []
    },
    async listFiles() {
      const files = await overlayDesktopAppClient.files.get<KnowledgeFile[]>({ limit: 250 })
      return Array.isArray(files) ? files : []
    },
    async getNote(noteId) {
      const response = await overlayDesktopAppClient.notes.getResponse({ noteId })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Could not verify migrated note (${response.status})`)
      return (await response.json()) as NoteDoc
    },
    async getFile(fileId) {
      const response = await overlayDesktopAppClient.files.getResponse({ fileId })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Could not verify migrated file (${response.status})`)
      return (await response.json()) as KnowledgeFile
    },
    async createNote(input) {
      const response = await overlayDesktopAppClient.notes.create({
        clientId: input.clientId,
        title: input.title,
        content: input.content,
        tags: []
      })
      if (!response.note) throw new Error('The app API did not return the migrated note')
      return response.note
    },
    async updateNote(input) {
      const response = await overlayDesktopAppClient.notes.update(input)
      if (!response.note) throw new Error('The app API did not return the updated note')
      return response.note
    },
    async uploadFile(input) {
      const upload = await overlayDesktopAppClient.files.uploadUrl({
        name: input.resolvedName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes
      })
      const uploadResponse = await window.bridge.uploadToStorage({
        url: upload.uploadUrl,
        contentType: input.mimeType,
        data: Uint8Array.from(input.data).buffer
      })
      if (!uploadResponse.ok)
        throw new Error(`Could not upload migrated file (${uploadResponse.status})`)
      const created = await overlayDesktopAppClient.files.create({
        clientId: input.clientId,
        name: input.resolvedName,
        type: 'file',
        kind: 'upload',
        r2Key: upload.r2Key,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        extension: extensionFromName(input.resolvedName)
      })
      if (created.file) return created.file
      if (!created.id) throw new Error('The app API did not return the migrated file identifier')
      return await overlayDesktopAppClient.files.get({ fileId: created.id })
    }
  }
}

async function defaultDependencies(): Promise<DesktopKnowledgeMigrationDependencies> {
  return {
    local: window.bridge.knowledgeMigration,
    remote: await defaultRemotePort(),
    onMappingsVerified(mappings, notes) {
      registerMigratedNoteMappings(
        Object.fromEntries(
          notes
            .filter((note) => mappings[note.id])
            .map((note) => [note.id, { remoteId: mappings[note.id], updatedAt: note.updatedAt }])
        )
      )
    }
  }
}

export async function runDesktopKnowledgeMigration(
  userId: string,
  dependencies?: DesktopKnowledgeMigrationDependencies
): Promise<DesktopKnowledgeMigrationResult> {
  const deps = dependencies ?? (await defaultDependencies())
  const now = deps.now ?? Date.now
  const inventory = await deps.local.inventory()
  const journal =
    (await deps.local.loadJournal(userId)) ?? createKnowledgeMigrationJournal(userId, now())

  if (journal.phase === 'completed') {
    deps.onMappingsVerified?.(journal.mappings.nodes, inventory.notes)
    return { journal, migrated: 0, deduplicated: 0 }
  }

  let migrated = 0
  let deduplicated = 0
  const persist = async (): Promise<void> => {
    journal.updatedAt = now()
    await deps.local.saveJournal(userId, journal)
  }

  try {
    if (
      !journal.backupId &&
      (inventory.notes.length || inventory.documents.length || inventory.attachments.length)
    ) {
      journal.phase = 'backup'
      await persist()
      journal.backupId = (await deps.local.createBackup(userId)).backupId
      await persist()
    }

    journal.phase = 'migrating'
    journal.lastError = undefined
    await persist()

    const [remoteNotes, remoteFiles] = await Promise.all([
      deps.remote.listNotes(),
      deps.remote.listFiles()
    ])
    const occupiedNames = new Set(remoteFiles.map((file) => file.name))
    const remoteFileByChecksum = new Map<string, KnowledgeFile>()
    for (const file of remoteFiles) {
      const checksum = checksumFromMigrationClientId(file.clientId)
      if (checksum) remoteFileByChecksum.set(checksum, file)
    }

    const migrateAsset = async (
      key: string,
      localId: string,
      asset: MigrationAssetPayload,
      mappingBucket: 'nodes' | 'assets'
    ): Promise<string> => {
      const entry = ensureEntry(
        journal,
        {
          key,
          kind: mappingBucket === 'nodes' ? 'document' : 'attachment',
          localId,
          name: asset.name,
          checksum: asset.checksum
        },
        now()
      )

      const mappedId = journal.mappings[mappingBucket][localId] ?? entry.remoteId
      const mapped = mappedId ? await deps.remote.getFile(mappedId) : null
      if (mapped) {
        entry.status = 'completed'
        entry.remoteId = mapped._id
        entry.updatedAt = now()
        return mapped._id
      }

      const duplicate = remoteFileByChecksum.get(asset.checksum)
      if (duplicate) {
        entry.status = 'completed'
        entry.remoteId = duplicate._id
        entry.resolvedName = duplicate.name
        entry.updatedAt = now()
        journal.mappings[mappingBucket][localId] = duplicate._id
        deduplicated += 1
        await persist()
        return duplicate._id
      }

      entry.status = 'uploading'
      entry.attempts += 1
      entry.error = undefined
      entry.resolvedName = resolveKnowledgeMigrationConflictName(asset.name, occupiedNames)
      entry.updatedAt = now()
      await persist()
      const created = await deps.remote.uploadFile({
        ...asset,
        clientId: migrationClientId(asset.checksum),
        resolvedName: entry.resolvedName
      })
      entry.status = 'verifying'
      entry.remoteId = created._id
      entry.updatedAt = now()
      await persist()
      const verified = await deps.remote.getFile(created._id)
      if (!verified || verified.clientId !== migrationClientId(asset.checksum)) {
        throw new Error(`Remote verification failed for ${asset.name}`)
      }
      entry.status = 'completed'
      entry.updatedAt = now()
      journal.mappings[mappingBucket][localId] = verified._id
      remoteFileByChecksum.set(asset.checksum, verified)
      occupiedNames.add(verified.name)
      migrated += 1
      await persist()
      return verified._id
    }

    for (const document of inventory.documents) {
      const read = await deps.local.readAsset(document.assetId)
      await migrateAsset(
        `document:${document.id}`,
        document.id,
        {
          ...read.asset,
          checksum: document.checksum,
          data: base64Bytes(read.dataBase64)
        },
        'nodes'
      )
    }

    for (const attachment of inventory.attachments.filter(
      (asset) => asset.source === 'note-image'
    )) {
      const read = await deps.local.readAsset(attachment.id)
      await migrateAsset(
        `attachment:${attachment.id}`,
        attachment.id,
        {
          ...read.asset,
          data: base64Bytes(read.dataBase64)
        },
        'assets'
      )
    }

    for (const embedded of embeddedDataAssets(inventory.notes)) {
      embedded.checksum = await sha256(embedded.data)
      embedded.id = `embedded:${embedded.checksum}`
      await migrateAsset(`attachment:${embedded.id}`, embedded.id, embedded, 'assets')
    }

    const remoteNoteByChecksum = new Map<string, NoteDoc>()
    const remoteNoteByClientId = new Map<string, NoteDoc>()
    for (const note of remoteNotes) {
      if (note.clientId) remoteNoteByClientId.set(note.clientId, note)
      remoteNoteByChecksum.set(await noteChecksum(note.title, note.content), note)
    }
    const occupiedNoteNames = new Set(remoteNotes.map((note) => note.title))

    for (const note of inventory.notes) {
      const key = `note:${note.id}`
      const entry = ensureEntry(
        journal,
        {
          key,
          kind: 'note',
          localId: note.id,
          name: note.title,
          checksum: note.checksum
        },
        now()
      )
      const mappedId = journal.mappings.nodes[note.id] ?? entry.remoteId
      const mapped = mappedId ? await deps.remote.getNote(mappedId) : null
      const duplicate =
        mapped ?? remoteNoteByClientId.get(note.id) ?? remoteNoteByChecksum.get(note.checksum)
      if (duplicate) {
        entry.status = 'completed'
        entry.remoteId = duplicate._id
        entry.resolvedName = duplicate.title
        entry.updatedAt = now()
        journal.mappings.nodes[note.id] = duplicate._id
        remoteNoteByChecksum.set(note.checksum, duplicate)
        if (!mapped && duplicate.clientId !== note.id) deduplicated += 1
        await persist()
        continue
      }

      entry.status = 'uploading'
      entry.attempts += 1
      entry.error = undefined
      entry.resolvedName = resolveKnowledgeMigrationConflictName(note.title, occupiedNoteNames)
      entry.updatedAt = now()
      await persist()
      const created = await deps.remote.createNote({
        clientId: note.id,
        title: entry.resolvedName,
        content: note.content
      })
      entry.status = 'verifying'
      entry.remoteId = created._id
      entry.updatedAt = now()
      await persist()
      const verified = await deps.remote.getNote(created._id)
      if (
        !verified ||
        verified.clientId !== note.id ||
        (await noteChecksum(verified.title, verified.content)) !==
          (await noteChecksum(entry.resolvedName, note.content))
      ) {
        throw new Error(`Remote verification failed for ${note.title}`)
      }
      entry.status = 'completed'
      entry.updatedAt = now()
      journal.mappings.nodes[note.id] = verified._id
      remoteNoteByChecksum.set(note.checksum, verified)
      occupiedNoteNames.add(verified.title)
      migrated += 1
      await persist()
    }

    journal.phase = 'verifying'
    await persist()
    for (const note of inventory.notes) {
      const remoteId = journal.mappings.nodes[note.id]
      if (!remoteId) continue
      const rewritten = rewriteKnowledgeMigrationReferences(note.content, journal.mappings.nodes)
      if (rewritten === note.content) continue
      const entry = journal.entries[`note:${note.id}`]
      const title = entry?.resolvedName ?? note.title
      const updated = await deps.remote.updateNote({ noteId: remoteId, title, content: rewritten })
      const verified = await deps.remote.getNote(remoteId)
      if (!verified || verified.content !== rewritten || updated._id !== remoteId) {
        throw new Error(`Reference verification failed for ${note.title}`)
      }
    }

    journal.phase = 'completed'
    journal.completedAt = now()
    journal.lastError = undefined
    await persist()
    deps.onMappingsVerified?.(journal.mappings.nodes, inventory.notes)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(KNOWLEDGE_RECONCILE_EVENT, {
          detail: { reason: 'explicit-refresh' }
        })
      )
    }
    return { journal, migrated, deduplicated }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    journal.phase = 'failed'
    journal.lastError = message
    for (const entry of Object.values(journal.entries)) {
      if (entry.status === 'uploading' || entry.status === 'verifying') {
        entry.status = 'failed'
        entry.error = message
        entry.updatedAt = now()
      }
    }
    await persist()
    throw error
  }
}

let migrationPromise: Promise<DesktopKnowledgeMigrationResult> | null = null

export type DesktopKnowledgeAuthority = 'cloud' | 'migrating' | 'on-this-mac'
export const DESKTOP_KNOWLEDGE_AUTHORITY_EVENT = 'overlay:knowledge-authority-changed'
const DESKTOP_KNOWLEDGE_AUTHORITY_KEY = 'overlay-desktop-knowledge-authority-v1'

export function getDesktopKnowledgeAuthority(): DesktopKnowledgeAuthority {
  if (typeof localStorage === 'undefined') return 'migrating'
  const value = localStorage.getItem(DESKTOP_KNOWLEDGE_AUTHORITY_KEY)
  return value === 'cloud' || value === 'on-this-mac' ? value : 'migrating'
}

function setDesktopKnowledgeAuthority(authority: DesktopKnowledgeAuthority): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(DESKTOP_KNOWLEDGE_AUTHORITY_KEY, authority)
  window.dispatchEvent(new CustomEvent(DESKTOP_KNOWLEDGE_AUTHORITY_EVENT, { detail: authority }))
}

export function migrateLegacyDesktopKnowledge(
  userId: string
): Promise<DesktopKnowledgeMigrationResult> {
  if (!migrationPromise) {
    setDesktopKnowledgeAuthority('migrating')
    migrationPromise = runDesktopKnowledgeMigration(userId)
      .then((result) => {
        setDesktopKnowledgeAuthority('cloud')
        return result
      })
      .catch((error) => {
        setDesktopKnowledgeAuthority('on-this-mac')
        throw error
      })
      .finally(() => {
        migrationPromise = null
      })
  }
  return migrationPromise
}
