import { z } from 'zod'
import { drivePathSegments, portableDrivePathKey } from '@layernorm/overlay-agent-bridge-protocol'
import { canReadResource, rowScope, type ResourceViewer } from '@/shared/workspaces/resource-scope'
import { isOwnedFileR2Key, isOwnedOutputR2Key } from '@/shared/storage/storage-keys'

const fileRowSchema = z.object({
  _id: z.string().min(1), userId: z.string().min(1), workspaceId: z.string().optional(),
  scope: z.enum(['personal', 'workspace']).optional(), archivedAt: z.number().optional(), deletedAt: z.number().optional(),
  name: z.string(), parentId: z.string().nullable().optional(), type: z.enum(['file', 'folder']),
  kind: z.string().optional(), content: z.string().optional(), textContent: z.string().optional(),
  textInObjectStore: z.boolean().optional(), r2Key: z.string().optional(), storageId: z.string().optional(),
  mimeType: z.string().optional(), sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.number(), updatedAt: z.number().optional(),
})
type DriveRow = z.infer<typeof fileRowSchema>
export type AgentDriveScope =
  | { kind: 'personal'; workspaceId: string; ownerUserId: string }
  | { kind: 'workspace'; workspaceId: string }

/** Internal candidates only. A server materializer must hash the full source before issuing a host manifest. */
export type AgentDriveCandidate = {
  fileId: string; path: string; kind: 'file' | 'folder'; updatedAt: number; ownerUserId: string
  mimeType?: string
  source?: { kind: 'object'; key: string } | { kind: 'convex'; storageId: string; fileId: string; updatedAt: number } | { kind: 'inline'; text: string }
}

function inScope(row: DriveRow, scope: AgentDriveScope, viewer: ResourceViewer): boolean {
  if (row.workspaceId !== scope.workspaceId || row.archivedAt !== undefined || row.deletedAt !== undefined || !canReadResource(row, viewer)) return false
  return scope.kind === 'workspace' ? rowScope(row) === 'workspace'
    : rowScope(row) === 'personal' && row.userId === scope.ownerUserId && viewer.userId === scope.ownerUserId
}

function sourceFor(row: DriveRow): AgentDriveCandidate['source'] {
  if (row.textInObjectStore && !row.r2Key) throw Error('DRIVE_MISSING_CANONICAL_OBJECT')
  if (row.r2Key) {
    if (!isOwnedFileR2Key(row.userId, row.r2Key) && !isOwnedOutputR2Key(row.userId, row.r2Key)) throw Error('DRIVE_INVALID_STORAGE_OWNER')
    return { kind: 'object', key: row.r2Key }
  }
  if (row.storageId) return { kind: 'convex', storageId: row.storageId, fileId: row._id, updatedAt: row.updatedAt ?? row.createdAt }
  if ((row.kind === 'upload' || row.kind === 'output') && !row.mimeType?.startsWith('text/')) throw Error('DRIVE_MISSING_CANONICAL_OBJECT')
  return { kind: 'inline', text: row.textContent ?? row.content ?? '' }
}

/** Map canonical Files hierarchy without flattening inaccessible parents or inventing object prefixes. */
export function buildAgentDriveCandidates(input: {
  rows: unknown[]; scope: AgentDriveScope; viewer: ResourceViewer; maxEntries?: number
}): AgentDriveCandidate[] {
  const maximum = input.maxEntries ?? 10000
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error('DRIVE_LIMIT_INVALID')
  if (input.rows.length > maximum) throw Error('DRIVE_TOO_MANY_ENTRIES')
  const selected = input.rows.map(row => fileRowSchema.parse(row)).filter(row => inScope(row, input.scope, input.viewer))
  const rows = new Map<string, DriveRow>()
  for (const row of selected) {
    if (rows.has(row._id)) throw Error('DRIVE_DUPLICATE_FILE_ID')
    rows.set(row._id, row)
  }
  const paths = new Map<string, string>()
  const resolving = new Set<string>()
  const pathFor = (row: DriveRow, depth = 0): string => {
    const cached = paths.get(row._id)
    if (cached) return cached
    if (depth > 128 || resolving.has(row._id)) throw Error('DRIVE_INVALID_HIERARCHY')
    resolving.add(row._id)
    if (drivePathSegments(row.name).length !== 1) throw Error('DRIVE_UNSAFE_NAME')
    const parent = row.parentId ? rows.get(row.parentId) : undefined
    if (row.parentId && (!parent || parent.type !== 'folder')) throw Error('DRIVE_INACCESSIBLE_PARENT')
    const path = parent ? `${pathFor(parent, depth + 1)}/${row.name}` : row.name
    drivePathSegments(path)
    paths.set(row._id, path)
    resolving.delete(row._id)
    return path
  }
  const names = new Set<string>()
  return selected.map(row => {
    const path = pathFor(row)
    const key = portableDrivePathKey(path)
    if (names.has(key)) throw Error('DRIVE_AMBIGUOUS_PATH')
    names.add(key)
    return { fileId: row._id, path, kind: row.type, updatedAt: row.updatedAt ?? row.createdAt, ownerUserId: row.userId,
      ...(row.mimeType ? { mimeType: row.mimeType } : {}), ...(row.type === 'file' ? { source: sourceFor(row) } : {}) }
  }).toSorted((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}
