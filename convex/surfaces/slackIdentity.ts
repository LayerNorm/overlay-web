import { v } from 'convex/values'
import { canManageWorkspace } from '@overlay/workspace-contracts'
import { mutation, query, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

type Context = Pick<QueryCtx, 'db'>
const scope = { userId: v.string(), workspaceId: v.string(), connectionId: v.string(), teamId: v.string() }

export async function identityMember(ctx: Context, userId: string, workspaceId: string) {
  const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
  const principal = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId)).unique()
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt || !principal || principal.archivedAt || principal.type !== 'human') return null
  const membership = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
  return membership?.status === 'active' ? { principal, membership } : null
}

async function activeConnection(ctx: Context, input: { connectionId: string; workspaceId: string; teamId: string }) {
  const row = await ctx.db.query('surfaceConnections').withIndex('by_entityId', q => q.eq('id', input.connectionId)).unique()
  return row?.status === 'active' && row.platform === 'slack' && row.workspaceId === input.workspaceId && row.externalTeamId === input.teamId
}

export const begin = mutation({
  args: { ...scope, nonce: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!await identityMember(ctx, args.userId, args.workspaceId) || !await activeConnection(ctx, args)) throw new Error('SLACK_IDENTITY_ACCESS_DENIED')
    if (await ctx.db.query('slackIdentityNonces').withIndex('by_nonce', q => q.eq('nonce', args.nonce)).unique()) throw new Error('SLACK_IDENTITY_NONCE_EXISTS')
    await ctx.db.insert('slackIdentityNonces', { nonce: args.nonce, userId: args.userId, workspaceId: args.workspaceId,
      connectionId: args.connectionId, teamId: args.teamId, createdAt: Date.now(), expiresAt: Date.now() + 600_000 })
  },
})

export const complete = mutation({
  args: { ...scope, nonce: v.string(), slackUserId: v.string(), id: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const nonce = await ctx.db.query('slackIdentityNonces').withIndex('by_nonce', q => q.eq('nonce', args.nonce)).unique()
    if (!nonce || nonce.consumedAt !== undefined || nonce.expiresAt <= Date.now()
      || nonce.userId !== args.userId || nonce.workspaceId !== args.workspaceId || nonce.connectionId !== args.connectionId || nonce.teamId !== args.teamId) throw new Error('SLACK_IDENTITY_NONCE_INVALID')
    if (!await identityMember(ctx, args.userId, args.workspaceId) || !await activeConnection(ctx, args)) throw new Error('SLACK_IDENTITY_ACCESS_DENIED')
    const now = Date.now()
    await ctx.db.patch(nonce._id, { consumedAt: now })
    const matches = await ctx.db.query('slackIdentityLinks').withIndex('by_slack_identity', q => q.eq('teamId', args.teamId).eq('slackUserId', args.slackUserId)).collect()
    if (matches.some(row => row.status === 'active' && row.userId !== args.userId)) return { status: 'conflict' as const }
    const previous = await ctx.db.query('slackIdentityLinks').withIndex('by_overlay_identity', q => q.eq('teamId', args.teamId).eq('userId', args.userId)).collect()
    for (const row of previous.filter(row => row.status === 'active')) await ctx.db.patch(row._id, { status: 'revoked', revokedAt: now, updatedAt: now })
    await ctx.db.insert('slackIdentityLinks', { id: args.id, teamId: args.teamId, slackUserId: args.slackUserId,
      userId: args.userId, workspaceId: args.workspaceId, connectionId: args.connectionId, status: 'active', createdAt: now, updatedAt: now })
    return { status: 'linked' as const }
  },
})

export const unlink = mutation({
  args: { actorUserId: v.string(), workspaceId: v.string(), linkId: v.string(), serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const actor = await identityMember(ctx, args.actorUserId, args.workspaceId)
    const link = await ctx.db.query('slackIdentityLinks').withIndex('by_entityId', q => q.eq('id', args.linkId)).unique()
    if (!link || link.workspaceId !== args.workspaceId
      || (link.userId !== args.actorUserId && (!actor || !canManageWorkspace(actor.membership.role)))) throw new Error('SLACK_IDENTITY_UNLINK_DENIED')
    await ctx.db.patch(link._id, { status: 'revoked', revokedAt: Date.now(), updatedAt: Date.now() })
  },
})

export async function slackRequester(ctx: Context, args: {
  workspaceId: string; connectionId: string; teamId: string; slackUserId: string; channelId: string; threadId: string
  linkId?: string; userId?: string
}) {
  if (!await activeConnection(ctx, args)) return null
  const links = (await ctx.db.query('slackIdentityLinks').withIndex('by_slack_identity', q => q.eq('teamId', args.teamId).eq('slackUserId', args.slackUserId)).collect())
    .filter(row => row.status === 'active')
  if (links.length !== 1) return null
  const link = links[0]
  if (link.workspaceId !== args.workspaceId || link.connectionId !== args.connectionId
    || (args.linkId !== undefined && args.linkId !== link.id) || (args.userId !== undefined && args.userId !== link.userId)) return null
  const member = await identityMember(ctx, link.userId, args.workspaceId)
  if (!member) return null
  const thread = await ctx.db.query('surfaceThreadLinks').withIndex('by_external_thread', q => q.eq('platform', 'slack')
    .eq('connectionId', args.connectionId).eq('externalTeamId', args.teamId).eq('channelId', args.channelId).eq('threadId', args.threadId)).unique()
  let conversation = thread ? await ctx.db.get(thread.conversationId) : null
  if (thread && !conversation) return null
  if (!thread) {
    const bindings = await ctx.db.query('surfaceBindings').withIndex('by_connectionId', q => q.eq('connectionId', args.connectionId)).collect()
    const candidates = []
    for (const binding of bindings.filter(row => row.channelId === args.channelId)) {
      const rows = await ctx.db.query('conversations').withIndex('by_surfaceBindingId_externalThreadId', q => q.eq('surfaceBindingId', binding.id).eq('externalThreadId', args.threadId)).collect()
      for (const row of rows.filter(row => row.deletedAt === undefined && row.workspaceId === args.workspaceId
        && row.externalPlatform === 'slack' && row.externalChannelId === args.channelId)) {
        const mapped = await ctx.db.query('surfaceThreadLinks').withIndex('by_conversationId', q => q.eq('conversationId', row._id)).unique()
        if (!mapped) candidates.push(row)
      }
    }
    if (candidates.length > 1) return null
    conversation = candidates[0] ?? null
  }
  if (conversation) {
    const participant = await ctx.db.query('conversationParticipants').withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversation!._id).eq('principalId', member.principal.principalId)).unique()
    if (conversation.deletedAt !== undefined || conversation.workspaceId !== args.workspaceId || conversation.externalPlatform !== 'slack'
      || conversation.externalChannelId !== args.channelId || conversation.externalThreadId !== args.threadId
      || participant?.status !== 'active' || participant.workspaceId !== args.workspaceId) return null
  }
  return { userId: link.userId, principalId: member.principal.principalId, linkId: link.id }
}

export const requester = query({
  args: { workspaceId: v.string(), connectionId: v.string(), teamId: v.string(), slackUserId: v.string(), channelId: v.string(), threadId: v.string(),
    linkId: v.optional(v.string()), userId: v.optional(v.string()), serverSecret: v.string() },
  handler: async (ctx, args) => { requireServerSecret(args.serverSecret); return await slackRequester(ctx, args) },
})
