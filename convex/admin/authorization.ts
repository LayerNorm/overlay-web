import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const groupSource = v.union(v.literal('local'), v.literal('external'))
const principalType = v.union(v.literal('user'), v.literal('group'), v.literal('role'))
const accessRole = v.union(v.literal('viewer'), v.literal('editor'), v.literal('owner'))

export const createRoleByServer = mutation({
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
    requireServerSecret(args.serverSecret)
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
    return await ctx.db.get(id)
  },
})

export const getRoleByServer = query({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).unique()
  },
})

export const listRolesByServer = query({
  args: { serverSecret: v.string(), includeArchived: v.boolean() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('authorizationRoles').collect()
    return rows
      .filter((row) => args.includeArchived || row.archivedAt === undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
  },
})

export const updateRoleByServer = mutation({
  args: {
    serverSecret: v.string(),
    roleId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    capabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
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
    return { ...existing, ...values }
  },
})

export const archiveRoleByServer = mutation({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).unique()
    if (!existing) return { archived: false }
    await ctx.db.patch(existing._id, {
      archivedAt: existing.archivedAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    return { archived: true }
  },
})

export const createGroupByServer = mutation({
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
    requireServerSecret(args.serverSecret)
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
    return await ctx.db.get(id)
  },
})

export const getGroupByServer = query({
  args: { serverSecret: v.string(), groupId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).unique()
  },
})

export const listGroupsByServer = query({
  args: { serverSecret: v.string(), includeArchived: v.boolean() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('authorizationGroups').collect()
    return rows
      .filter((row) => args.includeArchived || row.archivedAt === undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
  },
})

export const updateGroupByServer = mutation({
  args: {
    serverSecret: v.string(),
    groupId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).unique()
    if (!existing) return null
    const values = {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      updatedAt: Date.now(),
    }
    await ctx.db.patch(existing._id, values)
    return { ...existing, ...values }
  },
})

export const archiveGroupByServer = mutation({
  args: { serverSecret: v.string(), groupId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).unique()
    if (!existing) return { archived: false }
    await ctx.db.patch(existing._id, {
      archivedAt: existing.archivedAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    return { archived: true }
  },
})

export const addGroupMemberByServer = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), userId: v.string(), source: groupSource },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_groupId_userId', (q) => q.eq('groupId', args.groupId).eq('userId', args.userId))
      .unique()
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

export const removeGroupMemberByServer = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_groupId_userId', (q) => q.eq('groupId', args.groupId).eq('userId', args.userId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const listGroupMembersByServer = query({
  args: { serverSecret: v.string(), groupId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_groupId', (q) => q.eq('groupId', args.groupId)).collect()
  },
})

export const listGroupsForUserByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const memberships = await ctx.db.query('authorizationGroupMemberships')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId)).collect()
    const groups = await Promise.all(memberships.map(async ({ groupId }) =>
      await ctx.db.query('authorizationGroups')
        .withIndex('by_groupId', (q) => q.eq('groupId', groupId)).unique()))
    return groups.filter((group) => group && group.archivedAt === undefined)
  },
})

export const assignUserRoleByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string(), roleId: v.string(), assignedBy: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId_roleId', (q) => q.eq('userId', args.userId).eq('roleId', args.roleId))
      .unique()
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

export const revokeUserRoleByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId_roleId', (q) => q.eq('userId', args.userId).eq('roleId', args.roleId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const listUserRolesByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId)).collect()
  },
})

export const assignGroupRoleByServer = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), roleId: v.string(), assignedBy: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationGroupRoles')
      .withIndex('by_groupId_roleId', (q) => q.eq('groupId', args.groupId).eq('roleId', args.roleId))
      .unique()
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

export const revokeGroupRoleByServer = mutation({
  args: { serverSecret: v.string(), groupId: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationGroupRoles')
      .withIndex('by_groupId_roleId', (q) => q.eq('groupId', args.groupId).eq('roleId', args.roleId))
      .unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const listGroupRolesByServer = query({
  args: { serverSecret: v.string(), groupIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await Promise.all(args.groupIds.map(async (groupId) =>
      await ctx.db.query('authorizationGroupRoles')
        .withIndex('by_groupId', (q) => q.eq('groupId', groupId)).collect()))
    return rows.flat()
  },
})

export const upsertResourceGrantByServer = mutation({
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
    requireServerSecret(args.serverSecret)
    const candidates = await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_resource', (q) => q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId))
      .collect()
    const existing = candidates.find((row) =>
      row.principalType === args.principalType && row.principalId === args.principalId)
    const now = Date.now()
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

export const removeResourceGrantByServer = mutation({
  args: { serverSecret: v.string(), grantId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_grantId', (q) => q.eq('grantId', args.grantId)).unique()
    if (!existing) return { removed: false }
    await ctx.db.delete(existing._id)
    return { removed: true }
  },
})

export const listResourceGrantsByServer = query({
  args: { serverSecret: v.string(), resourceType: v.string(), resourceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_resource', (q) => q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId))
      .collect()
  },
})

export const listPrincipalGrantsByServer = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    groupIds: v.array(v.string()),
    roleIds: v.array(v.string()),
    resourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
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
