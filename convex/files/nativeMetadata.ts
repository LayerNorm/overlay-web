import { ConvexError, v } from 'convex/values'
import { accessRoleAllows, type ResourceAction } from '@overlay/authz-contracts'
import { DEFAULT_WORKSPACE_POLICY } from '@overlay/workspace-contracts'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability, requireNativeDeploymentFeature } from '../lib/nativeCapabilities'
import { scopeContextLoader, planMove, planArchive, planRestore } from '../lib/resourceScope'
import { rowInView } from '../../src/shared/workspaces/resource-scope'

const MAX_ROWS = 500
const MAX_GRANTS = 100
const resourceArgs = { workspaceId: v.string(), fileId: v.id('files') }
const revisionArgs = { ...resourceArgs, expectedUpdatedAt: v.number() }
type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>

// Metadata never carries stored bytes, storage keys, provider URLs, or credentials.
function metadata(file: Doc<'files'>) {
  return {
    _id: file._id, workspaceId: file.workspaceId, userId: file.userId,
    name: file.name, type: file.type, kind: file.kind ?? (file.type === 'folder' ? 'folder' : 'upload'),
    parentId: file.parentId ?? null, scope: file.scope ?? 'personal' as const,
    archivedAt: file.archivedAt, archivedFromScope: file.archivedFromScope,
    createdAt: file.createdAt, updatedAt: file.updatedAt,
    mimeType: file.mimeType, extension: file.extension, sizeBytes: file.sizeBytes,
    isStorageBacked: Boolean(file.storageId || file.r2Key), textInObjectStore: file.textInObjectStore,
    modelId: file.modelId, outputType: file.outputType, outputStatus: file.outputStatus,
    shareVisibility: file.shareVisibility ?? 'private' as const,
  }
}

async function granted(ctx: QueryCtx, userId: string, file: Doc<'files'>, action: ResourceAction) {
  if (file.userId === userId) return true
  const grants = await ctx.db.query('authorizationResourceGrants')
    .withIndex('by_resource', q => q.eq('resourceType', 'file').eq('resourceId', file._id)).take(MAX_GRANTS)
  if (grants.length === MAX_GRANTS) return false
  const memberships = await ctx.db.query('authorizationGroupMemberships')
    .withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_GRANTS)
  const direct = await ctx.db.query('authorizationUserRoles')
    .withIndex('by_userId', q => q.eq('userId', userId)).take(MAX_GRANTS)
  if (memberships.length === MAX_GRANTS || direct.length === MAX_GRANTS) return false
  const groups = new Set<string>()
  const roles = new Set(direct.map(row => row.roleId))
  for (const membership of memberships) {
    const group = await ctx.db.query('authorizationGroups').withIndex('by_groupId', q => q.eq('groupId', membership.groupId)).unique()
    if (!group || group.archivedAt !== undefined) continue
    groups.add(group.groupId)
    const assignments = await ctx.db.query('authorizationGroupRoles').withIndex('by_groupId', q => q.eq('groupId', group.groupId)).take(MAX_GRANTS)
    if (assignments.length === MAX_GRANTS) return false
    for (const assignment of assignments) roles.add(assignment.roleId)
    if (roles.size >= MAX_GRANTS) return false
  }
  const activeRoles = new Set<string>()
  for (const roleId of roles) {
    const role = await ctx.db.query('authorizationRoles').withIndex('by_roleId', q => q.eq('roleId', roleId)).unique()
    if (role && role.archivedAt === undefined) activeRoles.add(roleId)
  }
  return grants.some(grant => accessRoleAllows(grant.accessRole, action) && (
    grant.principalType === 'user' ? grant.principalId === userId
      : grant.principalType === 'group' ? groups.has(grant.principalId) : activeRoles.has(grant.principalId)
  ))
}

async function readable(ctx: QueryCtx, viewer: Viewer, file: Doc<'files'> | null) {
  return file && file.deletedAt === undefined && file.workspaceId === viewer.workspaceId
    && await scopeContextLoader(ctx, viewer.userId).canRead(file)
    && await granted(ctx, viewer.userId, file, 'view') ? file : null
}

export const list = query({
  args: { workspaceId: v.string(), view: v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived')) },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeDeploymentFeature(ctx, 'files', args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'files.read')
    const mine = args.view === 'workspace' ? [] : await ctx.db.query('files')
      .withIndex('by_workspaceId_userId_archivedAt', q => q.eq('workspaceId', args.workspaceId).eq('userId', viewer.userId)).take(MAX_ROWS + 1)
    const shared = args.view === 'personal' ? [] : await ctx.db.query('files')
      .withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', args.workspaceId).eq('scope', 'workspace')).take(MAX_ROWS + 1)
    const scope = await scopeContextLoader(ctx, viewer.userId).load(args.workspaceId)
    const rows = new Map([...mine, ...shared].map(row => [row._id, row]))
    const nodes = []
    for (const row of rows.values()) {
      if (rowInView(row, args.view, scope.viewer) && await readable(ctx, viewer, row)) nodes.push(metadata(row))
    }
    return { nodes, truncated: mine.length > MAX_ROWS || shared.length > MAX_ROWS }
  },
})

export const detail = query({
  args: resourceArgs,
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeDeploymentFeature(ctx, 'files', args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'files.read')
    const row = await readable(ctx, viewer, await ctx.db.get(args.fileId))
    return row ? metadata(row) : null
  },
})

async function writable(ctx: MutationCtx, args: { workspaceId: string; fileId: Id<'files'>; expectedUpdatedAt: number }, capability: 'files.edit' | 'files.share') {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  await requireNativeDeploymentFeature(ctx, 'files', args.workspaceId)
  await requireNativeCapability(ctx, viewer.userId, capability)
  const row = await readable(ctx, viewer, await ctx.db.get(args.fileId))
  if (!row || !(await granted(ctx, viewer.userId, row, capability === 'files.share' ? 'share' : 'edit'))) throw new Error('FILE_ACCESS_DENIED')
  if (row.updatedAt !== args.expectedUpdatedAt) throw new ConvexError('FILE_REVISION_CONFLICT')
  const bucket = 'native-files:write:user'
  const bucketKey = `${bucket}:${viewer.userId}`
  const now = Date.now()
  const window = await ctx.db.query('rateLimitWindows').withIndex('by_bucketKey', q => q.eq('bucketKey', bucketKey)).unique()
  if (window && window.resetAt > now && window.count >= 300) throw new Error('RATE_LIMITED')
  const value = { bucket, bucketKey, count: window && window.resetAt > now ? window.count + 1 : 1,
    resetAt: window && window.resetAt > now ? window.resetAt : now + 600_000, updatedAt: now }
  if (window) await ctx.db.patch(window._id, value)
  else await ctx.db.insert('rateLimitWindows', value)
  return { viewer, row, now: Math.max(now, row.updatedAt + 1) }
}

async function audit(ctx: MutationCtx, viewer: Viewer, fileId: Id<'files'>, action: string) {
  await ctx.db.insert('auditEvents', { eventId: crypto.randomUUID(), actorType: 'user', actorUserId: viewer.userId,
    action, resourceType: 'files', resourceId: fileId, outcome: 'success',
    metadataJson: JSON.stringify({ workspaceId: viewer.workspaceId }), createdAt: Date.now() })
}

export const rename = mutation({
  args: { ...revisionArgs, name: v.string() },
  handler: async (ctx, args) => {
    const { viewer, row, now } = await writable(ctx, args, 'files.edit')
    const name = args.name.trim()
    if (!name || name.length > 255 || /[\u0000-\u001f]/.test(name)) throw new Error('INVALID_FILE_NAME')
    const dot = name.lastIndexOf('.')
    await ctx.db.patch(row._id, { name, extension: dot > 0 ? name.slice(dot + 1).toLowerCase() || undefined : undefined, updatedAt: now })
    await audit(ctx, viewer, row._id, 'file.rename')
    return metadata({
      ...row,
      name,
      extension: dot > 0 ? name.slice(dot + 1).toLowerCase() || undefined : undefined,
      updatedAt: now,
    })
  },
})

export const move = mutation({
  args: { ...revisionArgs, parentId: v.union(v.id('files'), v.null()) },
  handler: async (ctx, args) => {
    const { viewer, row, now } = await writable(ctx, args, 'files.edit')
    if (row.archivedAt !== undefined) throw new Error('FILE_ARCHIVED')
    const seen = new Set<string>([row._id])
    let parentId = args.parentId
    while (parentId) {
      if (seen.has(parentId) || seen.size > MAX_ROWS) throw new Error('FILE_PARENT_CYCLE')
      seen.add(parentId)
      const parent = await ctx.db.get(parentId)
      if (!parent || parent.workspaceId !== row.workspaceId || parent.userId !== row.userId
        || parent.type !== 'folder' || parent.deletedAt !== undefined || parent.archivedAt !== undefined
        || (parent.scope ?? 'personal') !== (row.scope ?? 'personal')) throw new Error('FILE_PARENT_DENIED')
      parentId = parent.parentId ? ctx.db.normalizeId('files', parent.parentId) : null
      if (parent.parentId && !parentId) throw new Error('FILE_PARENT_DENIED')
    }
    await ctx.db.patch(row._id, { parentId: args.parentId ?? undefined, updatedAt: now })
    await audit(ctx, viewer, row._id, 'file.move')
    return metadata({ ...row, parentId: args.parentId ?? undefined, updatedAt: now })
  },
})

async function subtree(ctx: MutationCtx, root: Doc<'files'>) {
  const rows = [root]
  const seen = new Set<string>([root._id])
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.type !== 'folder') continue
    const children = await ctx.db.query('files').withIndex('by_parentId', q => q.eq('parentId', row._id)).take(MAX_ROWS + 1)
    if (children.length > MAX_ROWS) throw new Error('FILE_SUBTREE_TOO_LARGE')
    for (const child of children) {
      if (child.deletedAt !== undefined) continue
      if (child.workspaceId !== root.workspaceId || child.userId !== root.userId
        || (child.scope ?? 'personal') !== (root.scope ?? 'personal') || seen.has(child._id)) {
        throw new Error('FILE_SUBTREE_DENIED')
      }
      rows.push(child)
      seen.add(child._id)
      if (rows.length > MAX_ROWS) throw new Error('FILE_SUBTREE_TOO_LARGE')
    }
  }
  return rows
}

export const changeScope = mutation({
  args: { ...revisionArgs, action: v.union(v.literal('move'), v.literal('archive'), v.literal('restore')),
    to: v.optional(v.union(v.literal('personal'), v.literal('workspace'))) },
  handler: async (ctx, args) => {
    const { viewer, row, now } = await writable(ctx, args, 'files.edit')
    const rows = await subtree(ctx, row)
    if (args.action === 'move') {
      if (!args.to) throw new Error('SCOPE_REQUIRED')
      const plan = await planMove(ctx, { kind: 'content', row, to: args.to, userId: viewer.userId })
      if (!plan.ok) throw new Error(plan.reason)
      // Scope moves detach the root from a folder in the previous scope.
      for (const child of rows) if (child.archivedAt === undefined) {
        await ctx.db.patch(child._id, { ...plan.patch, ...(child._id === row._id ? { parentId: undefined } : {}), updatedAt: Math.max(now, child.updatedAt + 1) })
      }
    } else if (args.action === 'archive') {
      const plan = await planArchive(ctx, { row, userId: viewer.userId, now })
      if (!plan.ok) throw new Error(plan.reason)
      for (const child of rows) if (child.archivedAt === undefined) {
        await ctx.db.patch(child._id, { ...plan.patch, archivedFromScope: child.scope ?? 'personal', updatedAt: Math.max(now, child.updatedAt + 1) })
      }
    } else {
      const plan = await planRestore(ctx, { row, userId: viewer.userId })
      if (!plan.ok) throw new Error(plan.reason)
      for (const child of rows) if (child.archivedAt === row.archivedAt) {
        await ctx.db.patch(child._id, { scope: child.archivedFromScope ?? child.scope ?? 'personal', archivedAt: undefined,
          archivedBy: undefined, archivedFromScope: undefined, updatedAt: Math.max(now, child.updatedAt + 1) })
      }
    }
    await audit(ctx, viewer, row._id, `resource.${args.action}`)
    const updated = await ctx.db.get(row._id)
    return updated ? metadata(updated) : null
  },
})

export const setShare = mutation({
  args: { ...revisionArgs, visibility: v.union(v.literal('private'), v.literal('public')) },
  handler: async (ctx, args) => {
    const { viewer, row, now } = await writable(ctx, args, 'files.share')
    if (row.userId !== viewer.userId || row.type === 'folder') throw new Error('FILE_SHARE_DENIED')
    const policy = await ctx.db.query('workspaceSharingPolicies').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
    if (args.visibility === 'public' && !(policy?.publicLinksEnabled ?? DEFAULT_WORKSPACE_POLICY.publicLinksEnabled)) throw new Error('PUBLIC_LINKS_DISABLED')
    const token = args.visibility === 'public' && row.shareToken ? row.shareToken : crypto.randomUUID().replaceAll('-', '')
    await ctx.db.patch(row._id, { shareVisibility: args.visibility, shareToken: token, updatedAt: now,
      ...(args.visibility === 'public' ? { sharedAt: now } : {}) })
    await audit(ctx, viewer, row._id, 'file.share')
    return { visibility: args.visibility }
  },
})
