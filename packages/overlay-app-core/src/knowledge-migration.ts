export const KNOWLEDGE_MIGRATION_VERSION = 1 as const

export type KnowledgeMigrationEntityKind = 'note' | 'document' | 'attachment'
export type KnowledgeMigrationEntryStatus =
  | 'pending'
  | 'uploading'
  | 'verifying'
  | 'completed'
  | 'failed'

export interface KnowledgeMigrationEntry {
  key: string
  kind: KnowledgeMigrationEntityKind
  localId: string
  name: string
  checksum: string
  status: KnowledgeMigrationEntryStatus
  attempts: number
  remoteId?: string
  resolvedName?: string
  error?: string
  updatedAt: number
}

export interface KnowledgeMigrationJournal {
  version: typeof KNOWLEDGE_MIGRATION_VERSION
  userId: string
  phase: 'inventory' | 'backup' | 'migrating' | 'verifying' | 'completed' | 'failed'
  startedAt: number
  updatedAt: number
  completedAt?: number
  backupId?: string
  entries: Record<string, KnowledgeMigrationEntry>
  mappings: {
    nodes: Record<string, string>
    assets: Record<string, string>
  }
  lastError?: string
}

export function normalizedKnowledgeMigrationName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function resolveKnowledgeMigrationConflictName(
  requestedName: string,
  occupiedNames: Iterable<string>,
  suffix = 'On this Mac',
): string {
  const occupied = new Set(Array.from(occupiedNames, normalizedKnowledgeMigrationName))
  if (!occupied.has(normalizedKnowledgeMigrationName(requestedName))) return requestedName

  const dot = requestedName.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < requestedName.length - 1
  const stem = hasExtension ? requestedName.slice(0, dot) : requestedName
  const extension = hasExtension ? requestedName.slice(dot) : ''
  let index = 1
  while (true) {
    const counter = index === 1 ? '' : ` ${index}`
    const candidate = `${stem} (${suffix}${counter})${extension}`
    if (!occupied.has(normalizedKnowledgeMigrationName(candidate))) return candidate
    index += 1
  }
}

function replaceEncodedId(content: string, prefix: string, localId: string, remoteId: string): string {
  const encodedLocalId = encodeURIComponent(localId)
  const encodedRemoteId = encodeURIComponent(remoteId)
  return content
    .split(`${prefix}${localId}`)
    .join(`${prefix}${remoteId}`)
    .split(`${prefix}${encodedLocalId}`)
    .join(`${prefix}${encodedRemoteId}`)
}

/**
 * Rewrites the stable note/file reference forms emitted by Overlay without
 * touching ordinary prose that happens to contain a local identifier.
 */
export function rewriteKnowledgeMigrationReferences(
  content: string,
  mappings: Readonly<Record<string, string>>,
): string {
  let rewritten = content
  for (const [localId, remoteId] of Object.entries(mappings)) {
    rewritten = replaceEncodedId(rewritten, 'overlay-note://', localId, remoteId)
    rewritten = replaceEncodedId(rewritten, 'overlay://note/', localId, remoteId)
    rewritten = replaceEncodedId(rewritten, 'overlay-file://', localId, remoteId)
    rewritten = replaceEncodedId(rewritten, 'overlay://file/', localId, remoteId)
    rewritten = replaceEncodedId(rewritten, '?note=', localId, remoteId)
    rewritten = replaceEncodedId(rewritten, '&note=', localId, remoteId)
    rewritten = rewritten
      .split(`data-note-id="${localId}"`)
      .join(`data-note-id="${remoteId}"`)
      .split(`data-file-id="${localId}"`)
      .join(`data-file-id="${remoteId}"`)
  }
  return rewritten
}

export function createKnowledgeMigrationJournal(userId: string, now = Date.now()): KnowledgeMigrationJournal {
  return {
    version: KNOWLEDGE_MIGRATION_VERSION,
    userId,
    phase: 'inventory',
    startedAt: now,
    updatedAt: now,
    entries: {},
    mappings: { nodes: {}, assets: {} },
  }
}
