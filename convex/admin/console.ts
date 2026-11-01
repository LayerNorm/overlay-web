import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import {
  requireAdminSecret,
  requireOperator,
  type AdministrativeRole,
} from '../lib/auth'
import { growthCountFields } from '../lib/growthSchema'
import { addDays } from '../platform/growth'

// Stage 2 operator surface (docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md).
// Every function requires ADMIN_API_SECRET plus the caller's WorkOS identity
// resolving to an active administrativePrincipals row — the web app's
// INTERNAL_API_SECRET cannot call any of these. Each write records its own
// auditEvents row in the same transaction.

const groupSource = v.union(v.literal('local'), v.literal('external'))
const principalType = v.union(v.literal('user'), v.literal('group'), v.literal('role'))
const accessRole = v.union(v.literal('viewer'), v.literal('editor'), v.literal('owner'))
const adminRole = v.union(
  v.literal('admin'),
  v.literal('auditor'),
  v.literal('billing_admin'),
  v.literal('support'),
)

const READ: readonly AdministrativeRole[] = ['admin', 'auditor', 'billing_admin', 'support']
const WRITE: readonly AdministrativeRole[] = ['admin']
const AUDIT_READ: readonly AdministrativeRole[] = ['admin', 'auditor']
const USER_DIRECTORY: readonly AdministrativeRole[] = ['admin', 'billing_admin', 'support']

type AuditInput = {
  action: string
  actorUserId: string
  resourceType: string
  resourceId?: string
  metadataJson?: string
}

async function recordAudit(ctx: { db: { insert(table: 'auditEvents', value: object): Promise<unknown> } }, input: AuditInput) {
  await ctx.db.insert('auditEvents', {
    eventId: crypto.randomUUID(),
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: 'success',
    metadataJson: input.metadataJson ?? '{}',
    createdAt: Date.now(),
  })
}

export const getRole = query({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).unique()
  },
})

export const listRoles = query({
  args: { serverSecret: v.string(), includeArchived: v.boolean() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    const rows = await ctx.db.query('authorizationRoles').collect()
    return rows
      .filter((row) => args.includeArchived || row.archivedAt === undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
  },
})

export const createRole = mutation({
  args: {
    serverSecret: v.string(),
    roleId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    capabilities: v.array(v.string()),
    isSystem: v.boolean(),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const duplicate = await ctx.db.query('authorizationRoles')
      .withIndex('by_name', (q) => q.eq('name', args.name)).first()
    if (duplicate) throw new Error('An authorization role with this name already exists')
    const now = Date.now()
    const id = await ctx.db.insert('authorizationRoles', {
      roleId: args.roleId,
      name: args.name,
      description: args.description,
      capabilities: args.capabilities,
      isSystem: args.isSystem,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    await recordAudit(ctx, {
      action: 'authorization.role.create',
      actorUserId: operator.userId,
      resourceType: 'authorization_role',
      resourceId: args.roleId,
      metadataJson: JSON.stringify({ name: args.name }),
    })
    return await ctx.db.get(id)
  },
})

export const updateRole = mutation({
  args: {
    serverSecret: v.string(),
    roleId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    capabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).unique()
    if (!existing) return null
    const values = {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.capabilities !== undefined ? { capabilities: args.capabilities } : {}),
      updatedAt: Date.now(),
    }
    await ctx.db.patch(existing._id, values)
    await recordAudit(ctx, {
      action: 'authorization.role.update',
      actorUserId: operator.userId,
      resourceType: 'authorization_role',
      resourceId: args.roleId,
    })
    return { ...existing, ...values }
  },
})

export const archiveRole = mutation({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).unique()
    if (!existing) return { archived: false }
    await ctx.db.patch(existing._id, {
      archivedAt: existing.archivedAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    await recordAudit(ctx, {
      action: 'authorization.role.archive',
      actorUserId: operator.userId,
      resourceType: 'authorization_role',
      resourceId: args.roleId,
    })
    return { archived: true }
  },
})

export const getGroup = query({
  args: { serverSecret: v.string(), groupId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).unique()
  },
})

export const listGroups = query({
  args: { serverSecret: v.string(), includeArchived: v.boolean() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    const rows = await ctx.db.query('authorizationGroups').collect()
    return rows
      .filter((row) => args.includeArchived || row.archivedAt === undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
  },
})

export const createGroup = mutation({
  args: {
    serverSecret: v.string(),
    groupId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    source: groupSource,
    externalId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const duplicate = await ctx.db.query('authorizationGroups')
      .withIndex('by_name', (q) => q.eq('name', args.name)).first()
    if (duplicate) throw new Error('An authorization group with this name already exists')
    const now = Date.now()
    const id = await ctx.db.insert('authorizationGroups', {
      groupId: args.groupId,
      name: args.name,
      description: args.description,
      source: args.source,
      externalId: args.externalId,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    await recordAudit(ctx, {
      action: 'authorization.group.create',
      actorUserId: operator.userId,
      resourceType: 'authorization_group',
      resourceId: args.groupId,
      metadataJson: JSON.stringify({ name: args.name }),
    })
    return await ctx.db.get(id)
  },
})

export const updateGroup = mutation({
  args: {
    serverSecret: v.string(),
    groupId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).unique()
    if (!existing) return null
    const values = {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      updatedAt: Date.now(),
    }
    await ctx.db.patch(existing._id, values)
    await recordAudit(ctx, {
      action: 'authorization.group.update',
      actorUserId: operator.userId,
      resourceType: 'authorization_group',
      resourceId: args.groupId,
    })
    return { ...existing, ...values }
  },
})

export const archiveGroup = mutation({
  args: { serverSecret: v.string(), groupId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).unique()
    if (!existing) return { archived: false }
    await ctx.db.patch(existing._id, {
      archivedAt: existing.archivedAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    await recordAudit(ctx, {
      action: 'authorization.group.archive',
      actorUserId: operator.userId,
      resourceType: 'authorization_group',
      resourceId: args.groupId,
    })
    return { archived: true }
  },
})

export const addGroupMember = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), userId: v.string(), source: groupSource },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_groupId_userId', (q) => q.eq('groupId', args.groupId).eq('userId', args.userId))
      .unique()
    await recordAudit(ctx, {
      action: 'authorization.group_member.add',
      actorUserId: operator.userId,
      resourceType: 'authorization_group_member',
      resourceId: args.groupId,
      metadataJson: JSON.stringify({ userId: args.userId }),
    })
    if (existing) {
      await ctx.db.patch(existing._id, { source: args.source })
      return { ...existing, source: args.source }
    }
    const id = await ctx.db.insert('authorizationGroupMemberships', {
      groupId: args.groupId,
      userId: args.userId,
      source: args.source,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const removeGroupMember = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_groupId_userId', (q) => q.eq('groupId', args.groupId).eq('userId', args.userId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    await recordAudit(ctx, {
      action: 'authorization.group_member.remove',
      actorUserId: operator.userId,
      resourceType: 'authorization_group_member',
      resourceId: args.groupId,
      metadataJson: JSON.stringify({ userId: args.userId }),
    })
    return { removed: true }
  },
})

export const listGroupMembers = query({
  args: { serverSecret: v.string(), groupId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).collect()
  },
})

export const listGroupsForUser = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    const memberships = await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId)).collect()
    const groups = await Promise.all(memberships.map(async ({ groupId }) =>
      await ctx.db.query('authorizationGroups')
        .withIndex('by_groupId', (q) => q.eq('groupId', groupId)).unique()))
    return groups.filter((group) => group && group.archivedAt === undefined)
  },
})

export const assignUserRole = mutation({
  args: { serverSecret: v.string(), userId: v.string(), roleId: v.string(), assignedBy: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId_roleId', (q) => q.eq('userId', args.userId).eq('roleId', args.roleId))
      .unique()
    await recordAudit(ctx, {
      action: 'authorization.role.assign',
      actorUserId: operator.userId,
      resourceType: 'authorization_role_assignment',
      resourceId: args.roleId,
      metadataJson: JSON.stringify({ userId: args.userId }),
    })
    if (existing) {
      await ctx.db.patch(existing._id, { assignedBy: args.assignedBy })
      return { ...existing, assignedBy: args.assignedBy }
    }
    const id = await ctx.db.insert('authorizationUserRoles', {
      userId: args.userId,
      roleId: args.roleId,
      assignedBy: args.assignedBy,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const revokeUserRole = mutation({
  args: { serverSecret: v.string(), userId: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId_roleId', (q) => q.eq('userId', args.userId).eq('roleId', args.roleId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    await recordAudit(ctx, {
      action: 'authorization.role.revoke',
      actorUserId: operator.userId,
      resourceType: 'authorization_role_assignment',
      resourceId: args.roleId,
      metadataJson: JSON.stringify({ userId: args.userId }),
    })
    return { removed: true }
  },
})

export const listUserRoles = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId)).collect()
  },
})

export const listUsersForRole = query({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationUserRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).collect()
  },
})

export const assignGroupRole = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), roleId: v.string(), assignedBy: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationGroupRoles')
      .withIndex('by_groupId_roleId', (q) => q.eq('groupId', args.groupId).eq('roleId', args.roleId))
      .unique()
    await recordAudit(ctx, {
      action: 'authorization.role.assign',
      actorUserId: operator.userId,
      resourceType: 'authorization_role_assignment',
      resourceId: args.roleId,
      metadataJson: JSON.stringify({ groupId: args.groupId }),
    })
    if (existing) {
      await ctx.db.patch(existing._id, { assignedBy: args.assignedBy })
      return { ...existing, assignedBy: args.assignedBy }
    }
    const id = await ctx.db.insert('authorizationGroupRoles', {
      groupId: args.groupId,
      roleId: args.roleId,
      assignedBy: args.assignedBy,
      createdAt: Date.now(),
    })
    return await ctx.db.get(id)
  },
})

export const revokeGroupRole = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationGroupRoles')
      .withIndex('by_groupId_roleId', (q) => q.eq('groupId', args.groupId).eq('roleId', args.roleId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    await recordAudit(ctx, {
      action: 'authorization.role.revoke',
      actorUserId: operator.userId,
      resourceType: 'authorization_role_assignment',
      resourceId: args.roleId,
      metadataJson: JSON.stringify({ groupId: args.groupId }),
    })
    return { removed: true }
  },
})

export const listGroupRoles = query({
  args: { serverSecret: v.string(), groupIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    const rows = await Promise.all(args.groupIds.map(async (groupId) =>
      await ctx.db.query('authorizationGroupRoles')
        .withIndex('by_groupId', (q) => q.eq('groupId', groupId)).collect()))
    return rows.flat()
  },
})

export const listGroupsForRole = query({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationGroupRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).collect()
  },
})

export const upsertResourceGrant = mutation({
  args: {
    serverSecret: v.string(),
    grantId: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    principalType,
    principalId: v.string(),
    accessRole,
    grantedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const candidates = await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_resource', (q) => q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId))
      .collect()
    const existing = candidates.find((row) =>
      row.principalType === args.principalType && row.principalId === args.principalId)
    const now = Date.now()
    await recordAudit(ctx, {
      action: 'authorization.resource_grant.upsert',
      actorUserId: operator.userId,
      resourceType: 'authorization_resource_grant',
      resourceId: args.grantId,
      metadataJson: JSON.stringify({ resourceType: args.resourceType, resourceId: args.resourceId }),
    })
    if (existing) {
      const values = { accessRole: args.accessRole, grantedBy: args.grantedBy, updatedAt: now }
      await ctx.db.patch(existing._id, values)
      return { ...existing, ...values }
    }
    const id = await ctx.db.insert('authorizationResourceGrants', {
      grantId: args.grantId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      principalType: args.principalType,
      principalId: args.principalId,
      accessRole: args.accessRole,
      grantedBy: args.grantedBy,
      createdAt: now,
      updatedAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const removeResourceGrant = mutation({
  args: { serverSecret: v.string(), grantId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_grantId', (q) => q.eq('grantId', args.grantId)).unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    await recordAudit(ctx, {
      action: 'authorization.resource_grant.remove',
      actorUserId: operator.userId,
      resourceType: 'authorization_resource_grant',
      resourceId: args.grantId,
    })
    return { removed: true }
  },
})

export const listResourceGrants = query({
  args: { serverSecret: v.string(), resourceType: v.string(), resourceId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_resource', (q) => q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId))
      .collect()
  },
})

export const listPrincipalGrants = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    groupIds: v.array(v.string()),
    roleIds: v.array(v.string()),
    resourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    const principals = [
      { type: 'user' as const, id: args.userId },
      ...args.groupIds.map((id) => ({ type: 'group' as const, id })),
      ...args.roleIds.map((id) => ({ type: 'role' as const, id })),
    ]
    const rows = await Promise.all(principals.map(async ({ type, id }) =>
      await ctx.db.query('authorizationResourceGrants')
        .withIndex('by_principal', (q) => q.eq('principalType', type).eq('principalId', id))
        .collect()))
    return rows.flat().filter((row) => !args.resourceType || row.resourceType === args.resourceType)
  },
})

export const getResourceOwner = query({
  args: {
    serverSecret: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    if (args.resourceType === 'output') {
      const fileId = ctx.db.normalizeId('files', args.resourceId)
      if (fileId) {
        const file = await ctx.db.get(fileId)
        if (file?.kind === 'output' && file.deletedAt === undefined) return { userId: file.userId }
      }
      const migrated = await ctx.db.query('files').withIndex('by_legacyOutputId', (q) => q.eq('legacyOutputId', args.resourceId)).first()
      return migrated && migrated.deletedAt === undefined ? { userId: migrated.userId } : null
    }
    if (args.resourceType === 'note') {
      const fileId = ctx.db.normalizeId('files', args.resourceId)
      if (fileId) {
        const file = await ctx.db.get(fileId)
        if (file?.kind === 'note' && file.deletedAt === undefined) return { userId: file.userId }
      }
      const migrated = await ctx.db.query('files').withIndex('by_legacyNoteId', (q) => q.eq('legacyNoteId', args.resourceId)).first()
      return migrated && migrated.deletedAt === undefined ? { userId: migrated.userId } : null
    }
    const table = resourceTable(args.resourceType)
    if (!table) return null
    const id = ctx.db.normalizeId(table, args.resourceId)
    if (!id) return null
    const row = await ctx.db.get(id)
    if (!row || ('deletedAt' in row && row.deletedAt !== undefined)) return null
    return { userId: row.userId }
  },
})

function resourceTable(resourceType: string) {
  switch (resourceType) {
    case 'conversation': return 'conversations' as const
    case 'file': return 'files' as const
    case 'automation': return 'automations' as const
    default: return null
  }
}

export const getPrincipal = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
  },
})

export const listPrincipals = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    return await ctx.db.query('administrativePrincipals').withIndex('by_createdAt').order('desc').collect()
  },
})

export const grantPrincipal = mutation({
  args: {
    serverSecret: v.string(),
    grantedBy: v.string(),
    reason: v.optional(v.string()),
    role: adminRole,
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    const now = Date.now()
    const values = {
      grantedBy: args.grantedBy,
      reason: args.reason,
      role: args.role,
      updatedAt: now,
      revokedAt: undefined,
      revokedBy: undefined,
    }
    await recordAudit(ctx, {
      action: 'administration.principal.grant',
      actorUserId: operator.userId,
      resourceType: 'administrative_principal',
      resourceId: args.userId,
      metadataJson: JSON.stringify({ role: args.role }),
    })
    if (existing) {
      await ctx.db.patch(existing._id, values)
      return { ...existing, ...values }
    }
    const id = await ctx.db.insert('administrativePrincipals', {
      ...values,
      userId: args.userId,
      createdAt: now,
    })
    return await ctx.db.get(id)
  },
})

export const revokePrincipal = mutation({
  args: { serverSecret: v.string(), revokedBy: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    const operator = await requireOperator(ctx, WRITE)
    const existing = await ctx.db
      .query('administrativePrincipals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique()
    if (!existing) return { revoked: false }
    const now = Date.now()
    await ctx.db.patch(existing._id, {
      revokedAt: existing.revokedAt ?? now,
      revokedBy: args.revokedBy,
      updatedAt: now,
    })
    await recordAudit(ctx, {
      action: 'administration.principal.revoke',
      actorUserId: operator.userId,
      resourceType: 'administrative_principal',
      resourceId: args.userId,
    })
    return { revoked: true }
  },
})

export const listAudit = query({
  args: {
    serverSecret: v.string(),
    action: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
    resourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, AUDIT_READ)
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const before = args.before ?? Date.now() + 1
    const source = args.actorUserId
      ? ctx.db.query('auditEvents').withIndex('by_actorUserId_createdAt', (q) =>
          q.eq('actorUserId', args.actorUserId).lt('createdAt', before))
      : ctx.db.query('auditEvents').withIndex('by_createdAt', (q) => q.lt('createdAt', before))
    const rows = await source.order('desc').take(200)
    return rows
      .filter((row) => (!args.action || row.action === args.action) &&
        (!args.resourceType || row.resourceType === args.resourceType))
      .slice(0, limit)
  },
})

export const appendAudit = mutation({
  args: {
    serverSecret: v.string(),
    eventId: v.string(),
    actorType: v.union(v.literal('user'), v.literal('api_key'), v.literal('service'), v.literal('system')),
    actorUserId: v.optional(v.string()),
    actorApiKeyId: v.optional(v.string()),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    outcome: v.union(v.literal('success'), v.literal('denied'), v.literal('failure')),
    requestId: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    metadataJson: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, READ)
    const existing = await ctx.db
      .query('auditEvents')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .unique()
    if (existing) return existing
    const values = {
      eventId: args.eventId,
      actorType: args.actorType,
      actorUserId: args.actorUserId,
      actorApiKeyId: args.actorApiKeyId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      outcome: args.outcome,
      requestId: args.requestId,
      ipAddress: args.ipAddress,
      metadataJson: args.metadataJson,
      createdAt: args.createdAt,
    }
    const id = await ctx.db.insert('auditEvents', values)
    return await ctx.db.get(id)
  },
})

export const listUserDirectory = query({
  args: { serverSecret: v.string(), limit: v.optional(v.number()), userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, USER_DIRECTORY)
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const rows = args.userId
      ? await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', args.userId!)).take(1)
      : await ctx.db.query('subscriptions').take(limit)
    return rows.map((row) => ({ userId: row.userId, email: row.email }))
  },
})

const GROWTH_READ: readonly AdministrativeRole[] = ['admin', 'auditor', 'billing_admin']
const GROWTH_DAYS = 90
const GROWTH_COHORT_WEEKS = 12
const GROWTH_TOP_WORKSPACE_DAYS = 30
/** Spend rows read per day for the top-workspace list; the long tail is irrelevant there. */
const GROWTH_WORKSPACE_ROWS_PER_DAY = 200

/**
 * Growth panel data, read only from the nightly growth tables
 * (`platform/growth`). Nothing here scans source tables, and nothing is per user.
 */
export const getGrowthSummary = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireAdminSecret(args.serverSecret)
    await requireOperator(ctx, GROWTH_READ)
    const state = await ctx.db.query('growthJobState').withIndex('by_key', (q) => q.eq('key', 'daily')).unique()
    const lastDay = state?.lastCompletedDay
    if (!lastDay) return { lastCompletedDay: null, computedAt: null, days: [], cohorts: [], topWorkspaces: [] }

    const fromDay = addDays(lastDay, -(GROWTH_DAYS - 1))
    const totals = await ctx.db.query('growthDailyTotals')
      .withIndex('by_day', (q) => q.gte('day', fromDay).lte('day', lastDay)).collect()
    const paid = await ctx.db.query('growthPaidAccounts')
      .withIndex('by_firstPaidDay', (q) => q.gte('firstPaidDay', fromDay).lte('firstPaidDay', lastDay)).collect()
    const newPaid = new Map<string, { count: number; approximate: number }>()
    for (const account of paid) {
      const entry = newPaid.get(account.firstPaidDay) ?? { count: 0, approximate: 0 }
      entry.count += 1
      if (account.approximate) entry.approximate += 1
      newPaid.set(account.firstPaidDay, entry)
    }
    const days = totals.map((row) => ({
      day: row.day,
      ...Object.fromEntries(Object.keys(growthCountFields).map((key) => [key, row[key as keyof typeof growthCountFields]])),
      weeklyActiveUsers: row.weeklyActiveUsers,
      monthlyActiveUsers: row.monthlyActiveUsers,
      paidSubscriptions: row.paidSubscriptions,
      computedAt: row.computedAt,
      newPaidSubscriptions: newPaid.get(row.day)?.count ?? 0,
      newPaidApproximate: newPaid.get(row.day)?.approximate ?? 0,
    }))

    // A cohort's rate is final once every member's window has passed: the
    // week's last signup day (Sunday) plus the window's last day (13 / 34).
    const cohortRows = await ctx.db.query('growthCohortWeeks')
      .withIndex('by_weekStart', (q) => q.lte('weekStart', lastDay)).order('desc').take(GROWTH_COHORT_WEEKS)
    const cohorts = cohortRows.map((row) => ({
      weekStart: row.weekStart,
      users: row.users,
      w1Active: row.w1Active,
      w4Active: row.w4Active,
      w1Final: addDays(row.weekStart, 6 + 13) <= lastDay,
      w4Final: addDays(row.weekStart, 6 + 34) <= lastDay,
    }))

    const spend = new Map<string, { cents: number; sandboxSeconds: number }>()
    for (let offset = 0; offset < GROWTH_TOP_WORKSPACE_DAYS; offset += 1) {
      const day = addDays(lastDay, -offset)
      const rows = await ctx.db.query('growthWorkspaceUsage')
        .withIndex('by_day_cents', (q) => q.eq('day', day)).order('desc').take(GROWTH_WORKSPACE_ROWS_PER_DAY)
      for (const row of rows) {
        const entry = spend.get(row.workspaceId) ?? { cents: 0, sandboxSeconds: 0 }
        entry.cents += row.cents
        entry.sandboxSeconds += row.sandboxSeconds
        spend.set(row.workspaceId, entry)
      }
    }
    const top = [...spend.entries()].sort((a, b) => b[1].cents - a[1].cents).slice(0, 10)
    const topWorkspaces = await Promise.all(top.map(async ([workspaceId, usage]) => {
      const workspace = await ctx.db.query('workspaces')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).unique()
      // Personal workspaces are named after a person; the panel shows only organizations by name.
      const name = workspace?.kind === 'organization' ? workspace.name : null
      return { workspaceId, name, kind: workspace?.kind ?? null, ...usage }
    }))

    const latest = totals.at(-1)
    return { lastCompletedDay: lastDay, computedAt: latest?.computedAt ?? null, days, cohorts, topWorkspaces }
  },
})
