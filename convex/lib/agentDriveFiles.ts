import { ConvexError } from 'convex/values'
import { drivePathSegments, portableDrivePathKey } from '../../packages/overlay-agent-bridge-protocol/src/drive-path'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { canEditResource, rowScope } from '../../src/shared/workspaces/resource-scope'
import { internal } from '../_generated/api'
import type { requireDriveAuthority } from '../agents/agentDrive'

export type Authority = Awaited<ReturnType<typeof requireDriveAuthority>>

export function safeName(name: string) {
  try { if (drivePathSegments(name).length === 1) return } catch { /* Convert the shared wire validator's failure to application data. */ }
  throw new ConvexError('DRIVE_UNSAFE_PATH')
}
export function inScope(row: Doc<'files'>, authority: Authority) {
  const { scope } = authority
  return row.workspaceId === scope.workspaceId && rowScope(row) === scope.kind
    && (scope.kind === 'workspace' || row.userId === scope.ownerUserId)
    && row.archivedAt === undefined && row.deletedAt === undefined
}
export function writable(row: Doc<'files'>, authority: Authority) {
  if (!inScope(row, authority) || !canEditResource(row, authority.scopeContext.viewer)) throw new ConvexError('DRIVE_EDIT_DENIED')
}
export async function requireParent(ctx: MutationCtx, parentId: Id<'files'> | undefined, authority: Authority, name: string, movingId?: Id<'files'>) {
  const visited = new Set<string>()
  let id: string | undefined = parentId
  let pathLength = name.length
  for (let depth = 0; id !== undefined; depth++) {
    if (depth >= 64 || id === movingId || visited.has(id)) throw new ConvexError('DRIVE_UNSAFE_PATH')
    visited.add(id)
    const normalized = ctx.db.normalizeId('files', id)
    const row = normalized ? await ctx.db.get(normalized) : null
    if (!row || row.type !== 'folder') throw new ConvexError('DRIVE_SOURCE_CHANGED')
    writable(row, authority)
    pathLength += row.name.length + 1
    if (pathLength > 4096) throw new ConvexError('DRIVE_UNSAFE_PATH')
    id = row.parentId
  }
}
export async function children(ctx: MutationCtx, parentId: Id<'files'>) {
  const rows = await ctx.db.query('files').withIndex('by_parentId', q => q.eq('parentId', parentId)).take(10001)
  if (rows.length > 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
  return rows.filter(row => row.deletedAt === undefined && row.archivedAt === undefined)
}
export async function requireVacantName(ctx: MutationCtx, authority: Authority, name: string, parentId?: Id<'files'>, except?: Id<'files'>) {
  // Root names must be checked across the fixed scope, including other owners' shared files.
  const { scope } = authority
  const rows = parentId !== undefined ? await children(ctx, parentId)
    : scope.kind === 'personal'
      ? await ctx.db.query('files').withIndex('by_workspaceId_userId_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('userId', scope.ownerUserId).eq('archivedAt', undefined)).take(10001)
      : await ctx.db.query('files').withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined)).take(10001)
  if (rows.length > 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
  if (rows.some(row => row._id !== except && row.parentId === parentId && inScope(row, authority) && portableDrivePathKey(row.name) === portableDrivePathKey(name))) throw new ConvexError('DRIVE_PATH_CONFLICT')
}


export async function requireFilePath(ctx: MutationCtx, file: Doc<'files'>, authority: Authority, expectedPath: string) {
  const names = [file.name]; const parents = new Set<string>([file._id]); let parentId = file.parentId
  while (parentId !== undefined) {
    if (parents.size >= 64 || parents.has(parentId)) throw new ConvexError('DRIVE_SOURCE_CHANGED')
    parents.add(parentId)
    const normalized = ctx.db.normalizeId('files', parentId)
    const parent = normalized ? await ctx.db.get(normalized) : null
    if (!parent || parent.type !== 'folder' || !inScope(parent, authority)) throw new ConvexError('DRIVE_SOURCE_CHANGED')
    names.unshift(parent.name); parentId = parent.parentId
  }
  if (names.join('/') !== expectedPath) throw new ConvexError('DRIVE_SOURCE_CHANGED')
}

export async function promoteDriveDuplicate(ctx: MutationCtx, file: Doc<'files'>, updatedAt: number) {
  if (!file.duplicateOfFileId) {
    const duplicates = await ctx.db.query('files').withIndex('by_duplicateOfFileId', q => q.eq('duplicateOfFileId', file._id)).take(10001)
    if (duplicates.length > 10000) throw new ConvexError('DRIVE_TOO_MANY_ENTRIES')
    const active = duplicates.filter(row => row.userId === file.userId && row.deletedAt === undefined)
    const [promoted, ...rest] = active
    if (promoted) {
      await ctx.db.patch(promoted._id, { duplicateOfFileId: undefined, indexStatus: 'pending', updatedAt: Math.max(updatedAt, promoted.updatedAt + 1) })
      for (const duplicate of rest) await ctx.db.patch(duplicate._id, { duplicateOfFileId: promoted._id, updatedAt: Math.max(updatedAt, duplicate.updatedAt + 1) })
      await ctx.scheduler.runAfter(0, internal.knowledge.knowledge.reindexFileInternal, { fileId: promoted._id })
    }
  }
}
