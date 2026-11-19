import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'

/**
 * Members' own Microsoft grants (delegated ChannelMessage.Send) for replying
 * in Teams as themselves. Tokens arrive sealed by the web server and only
 * leave through getCredential, to server code that can open them.
 */

async function activeMember(ctx: Pick<QueryCtx, 'db'>, workspaceId: string, userId: string) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

async function accountFor(ctx: Pick<QueryCtx, 'db'>, workspaceId: string, userId: string) {
  return await ctx.db.query('syncMemberAccounts')
    .withIndex('by_workspaceId_userId_provider', q => q.eq('workspaceId', workspaceId).eq('userId', userId).eq('provider', 'teams'))
    .unique()
}

/** Stores a member's Teams grant after sign-in and ties their Teams identity to them, so their Teams messages show as theirs. */
export const connectAccount = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), userId: v.string(),
    externalOrgId: v.string(), externalUserId: v.string(), externalDisplayName: v.optional(v.string()),
    sealedToken: v.string(), sealedRefreshToken: v.optional(v.string()), tokenExpiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const principal = await activeMember(ctx, args.workspaceId, args.userId)
    const connection = await ctx.db.query('syncConnections')
      .withIndex('by_workspaceId_provider', q => q.eq('workspaceId', args.workspaceId).eq('provider', 'teams'))
      .unique()
    if (!connection || connection.status !== 'connected') throw new Error('SYNC_NOT_CONNECTED')
    if (connection.externalOrgId !== args.externalOrgId) throw new Error('SYNC_ACCOUNT_WRONG_ORG')
    const claimed = await ctx.db.query('syncMemberAccounts')
      .withIndex('by_provider_externalOrgId_externalUserId', q => q.eq('provider', 'teams').eq('externalOrgId', args.externalOrgId).eq('externalUserId', args.externalUserId))
      .collect()
    if (claimed.some(row => row.workspaceId === args.workspaceId && row.userId !== args.userId && row.status === 'active')) {
      throw new Error('SYNC_ACCOUNT_CLAIMED')
    }
    const now = Date.now()
    const fields = {
      principalId: principal.principalId,
      externalOrgId: args.externalOrgId,
      externalUserId: args.externalUserId,
      externalDisplayName: args.externalDisplayName,
      sealedToken: args.sealedToken,
      sealedRefreshToken: args.sealedRefreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
      scopes: args.scopes,
      status: 'active' as const,
      updatedAt: now,
    }
    const existing = await accountFor(ctx, args.workspaceId, args.userId)
    if (existing) {
      await ctx.db.patch(existing._id, fields)
    } else {
      await ctx.db.insert('syncMemberAccounts', {
        ...fields, workspaceId: args.workspaceId, userId: args.userId, provider: 'teams', dmSyncEnabled: false, createdAt: now,
      })
    }
    const identity = await ctx.db.query('syncIdentities')
      .withIndex('by_workspaceId_provider_externalUserId', q => q.eq('workspaceId', args.workspaceId).eq('provider', 'teams').eq('externalUserId', args.externalUserId))
      .unique()
    if (identity) {
      await ctx.db.patch(identity._id, { principalId: principal.principalId, updatedAt: now })
    } else {
      await ctx.db.insert('syncIdentities', {
        workspaceId: args.workspaceId, provider: 'teams', externalOrgId: args.externalOrgId, externalUserId: args.externalUserId,
        displayName: args.externalDisplayName ?? principal.displayName, principalId: principal.principalId, updatedAt: now,
      })
    }
    return null
  },
})

/** A member's sealed Teams grant, for the outbound worker. Null when they never connected or the grant was revoked. */
export const getCredential = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const account = await accountFor(ctx, args.workspaceId, args.userId)
    if (!account || account.status !== 'active') return null
    return {
      externalOrgId: account.externalOrgId,
      externalUserId: account.externalUserId,
      sealedToken: account.sealedToken,
      sealedRefreshToken: account.sealedRefreshToken ?? null,
      tokenExpiresAt: account.tokenExpiresAt ?? null,
    }
  },
})

/** Saves a refreshed grant. Microsoft rotates refresh tokens, so both are replaced. */
export const storeTokens = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), userId: v.string(),
    sealedToken: v.string(), sealedRefreshToken: v.optional(v.string()), tokenExpiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const account = await accountFor(ctx, args.workspaceId, args.userId)
    if (!account || account.status !== 'active') return null
    await ctx.db.patch(account._id, {
      sealedToken: args.sealedToken,
      ...(args.sealedRefreshToken ? { sealedRefreshToken: args.sealedRefreshToken } : {}),
      tokenExpiresAt: args.tokenExpiresAt,
      updatedAt: Date.now(),
    })
    return null
  },
})

/** Marks a grant unusable (Microsoft rejected the refresh token, or the member disconnected), so the composer asks them to connect again. */
export const revoke = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const account = await accountFor(ctx, args.workspaceId, args.userId)
    if (!account) return null
    await ctx.db.patch(account._id, { status: 'revoked', sealedToken: '', sealedRefreshToken: undefined, tokenExpiresAt: undefined, updatedAt: Date.now() })
    return null
  },
})
