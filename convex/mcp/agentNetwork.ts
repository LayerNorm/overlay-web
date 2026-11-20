import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { Doc } from '../_generated/dataModel'

/**
 * Outside agents joining a workspace over MCP: the request an admin approves, the agent's presence, and the
 * inbox it collects messages from. Every function is called by the Next server with the server secret; the
 * rules about who may approve, pause, or remove live in `McpAgentNetworkService`.
 */

const statusValidator = v.union(v.literal('pending'), v.literal('approved'), v.literal('declined'), v.literal('removed'))

const joinValidator = v.object({
  id: v.string(),
  grantId: v.string(),
  userId: v.string(),
  workspaceId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  status: statusValidator,
  agentId: v.optional(v.string()),
  principalId: v.optional(v.string()),
  pausedAt: v.optional(v.number()),
  requestedAt: v.number(),
  decidedAt: v.optional(v.number()),
  lastSeenAt: v.optional(v.number()),
})

const inboxItemValidator = v.object({
  id: v.string(),
  conversationId: v.string(),
  messageId: v.string(),
  turnId: v.string(),
  actorUserId: v.string(),
  fromName: v.string(),
  fromKind: v.union(v.literal('person'), v.literal('agent')),
  text: v.string(),
  lineage: v.optional(v.any()),
  threadRootMessageId: v.optional(v.string()),
  createdAt: v.number(),
  deliveredAt: v.optional(v.number()),
  repliedAt: v.optional(v.number()),
})

/** Presence is written at most this often; every MCP request would otherwise be a write. */
const PRESENCE_INTERVAL_MS = 20_000
/** Unanswered messages older than this are no longer offered. */
const INBOX_TTL_MS = 7 * 24 * 60 * 60_000
const MAX_INBOX_TEXT = 8_000
const AWAY_NOTICE_INTERVAL_MS = 60 * 60_000

function toJoin(row: Doc<'mcpAgentJoins'>) {
  return {
    id: row._id as string, grantId: row.grantId, userId: row.userId, workspaceId: row.workspaceId, name: row.name,
    description: row.description, status: row.status, agentId: row.agentId, principalId: row.principalId,
    pausedAt: row.pausedAt, requestedAt: row.requestedAt, decidedAt: row.decidedAt, lastSeenAt: row.lastSeenAt,
  }
}

function toInboxItem(row: Doc<'mcpAgentInbox'>) {
  return {
    id: row._id as string, conversationId: row.conversationId, messageId: row.messageId, turnId: row.turnId,
    actorUserId: row.actorUserId, fromName: row.fromName, fromKind: row.fromKind, text: row.text, lineage: row.lineage,
    threadRootMessageId: row.threadRootMessageId, createdAt: row.createdAt, deliveredAt: row.deliveredAt, repliedAt: row.repliedAt,
  }
}

async function joinByGrant(ctx: QueryCtx | MutationCtx, grantId: string) {
  return await ctx.db.query('mcpAgentJoins').withIndex('by_grantId', (q) => q.eq('grantId', grantId)).first()
}

async function joinById(ctx: QueryCtx | MutationCtx, joinId: string) {
  const id = ctx.db.normalizeId('mcpAgentJoins', joinId)
  return id ? await ctx.db.get(id) : null
}

export const getJoinByGrantByServer = query({
  args: { serverSecret: v.string(), grantId: v.string() },
  returns: v.union(v.null(), joinValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await joinByGrant(ctx, args.grantId)
    return row ? toJoin(row) : null
  },
})

export const getJoinByServer = query({
  args: { serverSecret: v.string(), joinId: v.string() },
  returns: v.union(v.null(), joinValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await joinById(ctx, args.joinId)
    return row ? toJoin(row) : null
  },
})

/** Joins for the given agents, to show which workspace agents are outside agents and whether they are around. */
export const listJoinsByWorkspaceByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.array(joinValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('mcpAgentJoins').withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).take(500)
    return rows.filter((row) => row.status === 'pending' || row.status === 'approved')
      .sort((a, b) => b.requestedAt - a.requestedAt).map(toJoin)
  },
})

/** One request per grant. Asking again while pending updates the name; a decided request is returned unchanged. */
export const requestJoinByServer = mutation({
  args: {
    serverSecret: v.string(), grantId: v.string(), userId: v.string(), workspaceId: v.string(),
    name: v.string(), description: v.optional(v.string()), maxOpen: v.number(), now: v.number(),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()), join: v.optional(joinValidator) }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const existing = await joinByGrant(ctx, args.grantId)
    if (existing) {
      if (existing.status === 'pending') {
        await ctx.db.patch(existing._id, { name: args.name, description: args.description })
        return { ok: true, join: toJoin({ ...existing, name: args.name, description: args.description }) }
      }
      return { ok: true, join: toJoin(existing) }
    }
    const open = (await ctx.db.query('mcpAgentJoins').withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).take(500))
      .filter((row) => row.status === 'pending' || row.status === 'approved')
    if (open.length >= args.maxOpen) return { ok: false, reason: 'too_many_agents' }
    const id = await ctx.db.insert('mcpAgentJoins', {
      grantId: args.grantId, userId: args.userId, workspaceId: args.workspaceId, name: args.name,
      ...(args.description ? { description: args.description } : {}), status: 'pending', requestedAt: args.now, lastSeenAt: args.now,
    })
    return { ok: true, join: toJoin((await ctx.db.get(id))!) }
  },
})

/** Approve (with the agent row the server just created) or decline a pending request. */
export const decideJoinByServer = mutation({
  args: {
    serverSecret: v.string(), joinId: v.string(), workspaceId: v.string(), decidedByUserId: v.string(), now: v.number(),
    decision: v.union(v.literal('approved'), v.literal('declined')),
    agentId: v.optional(v.string()), principalId: v.optional(v.string()),
  },
  returns: v.union(v.null(), joinValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await joinById(ctx, args.joinId)
    if (!row || row.workspaceId !== args.workspaceId || row.status !== 'pending') return null
    if (args.decision === 'approved' && (!args.agentId || !args.principalId)) throw new Error('MCP_AGENT_REQUIRED')
    await ctx.db.patch(row._id, {
      status: args.decision, decidedAt: args.now, decidedByUserId: args.decidedByUserId,
      ...(args.decision === 'approved' ? { agentId: args.agentId, principalId: args.principalId } : {}),
    })
    return toJoin((await ctx.db.get(row._id))!)
  },
})

/** Pause or resume an approved agent, or remove it (which also clears what was waiting for it). */
export const updateJoinByServer = mutation({
  args: {
    serverSecret: v.string(), joinId: v.string(), workspaceId: v.string(), now: v.number(),
    action: v.union(v.literal('pause'), v.literal('resume'), v.literal('remove')),
  },
  returns: v.union(v.null(), joinValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await joinById(ctx, args.joinId)
    if (!row || row.workspaceId !== args.workspaceId || (row.status !== 'approved' && row.status !== 'pending')) return null
    if (args.action === 'remove') {
      await ctx.db.patch(row._id, { status: 'removed', decidedAt: args.now })
      if (row.agentId) {
        const waiting = await ctx.db.query('mcpAgentInbox').withIndex('by_agentId_createdAt', (q) => q.eq('agentId', row.agentId!)).take(500)
        for (const item of waiting) await ctx.db.delete(item._id)
      }
    } else if (row.status === 'approved') {
      await ctx.db.patch(row._id, { pausedAt: args.action === 'pause' ? args.now : undefined })
    }
    return toJoin((await ctx.db.get(row._id))!)
  },
})

/** A grant that is revoked takes its agent's membership with it. */
export const removeJoinByGrantByServer = mutation({
  args: { serverSecret: v.string(), grantId: v.string(), now: v.number() },
  returns: v.union(v.null(), joinValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await joinByGrant(ctx, args.grantId)
    if (!row || (row.status !== 'approved' && row.status !== 'pending')) return null
    await ctx.db.patch(row._id, { status: 'removed', decidedAt: args.now })
    return toJoin({ ...row, status: 'removed', decidedAt: args.now })
  },
})

export const touchPresenceByServer = mutation({
  args: { serverSecret: v.string(), joinId: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await joinById(ctx, args.joinId)
    if (row && (row.lastSeenAt === undefined || args.now - row.lastSeenAt > PRESENCE_INTERVAL_MS)) {
      await ctx.db.patch(row._id, { lastSeenAt: args.now })
    }
    return null
  },
})

/** Presence for a set of agents: when each was last seen, and whether it is paused. Absent for agents that are not MCP agents. */
export const presenceByAgentsByServer = query({
  args: { serverSecret: v.string(), agentIds: v.array(v.string()) },
  returns: v.array(v.object({ agentId: v.string(), lastSeenAt: v.optional(v.number()), paused: v.boolean(), ownerUserId: v.string() })),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const out: Array<{ agentId: string; lastSeenAt?: number; paused: boolean; ownerUserId: string }> = []
    for (const agentId of args.agentIds.slice(0, 100)) {
      const row = await ctx.db.query('mcpAgentJoins').withIndex('by_agentId', (q) => q.eq('agentId', agentId)).first()
      if (row && row.status === 'approved') {
        out.push({ agentId, ...(row.lastSeenAt === undefined ? {} : { lastSeenAt: row.lastSeenAt }), paused: row.pausedAt !== undefined, ownerUserId: row.userId })
      }
    }
    return out
  },
})

/** Tell the owner a message is waiting for their agent, which is not connected. At most once an hour per agent. */
export const notifyOwnerAwayByServer = mutation({
  args: {
    serverSecret: v.string(), agentId: v.string(), ownerPrincipalId: v.string(), conversationId: v.string(),
    fromName: v.string(), now: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const join = await ctx.db.query('mcpAgentJoins').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).first()
    if (!join || join.status !== 'approved' || !join.principalId) return false
    if (join.lastAwayNoticeAt !== undefined && args.now - join.lastAwayNoticeAt < AWAY_NOTICE_INTERVAL_MS) return false
    const conversationId = ctx.db.normalizeId('conversations', args.conversationId)
    if (!conversationId) return false
    await ctx.db.patch(join._id, { lastAwayNoticeAt: args.now })
    await ctx.db.insert('workspaceNotifications', {
      notificationId: crypto.randomUUID(), workspaceId: join.workspaceId, recipientPrincipalId: args.ownerPrincipalId,
      type: 'message', conversationId, actorPrincipalId: join.principalId,
      title: `${join.name} has a message waiting`,
      body: `From ${args.fromName.slice(0, 80)}. ${join.name} is not connected and will see it when it next connects.`,
      eventSequence: args.now, createdAt: args.now,
    })
    return true
  },
})

/** Queue a message for an agent. The same (agent, turn) is queued once, so a retried send does not duplicate it. */
export const enqueueInboxByServer = mutation({
  args: {
    serverSecret: v.string(), agentId: v.string(), workspaceId: v.string(), conversationId: v.string(), messageId: v.string(),
    turnId: v.string(), actorUserId: v.string(), fromName: v.string(), fromKind: v.union(v.literal('person'), v.literal('agent')),
    text: v.string(), lineage: v.optional(v.any()), threadRootMessageId: v.optional(v.string()), now: v.number(),
  },
  returns: v.object({ queued: v.boolean(), lastSeenAt: v.optional(v.number()), paused: v.boolean() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const join = await ctx.db.query('mcpAgentJoins').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).first()
    if (!join || join.status !== 'approved' || join.workspaceId !== args.workspaceId) return { queued: false, paused: false }
    const presence = { ...(join.lastSeenAt === undefined ? {} : { lastSeenAt: join.lastSeenAt }), paused: join.pausedAt !== undefined }
    if (join.pausedAt !== undefined) return { queued: false, ...presence }
    const existing = await ctx.db.query('mcpAgentInbox')
      .withIndex('by_agentId_turnId', (q) => q.eq('agentId', args.agentId).eq('turnId', args.turnId)).first()
    if (existing) return { queued: true, ...presence }
    await ctx.db.insert('mcpAgentInbox', {
      agentId: args.agentId, workspaceId: args.workspaceId, conversationId: args.conversationId, messageId: args.messageId,
      turnId: args.turnId, actorUserId: args.actorUserId, fromName: args.fromName.slice(0, 120), fromKind: args.fromKind,
      text: args.text.slice(0, MAX_INBOX_TEXT), ...(args.lineage === undefined ? {} : { lineage: args.lineage }),
      ...(args.threadRootMessageId ? { threadRootMessageId: args.threadRootMessageId } : {}), createdAt: args.now,
    })
    return { queued: true, ...presence }
  },
})

async function openInbox(ctx: QueryCtx | MutationCtx, agentId: string, now: number) {
  const rows = await ctx.db.query('mcpAgentInbox')
    .withIndex('by_agentId_createdAt', (q) => q.eq('agentId', agentId).gt('createdAt', now - INBOX_TTL_MS))
    .order('desc').take(200)
  return rows.filter((row) => row.repliedAt === undefined).reverse()
}

/** How many messages the agent has not been shown yet. Read on every tool call for the unread notice. */
export const countUnreadByServer = query({
  args: { serverSecret: v.string(), agentId: v.string(), now: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return (await openInbox(ctx, args.agentId, args.now)).filter((row) => row.deliveredAt === undefined).length
  },
})

/**
 * The agent collects its messages: everything not yet answered, oldest first, with the ones it had not seen
 * before marked as shown. `onlyNew` is what a long-poll uses, so a waiting agent wakes only for new messages.
 */
export const collectInboxByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string(), onlyNew: v.boolean(), limit: v.number(), now: v.number() },
  returns: v.array(inboxItemValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const open = await openInbox(ctx, args.agentId, args.now)
    const chosen = (args.onlyNew ? open.filter((row) => row.deliveredAt === undefined) : open).slice(0, Math.max(1, Math.min(50, args.limit)))
    for (const row of chosen) {
      if (row.deliveredAt === undefined) await ctx.db.patch(row._id, { deliveredAt: args.now })
    }
    return chosen.map(toInboxItem)
  },
})

export const getInboxItemByServer = query({
  args: { serverSecret: v.string(), agentId: v.string(), itemId: v.string() },
  returns: v.union(v.null(), inboxItemValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('mcpAgentInbox', args.itemId)
    const row = id ? await ctx.db.get(id) : null
    return row && row.agentId === args.agentId ? toInboxItem(row) : null
  },
})

export const markRepliedByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string(), itemId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const id = ctx.db.normalizeId('mcpAgentInbox', args.itemId)
    const row = id ? await ctx.db.get(id) : null
    if (!row || row.agentId !== args.agentId || row.repliedAt !== undefined) return false
    await ctx.db.patch(row._id, { repliedAt: args.now, deliveredAt: row.deliveredAt ?? args.now })
    return true
  },
})

/** The most recent message shown to the agent, which decides the chain its next question belongs to. */
export const latestDeliveredByServer = query({
  args: { serverSecret: v.string(), agentId: v.string(), since: v.number() },
  returns: v.union(v.null(), inboxItemValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('mcpAgentInbox')
      .withIndex('by_agentId_createdAt', (q) => q.eq('agentId', args.agentId).gt('createdAt', args.since))
      .order('desc').take(50)
    const latest = rows.filter((row) => row.deliveredAt !== undefined).sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0))[0]
    return latest ? toInboxItem(latest) : null
  },
})

/** Account deletion: remove the person's join requests. Their agents are archived by the caller. */
export const deleteAllByUserByServer = mutation({
  args: { serverSecret: v.string(), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('mcpAgentJoins').withIndex('by_userId', (q) => q.eq('userId', args.userId)).take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    const removed = rows.length
    return removed
  },
})
