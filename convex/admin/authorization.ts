import { v } from 'convex/values'
import { query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'


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

export const listUserRolesByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationUserRoles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId)).collect()
  },
})

export const listUsersForRoleByServer = query({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationUserRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).collect()
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

export const listGroupsForRoleByServer = query({
  args: { serverSecret: v.string(), roleId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ctx.db.query('authorizationGroupRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', args.roleId)).collect()
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

export const getResourceOwnerByServer = query({
  args: {
    serverSecret: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.resourceType === 'output') {
      const fileId = ctx.db.normalizeId('files', args.resourceId)
      if (fileId) {
        const file = await ctx.db.get(fileId)
        if (file?.kind === 'output' && file.deletedAt === undefined) return { userId: file.userId }
      }
      // An id from before outputs moved into `files`.
      const migrated = await ctx.db.query('files').withIndex('by_legacyOutputId', (q) => q.eq('legacyOutputId', args.resourceId)).first()
      return migrated && migrated.deletedAt === undefined ? { userId: migrated.userId } : null
    }
    if (args.resourceType === 'note') {
      const fileId = ctx.db.normalizeId('files', args.resourceId)
      if (fileId) {
        const file = await ctx.db.get(fileId)
        if (file?.kind === 'note' && file.deletedAt === undefined) return { userId: file.userId }
      }
      // An id from before notes moved into `files`.
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
