import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import { validateServerSecret } from '../lib/auth'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { providerValidator } from './validators'

type Provider = 'slack' | 'teams'

async function requireMember(ctx: Pick<QueryCtx, 'db'>, args: { serverSecret: string; actorUserId: string; workspaceId: string }) {
  if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

async function accountFor(ctx: Pick<QueryCtx, 'db'>, workspaceId: string, userId: string, provider: Provider) {
  return await ctx.db.query('syncMemberAccounts')
    .withIndex('by_workspaceId_userId_provider', q => q.eq('workspaceId', workspaceId).eq('userId', userId).eq('provider', provider))
    .unique()
}

/**
 * Stores a member's own Slack or Teams grant after their OAuth sign-in. The
 * token arrives sealed by the web server. The grant must belong to the
 * organization the workspace syncs with, and the external person becomes
 * this member for inbound authorship and reaction echoes.
 */
export const connect = mutation({
  args: {
    serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), provider: providerValidator,
    externalOrgId: v.string(), externalUserId: v.string(), externalDisplayName: v.optional(v.string()),
    sealedToken: v.string(), sealedRefreshToken: v.optional(v.string()), tokenExpiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
  },
  returns: v.id('syncMemberAccounts'),
  handler: async (ctx, args) => {
    const principal = await requireMember(ctx, args)
    const connection = await ctx.db.query('syncConnections')
      .withIndex('by_workspaceId_provider', q => q.eq('workspaceId', args.workspaceId).eq('provider', args.provider))
      .unique()
    if (!connection || connection.status === 'disconnected') throw new Error('SYNC_NOT_CONNECTED')
    if (connection.externalOrgId !== args.externalOrgId) throw new Error('SYNC_ACCOUNT_ORG_MISMATCH')
    const claimed = await ctx.db.query('syncMemberAccounts')
      .withIndex('by_provider_externalOrgId_externalUserId', q => q
        .eq('provider', args.provider).eq('externalOrgId', args.externalOrgId).eq('externalUserId', args.externalUserId))
      .collect()
    if (claimed.some(row => row.workspaceId === args.workspaceId && row.userId !== args.actorUserId && row.status === 'active')) {
      throw new Error('SYNC_ACCOUNT_IN_USE')
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
    const existing = await accountFor(ctx, args.workspaceId, args.actorUserId, args.provider)
    const accountId = existing
      ? (await ctx.db.patch(existing._id, fields), existing._id)
      : await ctx.db.insert('syncMemberAccounts', {
          workspaceId: args.workspaceId, userId: args.actorUserId, provider: args.provider, dmSyncEnabled: false, createdAt: now, ...fields,
        })
    const identity = await ctx.db.query('syncIdentities')
      .withIndex('by_workspaceId_provider_externalUserId', q => q
        .eq('workspaceId', args.workspaceId).eq('provider', args.provider).eq('externalUserId', args.externalUserId))
      .unique()
    if (identity) {
      await ctx.db.patch(identity._id, { principalId: principal.principalId, updatedAt: now })
    } else {
      await ctx.db.insert('syncIdentities', {
        workspaceId: args.workspaceId, provider: args.provider, externalOrgId: args.externalOrgId, externalUserId: args.externalUserId,
        displayName: args.externalDisplayName ?? principal.displayName, principalId: principal.principalId, updatedAt: now,
      })
    }
    return accountId
  },
})

/** Revokes a member's grant and returns the sealed token it held, so the server can revoke it at the platform too. */
export const disconnect = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), provider: providerValidator },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await requireMember(ctx, args)
    const account = await accountFor(ctx, args.workspaceId, args.actorUserId, args.provider)
    if (!account || account.status !== 'active') return null
    await ctx.db.patch(account._id, {
      status: 'revoked', sealedToken: '', sealedRefreshToken: undefined, tokenExpiresAt: undefined, dmSyncEnabled: false, updatedAt: Date.now(),
    })
    return account.sealedToken || null
  },
})

/** Stores the member's direct-message sync preference. DM syncing itself ships later. */
export const setDmSync = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), provider: providerValidator, enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args)
    const account = await accountFor(ctx, args.workspaceId, args.actorUserId, args.provider)
    if (!account || account.status !== 'active') throw new Error('SYNC_ACCOUNT_NOT_CONNECTED')
    await ctx.db.patch(account._id, { dmSyncEnabled: args.enabled, updatedAt: Date.now() })
    return null
  },
})

/**
 * For the room composer: which platform the viewer must connect before
 * replying in this channel, or null when the channel isn't linked, its link is
 * paused, or the viewer's own account is already connected.
 */
export const composerState = query({
  args: { workspaceId: v.string(), conversationId: v.id('conversations') },
  returns: v.union(v.object({ connectProvider: providerValidator }), v.null()),
  handler: async (ctx, args) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    } catch {
      return null
    }
    const link = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', args.conversationId)).unique()
    if (!link || link.workspaceId !== args.workspaceId || link.status === 'paused') return null
    const account = await accountFor(ctx, args.workspaceId, viewer.userId, link.provider)
    return account?.status === 'active' ? null : { connectProvider: link.provider }
  },
})
