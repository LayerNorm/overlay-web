import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { createAgentThread } from '../agents/agentThreads'
import {
  conversationOriginValidator, slackActionsValidator, slackUnlinkedPeopleValidator, slackWhoCanAskValidator,
} from '../lib/slackSchema'

/**
 * Slack as a first-class integration (internal/develop/slack-integration.md). One Slack workspace belongs to one
 * Overlay workspace; members prove their Slack identity with Sign in with Slack; every Slack request runs in an
 * ordinary Workspace Overlay agent thread owned by the person who asked.
 */

type Ctx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>

const SLACK_DEFAULT_SETTINGS = {
  whoCanAsk: 'linked' as const,
  unlinkedPeople: 'link' as const,
  guests: false,
  slackConnect: false,
  actionsInChannels: 'ask' as const,
}

/** The Chat SDK keeps each installation's encrypted bot token under this key (adapter default prefix). */
const slackInstallationStateKey = (teamId: string) => `slack:installation:${teamId}`

async function activeInstallationForTeam(ctx: Ctx, teamId: string) {
  const rows = await ctx.db.query('slackInstallations').withIndex('by_teamId', q => q.eq('teamId', teamId)).collect()
  return rows.find(row => row.removedAt === undefined) ?? null
}

async function activeInstallationForWorkspace(ctx: Ctx, workspaceId: string) {
  const rows = await ctx.db.query('slackInstallations').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).collect()
  return rows.find(row => row.removedAt === undefined) ?? null
}

async function settingsFor(ctx: Ctx, workspaceId: string) {
  const row = await ctx.db.query('slackSettings').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
  if (!row) return { ...SLACK_DEFAULT_SETTINGS }
  return {
    whoCanAsk: row.whoCanAsk, unlinkedPeople: row.unlinkedPeople, guests: row.guests,
    slackConnect: row.slackConnect, actionsInChannels: row.actionsInChannels,
  }
}

/** An active human member of the workspace, or null. */
async function activeMember(ctx: Ctx, workspaceId: string, userId: string) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId)).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) return null
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
  if (!membership || membership.status !== 'active') return null
  return { principal, membership }
}

async function activeLinkForUser(ctx: Ctx, workspaceId: string, userId: string) {
  const rows = await ctx.db.query('slackIdentityLinks')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId)).collect()
  return rows.find(row => row.removedAt === undefined) ?? null
}

async function activeLinkForSlackUser(ctx: Ctx, teamId: string, slackUserId: string) {
  const rows = await ctx.db.query('slackIdentityLinks')
    .withIndex('by_teamId_slackUserId', q => q.eq('teamId', teamId).eq('slackUserId', slackUserId)).collect()
  return rows.find(row => row.removedAt === undefined) ?? null
}

const isManager = (role: string) => role === 'owner' || role === 'admin'

// ─── Settings page ──────────────────────────────────────────────────────────

export const status = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    } catch {
      return null
    }
    const [installation, link, settings] = await Promise.all([
      activeInstallationForWorkspace(ctx, args.workspaceId),
      activeLinkForUser(ctx, args.workspaceId, viewer.userId),
      settingsFor(ctx, args.workspaceId),
    ])
    const installer = installation
      ? await ctx.db.query('workspacePrincipals')
        .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', installation.installedByUserId)).unique()
      : null
    return {
      canManage: isManager(viewer.membership.role),
      installation: installation ? {
        teamId: installation.teamId,
        teamName: installation.teamName,
        installedByName: installer?.displayName ?? null,
        createdAt: installation.createdAt,
      } : null,
      link: link && installation && link.teamId === installation.teamId
        ? { slackUserId: link.slackUserId, slackUserName: link.slackUserName ?? null }
        : null,
      settings,
    }
  },
})

export const updateSettings = mutation({
  args: {
    workspaceId: v.string(),
    whoCanAsk: slackWhoCanAskValidator,
    unlinkedPeople: slackUnlinkedPeopleValidator,
    guests: v.boolean(),
    slackConnect: v.boolean(),
    actionsInChannels: slackActionsValidator,
  },
  handler: async (ctx, { workspaceId, ...settings }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    if (!isManager(viewer.membership.role)) throw new ConvexError('SLACK_SETTINGS_FORBIDDEN')
    const existing = await ctx.db.query('slackSettings').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
    const row = { ...settings, updatedByUserId: viewer.userId, updatedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, row)
    else await ctx.db.insert('slackSettings', { workspaceId, ...row })
    return null
  },
})

/** Owners and admins disconnect the Slack workspace: Overlay stops answering and forgets the bot token. */
export const disconnect = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    if (!isManager(viewer.membership.role)) throw new ConvexError('SLACK_DISCONNECT_FORBIDDEN')
    const installation = await activeInstallationForWorkspace(ctx, args.workspaceId)
    if (!installation) return null
    await removeInstallation(ctx, installation.teamId)
    return null
  },
})

/** A member unlinks their own Slack account. */
export const unlink = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    const link = await activeLinkForUser(ctx, args.workspaceId, viewer.userId)
    if (link) await ctx.db.patch(link._id, { removedAt: Date.now(), updatedAt: Date.now() })
    return null
  },
})

async function removeInstallation(ctx: MutationCtx, teamId: string) {
  const now = Date.now()
  const rows = await ctx.db.query('slackInstallations').withIndex('by_teamId', q => q.eq('teamId', teamId)).collect()
  await Promise.all(rows.filter(row => row.removedAt === undefined)
    .map(row => ctx.db.patch(row._id, { removedAt: now, updatedAt: now })))
  const token = await ctx.db.query('slackChatState').withIndex('by_key', q => q.eq('key', slackInstallationStateKey(teamId))).unique()
  if (token) await ctx.db.delete(token._id)
}

/** Where a thread that started in Slack came from, for anyone taking part in it. */
export const threadOrigin = query({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('conversations', args.conversationId)
    const conversation = id ? await ctx.db.get(id) : null
    if (!conversation?.origin || !conversation.workspaceId || conversation.deletedAt !== undefined) return null
    let viewer
    try {
      viewer = await requireNativeWorkspace(ctx, conversation.workspaceId)
    } catch {
      return null
    }
    const participant = await ctx.db.query('conversationParticipants')
      .withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversation._id).eq('principalId', viewer.principal.principalId))
      .unique()
    if (!participant || participant.status !== 'active') return null
    const { teamId, channelId, kind, channelName } = conversation.origin
    return {
      kind,
      channelName: channelName ?? null,
      openUrl: conversation.origin.permalink
        ?? 'https://slack.com/app_redirect?team=' + encodeURIComponent(teamId) + '&channel=' + encodeURIComponent(channelId),
    }
  },
})

// ─── Server: install, link and admission ────────────────────────────────────

export const installByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), teamId: v.string(), teamName: v.string(),
    enterpriseId: v.optional(v.string()), botUserId: v.optional(v.string()), installedByUserId: v.string(),
  },
  handler: async (ctx, { serverSecret, ...args }) => {
    requireServerSecret(serverSecret)
    const member = await activeMember(ctx, args.workspaceId, args.installedByUserId)
    if (!member || !isManager(member.membership.role)) throw new ConvexError('SLACK_INSTALL_FORBIDDEN')
    const other = await activeInstallationForTeam(ctx, args.teamId)
    if (other && other.workspaceId !== args.workspaceId) throw new ConvexError('SLACK_TEAM_IN_OTHER_WORKSPACE')
    const current = await activeInstallationForWorkspace(ctx, args.workspaceId)
    if (current && current.teamId !== args.teamId) throw new ConvexError('SLACK_WORKSPACE_HAS_OTHER_TEAM')
    const now = Date.now()
    if (current) {
      await ctx.db.patch(current._id, { ...args, updatedAt: now })
      return null
    }
    await ctx.db.insert('slackInstallations', { ...args, createdAt: now, updatedAt: now })
    return null
  },
})

/** Forgets a bot token the adapter stored for an install that was then refused, unless the team is bound already. */
export const discardUnboundTokenByServer = mutation({
  args: { serverSecret: v.string(), teamId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (await activeInstallationForTeam(ctx, args.teamId)) return null
    const token = await ctx.db.query('slackChatState').withIndex('by_key', q => q.eq('key', slackInstallationStateKey(args.teamId))).unique()
    if (token) await ctx.db.delete(token._id)
    return null
  },
})

/** The Slack workspace installed for an Overlay workspace, for starting Sign in with Slack. */
export const installationByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const installation = await activeInstallationForWorkspace(ctx, args.workspaceId)
    return installation ? { teamId: installation.teamId } : null
  },
})

/** Slack told us the app was uninstalled or its tokens revoked. */
export const uninstallByServer = mutation({
  args: { serverSecret: v.string(), teamId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await removeInstallation(ctx, args.teamId)
    return null
  },
})

export const linkByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), teamId: v.string(), slackUserId: v.string(),
    slackUserName: v.optional(v.string()), userId: v.string(),
  },
  handler: async (ctx, { serverSecret, ...args }) => {
    requireServerSecret(serverSecret)
    if (!await activeMember(ctx, args.workspaceId, args.userId)) throw new ConvexError('WORKSPACE_ACCESS_DENIED')
    const installation = await activeInstallationForWorkspace(ctx, args.workspaceId)
    if (!installation || installation.teamId !== args.teamId) throw new ConvexError('SLACK_TEAM_NOT_INSTALLED')
    const now = Date.now()
    const previous = [
      await activeLinkForUser(ctx, args.workspaceId, args.userId),
      await activeLinkForSlackUser(ctx, args.teamId, args.slackUserId),
    ].filter(row => row !== null)
    await Promise.all(previous.map(row => ctx.db.patch(row._id, { removedAt: now, updatedAt: now })))
    await ctx.db.insert('slackIdentityLinks', { ...args, createdAt: now, updatedAt: now })
    return null
  },
})

/**
 * Who is asking. A link only counts while its owner is still an active member and the Slack workspace is still
 * installed into the same Overlay workspace; anything else fails closed.
 */
export const resolveRequesterByServer = query({
  args: { serverSecret: v.string(), teamId: v.string(), slackUserId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const installation = await activeInstallationForTeam(ctx, args.teamId)
    if (!installation) return null
    const settings = await settingsFor(ctx, installation.workspaceId)
    const link = await activeLinkForSlackUser(ctx, args.teamId, args.slackUserId)
    const member = link && link.workspaceId === installation.workspaceId
      ? await activeMember(ctx, installation.workspaceId, link.userId)
      : null
    return {
      workspaceId: installation.workspaceId,
      settings,
      userId: member && link ? link.userId : null,
      principalId: member ? member.principal.principalId : null,
      guest: member ? member.membership.role === 'guest' : false,
    }
  },
})

/**
 * The requester's Overlay thread for this Slack thread, created under the Workspace Overlay on first use. Each
 * person who asks in a Slack thread gets their own Overlay thread, so every turn runs with its requester's access.
 */
export const resolveThreadByServer = mutation({
  args: {
    serverSecret: v.string(), workspaceId: v.string(), userId: v.string(), title: v.string(),
    origin: conversationOriginValidator,
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const { teamId, channelId, threadTs } = args.origin
    const existing = await ctx.db.query('slackThreads')
      .withIndex('by_teamId_channelId_threadTs_userId', q => q.eq('teamId', teamId).eq('channelId', channelId)
        .eq('threadTs', threadTs).eq('userId', args.userId)).unique()
    if (existing) {
      const conversation = await ctx.db.get(existing.conversationId)
      if (conversation && !conversation.deletedAt && conversation.workspaceId === args.workspaceId) {
        return { conversationId: existing.conversationId, agentId: conversation.agentId!, created: false }
      }
      await ctx.db.delete(existing._id)
    }
    const definitions = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).collect()
    const chief = definitions.find(row => row.agentRole === 'workspace_chief' && !row.deletedAt && !row.archivedAt)
    if (!chief) throw new ConvexError('SLACK_WORKSPACE_OVERLAY_MISSING')
    const thread = await createAgentThread(ctx, {
      workspaceId: args.workspaceId, agentId: chief.agentId, userId: args.userId, title: args.title,
    })
    await ctx.db.patch(thread.conversationId, { origin: args.origin })
    await ctx.db.insert('slackThreads', {
      workspaceId: args.workspaceId, teamId, channelId, threadTs, userId: args.userId,
      conversationId: thread.conversationId, createdAt: Date.now(),
    })
    return { conversationId: thread.conversationId, agentId: chief.agentId, created: true }
  },
})

export const originByServer = query({
  args: { serverSecret: v.string(), conversationId: v.id('conversations') },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const conversation = await ctx.db.get(args.conversationId)
    return conversation?.origin ?? null
  },
})

// ─── Server: Chat SDK state adapter ─────────────────────────────────────────

async function stateRow(ctx: Ctx, key: string) {
  const row = await ctx.db.query('slackChatState').withIndex('by_key', q => q.eq('key', key)).unique()
  if (row && row.expiresAt !== undefined && row.expiresAt <= Date.now()) return { row, live: false as const }
  return row ? { row, live: true as const } : null
}

async function writeState(ctx: MutationCtx, key: string, value: unknown, ttlMs?: number) {
  const found = await stateRow(ctx, key)
  const expiresAt = ttlMs ? Date.now() + ttlMs : undefined
  if (found) await ctx.db.replace(found.row._id, { key, value, ...(expiresAt ? { expiresAt } : {}) })
  else await ctx.db.insert('slackChatState', { key, value, ...(expiresAt ? { expiresAt } : {}) })
}

export const stateGet = query({
  args: { serverSecret: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, args.key)
    return found?.live ? found.row.value : null
  },
})

export const stateSet = mutation({
  args: { serverSecret: v.string(), key: v.string(), value: v.any(), ttlMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await writeState(ctx, args.key, args.value, args.ttlMs)
    return null
  },
})

export const stateSetIfNotExists = mutation({
  args: { serverSecret: v.string(), key: v.string(), value: v.any(), ttlMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, args.key)
    if (found?.live) return false
    await writeState(ctx, args.key, args.value, args.ttlMs)
    return true
  },
})

const lockKey = (threadId: string) => `lock:${threadId}`

export const lockAcquire = mutation({
  args: { serverSecret: v.string(), threadId: v.string(), token: v.string(), ttlMs: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, lockKey(args.threadId))
    if (found?.live) return null
    const expiresAt = Date.now() + args.ttlMs
    await writeState(ctx, lockKey(args.threadId), { token: args.token }, args.ttlMs)
    return { threadId: args.threadId, token: args.token, expiresAt }
  },
})

export const lockExtend = mutation({
  args: { serverSecret: v.string(), threadId: v.string(), token: v.string(), ttlMs: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, lockKey(args.threadId))
    if (!found?.live || (found.row.value as { token?: string })?.token !== args.token) return false
    await ctx.db.patch(found.row._id, { expiresAt: Date.now() + args.ttlMs })
    return true
  },
})

/** Releases a lock; with a token only when it still holds the lock, without one unconditionally. */
export const lockRelease = mutation({
  args: { serverSecret: v.string(), threadId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, lockKey(args.threadId))
    if (!found) return null
    if (args.token !== undefined && found.live && (found.row.value as { token?: string })?.token !== args.token) return null
    await ctx.db.delete(found.row._id)
    return null
  },
})

export const stateDelete = mutation({
  args: { serverSecret: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, args.key)
    if (found) await ctx.db.delete(found.row._id)
    return null
  },
})

/** Appends to a list (newest last), keeps only the newest maxLength entries and returns the new length. */
export const stateAppend = mutation({
  args: { serverSecret: v.string(), key: v.string(), value: v.any(), maxLength: v.optional(v.number()), ttlMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, args.key)
    const list = found?.live && Array.isArray(found.row.value) ? found.row.value as unknown[] : []
    const next = [...list, args.value]
    const trimmed = args.maxLength !== undefined && next.length > args.maxLength ? next.slice(next.length - args.maxLength) : next
    await writeState(ctx, args.key, trimmed, args.ttlMs)
    return trimmed.length
  },
})

/** Removes and returns the oldest list entry. */
export const stateShift = mutation({
  args: { serverSecret: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const found = await stateRow(ctx, args.key)
    if (!found?.live || !Array.isArray(found.row.value) || found.row.value.length === 0) return null
    const [first, ...rest] = found.row.value as unknown[]
    if (rest.length === 0) await ctx.db.delete(found.row._id)
    else await ctx.db.patch(found.row._id, { value: rest })
    return first
  },
})
