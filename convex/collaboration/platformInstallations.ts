import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const installationValidator = v.object({
  installationId: v.string(),
  workspaceId: v.string(),
  directory: v.string(),
  externalTeamId: v.string(),
  enterpriseId: v.optional(v.string()),
  isEnterpriseInstall: v.boolean(),
  teamName: v.optional(v.string()),
  botUserId: v.optional(v.string()),
  botTokenCipher: v.string(),
  installedByPrincipalId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const upsertPlatformInstallationByServer = mutation({
  args: {
    serverSecret: v.string(),
    installationId: v.string(),
    workspaceId: v.string(),
    directory: v.string(),
    externalTeamId: v.string(),
    enterpriseId: v.optional(v.string()),
    isEnterpriseInstall: v.optional(v.boolean()),
    teamName: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    botTokenCipher: v.string(),
    installedByPrincipalId: v.string(),
    now: v.number(),
  },
  returns: installationValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.installedByPrincipalId)
    if (!args.installationId.trim() || !args.directory.trim()
      || !args.externalTeamId.trim() || !args.botTokenCipher.trim()) {
      throw new Error('WORKSPACE_INSTALLATION_INVALID')
    }
    const value = {
      installationId: args.installationId.trim(),
      workspaceId: args.workspaceId,
      directory: args.directory.trim(),
      externalTeamId: args.externalTeamId.trim(),
      enterpriseId: cleanOptional(args.enterpriseId),
      isEnterpriseInstall: args.isEnterpriseInstall ?? false,
      teamName: cleanOptional(args.teamName),
      botUserId: cleanOptional(args.botUserId),
      botTokenCipher: args.botTokenCipher.trim(),
      installedByPrincipalId: args.installedByPrincipalId,
      updatedAt: args.now,
    }
    const existing = await ctx.db.query('workspacePlatformInstallations')
      .withIndex('by_workspaceId_directory_team', (q) => q
        .eq('workspaceId', args.workspaceId)
        .eq('directory', value.directory)
        .eq('externalTeamId', value.externalTeamId))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, value)
      return installationValue({ ...existing, ...value })
    }
    const installation = {
      ...value,
      createdAt: args.now,
    }
    await ctx.db.insert('workspacePlatformInstallations', installation)
    return installationValue(installation)
  },
})

export const getPlatformInstallationByServer = query({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    directory: v.string(),
    externalTeamId: v.string(),
  },
  returns: v.union(installationValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('workspacePlatformInstallations')
      .withIndex('by_workspaceId_directory_team', (q) => q
        .eq('workspaceId', args.workspaceId)
        .eq('directory', args.directory)
        .eq('externalTeamId', args.externalTeamId))
      .unique()
    return row ? installationValue(row) : null
  },
})

export const getPlatformInstallationByTeamByServer = query({
  args: {
    serverSecret: v.string(),
    directory: v.string(),
    externalTeamId: v.string(),
  },
  returns: v.union(installationValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('workspacePlatformInstallations')
      .withIndex('by_directory_external', (q) => q
        .eq('directory', args.directory)
        .eq('externalTeamId', args.externalTeamId))
      .unique()
    return row ? installationValue(row) : null
  },
})

export const listPlatformInstallationsByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.array(installationValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('workspacePlatformInstallations')
      .withIndex('by_workspaceId_directory_team', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    return rows
      .sort((a, b) => a.directory.localeCompare(b.directory) || a.externalTeamId.localeCompare(b.externalTeamId))
      .map(installationValue)
  },
})

export const deletePlatformInstallationByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    directory: v.string(),
    externalTeamId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('workspacePlatformInstallations')
      .withIndex('by_workspaceId_directory_team', (q) => q
        .eq('workspaceId', args.workspaceId)
        .eq('directory', args.directory)
        .eq('externalTeamId', args.externalTeamId))
      .unique()
    if (!row) return false
    await ctx.db.delete(row._id)
    return true
  },
})

function installationValue(row: {
  installationId: string
  workspaceId: string
  directory: string
  externalTeamId: string
  enterpriseId?: string
  isEnterpriseInstall: boolean
  teamName?: string
  botUserId?: string
  botTokenCipher: string
  installedByPrincipalId: string
  createdAt: number
  updatedAt: number
}) {
  return {
    installationId: row.installationId,
    workspaceId: row.workspaceId,
    directory: row.directory,
    externalTeamId: row.externalTeamId,
    enterpriseId: row.enterpriseId,
    isEnterpriseInstall: row.isEnterpriseInstall,
    teamName: row.teamName,
    botUserId: row.botUserId,
    botTokenCipher: row.botTokenCipher,
    installedByPrincipalId: row.installedByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function requireActiveWorkspace(ctx: QueryCtx | MutationCtx, workspaceId: string) {
  const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).unique()
  if (!workspace || workspace.status !== 'active') throw new Error('WORKSPACE_NOT_FOUND')
  return workspace
}

async function requirePrincipal(ctx: QueryCtx | MutationCtx, workspaceId: string, principalId: string) {
  const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', (q) => q.eq('principalId', principalId)).unique()
  if (!principal || principal.workspaceId !== workspaceId || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

function cleanOptional(value?: string) {
  return value?.trim() || undefined
}
