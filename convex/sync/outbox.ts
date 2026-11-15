import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction, internalMutation, internalQuery, mutation } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { validateServerSecret } from '../lib/auth'
import { fetchAppCallback } from '../lib/appCallback'

type Action = Doc<'syncOutbox'>['action']

/** How long a claimed row stays with one worker before another may retry it. */
const LEASE_MS = 60_000
const MAX_ATTEMPTS = 6
const MAX_BACKOFF_MS = 15 * 60_000
/** Edits we sent within this window explain an inbound edit of the same message. */
const ECHO_WINDOW_MS = 2 * 60_000
/** An inbound message from someone whose post is in flight waits this long, then is checked again. */
export const SYNC_ECHO_RECHECK_MS = 2_000
const DONE_RETENTION_MS = 24 * 60 * 60_000
const FAILED_RETENTION_MS = 14 * 24 * 60 * 60_000
const PLATFORM = { slack: 'Slack', teams: 'Microsoft Teams' } as const

const isOpen = (row: Doc<'syncOutbox'>) => row.state === 'pending' || row.state === 'claimed'

async function mappingFor(ctx: Pick<QueryCtx, 'db'>, messageId: Id<'conversationMessages'>) {
  return await ctx.db.query('syncMessageMap').withIndex('by_messageId', q => q.eq('messageId', messageId)).first()
}

async function rowsFor(ctx: Pick<QueryCtx, 'db'>, messageId: Id<'conversationMessages'>) {
  return await ctx.db.query('syncOutbox').withIndex('by_messageId', q => q.eq('messageId', messageId)).collect()
}

async function activeAccount(ctx: Pick<QueryCtx, 'db'>, workspaceId: string, userId: string, provider: Doc<'syncChannelLinks'>['provider']) {
  const account = await ctx.db.query('syncMemberAccounts')
    .withIndex('by_workspaceId_userId_provider', q => q.eq('workspaceId', workspaceId).eq('userId', userId).eq('provider', provider))
    .unique()
  return account?.status === 'active' ? account : null
}

/**
 * Queues a member's change in a linked channel for mirroring with their own
 * account. Called inside the mutation that made the change. Only messages the
 * member wrote in Overlay are posted, edited or deleted outward; reactions
 * mirror on any message that exists on the platform.
 */
export async function enqueueSyncOutbound(
  ctx: MutationCtx,
  args: { messageId: Id<'conversationMessages'>; actorUserId: string; action: Action; emoji?: string },
) {
  const message = await ctx.db.get(args.messageId)
  if (!message) return
  const link = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', message.conversationId)).unique()
  if (!link || link.status === 'paused') return
  if (!await activeAccount(ctx, link.workspaceId, args.actorUserId, link.provider)) return
  const [mapping, rows] = await Promise.all([mappingFor(ctx, message._id), rowsFor(ctx, message._id)])
  const post = rows.find(row => row.action === 'post')
  const now = Date.now()
  if (args.action === 'post') {
    if (message.authorKind !== 'human' || message.turnId.startsWith('sync:') || mapping || post) return
  } else if (args.action === 'edit' || args.action === 'delete') {
    if (mapping && mapping.direction !== 'outbound') return
    if (!mapping) {
      if (post?.state === 'pending' && args.action === 'delete') {
        await ctx.db.patch(post._id, { state: 'done', lastError: 'Deleted before it was sent', nextAttemptAt: now, updatedAt: now })
      }
      if (post?.state !== 'claimed') return
    }
    if (rows.some(row => row.action === args.action && row.state === 'pending')) return
  } else {
    if (!mapping && !(post && isOpen(post))) return
    const opposite = rows.find(row => row.state === 'pending' && row.actorUserId === args.actorUserId
      && row.emoji === args.emoji && (row.action === 'react' || row.action === 'unreact') && row.action !== args.action)
    if (opposite) {
      await ctx.db.delete(opposite._id)
      return
    }
  }
  await ctx.db.insert('syncOutbox', {
    linkId: link._id,
    workspaceId: link.workspaceId,
    provider: link.provider,
    messageId: message._id,
    action: args.action,
    actorUserId: args.actorUserId,
    ...(args.emoji ? { emoji: args.emoji } : {}),
    state: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.sync.outbox.dispatch, {})
}

/**
 * True while one of this external person's Overlay posts to the link is being
 * sent. Its echo can arrive before the platform returns the new message id, so
 * inbound processing waits instead of creating a second copy.
 */
export async function outboundPostInFlight(ctx: Pick<QueryCtx, 'db'>, link: Doc<'syncChannelLinks'>, externalUserId: string, now: number) {
  const accounts = await ctx.db.query('syncMemberAccounts')
    .withIndex('by_provider_externalOrgId_externalUserId', q => q
      .eq('provider', link.provider).eq('externalOrgId', link.externalOrgId).eq('externalUserId', externalUserId))
    .collect()
  const userIds = new Set(accounts.filter(account => account.workspaceId === link.workspaceId).map(account => account.userId))
  if (userIds.size === 0) return false
  const claimed = await ctx.db.query('syncOutbox')
    .withIndex('by_state_nextAttemptAt', q => q.eq('state', 'claimed').gt('nextAttemptAt', now))
    .collect()
  return claimed.some(row => row.linkId === link._id && row.action === 'post' && userIds.has(row.actorUserId))
}

/** True when an inbound edit of an Overlay-authored message is the echo of an edit we sent. */
export async function outboundEditEcho(ctx: Pick<QueryCtx, 'db'>, messageId: Id<'conversationMessages'>, now: number) {
  const rows = await rowsFor(ctx, messageId)
  return rows.some(row => row.action === 'edit' && (isOpen(row) || (row.state === 'done' && row.updatedAt > now - ECHO_WINDOW_MS)))
}

async function settle(ctx: MutationCtx, row: Doc<'syncOutbox'>, state: 'done' | 'failed', lastError?: string) {
  const now = Date.now()
  await ctx.db.patch(row._id, { state, nextAttemptAt: now, updatedAt: now, ...(lastError ? { lastError } : {}) })
  return null
}

async function defer(ctx: MutationCtx, row: Doc<'syncOutbox'>, now: number) {
  await ctx.db.patch(row._id, { nextAttemptAt: now + 5_000, updatedAt: now })
  return null
}

/** Resolves everything the worker needs for one row and claims it, or settles rows that can't or needn't be sent. */
async function prepare(ctx: MutationCtx, row: Doc<'syncOutbox'>, now: number) {
  const link = await ctx.db.get(row.linkId)
  if (!link) return await settle(ctx, row, 'failed', 'The channel is no longer linked')
  if (link.status === 'paused') return await settle(ctx, row, 'failed', 'Sync is paused for this channel')
  const platform = PLATFORM[link.provider]
  const message = await ctx.db.get(row.messageId)
  if (!message) return await settle(ctx, row, 'failed', 'The message no longer exists')
  const account = await activeAccount(ctx, link.workspaceId, row.actorUserId, link.provider)
  if (!account) return await settle(ctx, row, 'failed', 'Connect your ' + platform + ' account to send')
  const mapping = await mappingFor(ctx, message._id)
  let externalThreadId: string | undefined
  if (row.action === 'post') {
    if (message.deletedAt || mapping) return await settle(ctx, row, 'done')
    if (!message.content.trim()) return await settle(ctx, row, 'failed', 'Only text is sent to ' + platform + ' for now')
    if (message.threadRootMessageId) {
      const root = await mappingFor(ctx, message.threadRootMessageId)
      if (!root) {
        const rootPost = (await rowsFor(ctx, message.threadRootMessageId)).find(other => other.action === 'post' && isOpen(other))
        return rootPost ? await defer(ctx, row, now) : await settle(ctx, row, 'failed', 'This thread started before the channel was linked to ' + platform)
      }
      externalThreadId = root.externalThreadId ?? root.externalMessageId
    }
  } else if (!mapping) {
    const post = (await rowsFor(ctx, message._id)).find(other => other.action === 'post' && isOpen(other))
    return post ? await defer(ctx, row, now) : await settle(ctx, row, 'failed', 'The message was never sent to ' + platform)
  } else if (row.action === 'edit' && message.deletedAt) {
    return await settle(ctx, row, 'done')
  }
  const threadId = externalThreadId ?? mapping?.externalThreadId
  await ctx.db.patch(row._id, { state: 'claimed', attempts: row.attempts + 1, nextAttemptAt: now + LEASE_MS, updatedAt: now })
  return {
    outboxId: row._id,
    action: row.action,
    ...(row.emoji ? { emoji: row.emoji } : {}),
    attempts: row.attempts + 1,
    link: {
      linkId: link._id,
      workspaceId: link.workspaceId,
      provider: link.provider,
      externalOrgId: link.externalOrgId,
      externalChannelId: link.externalChannelId,
      ...(link.externalGroupId ? { externalGroupId: link.externalGroupId } : {}),
      conversationId: link.conversationId,
    },
    actorUserId: row.actorUserId,
    externalUserId: account.externalUserId,
    sealedToken: account.sealedToken,
    content: message.content,
    ...(threadId ? { externalThreadId: threadId } : {}),
    ...(mapping ? { externalMessageId: mapping.externalMessageId } : {}),
  }
}

/** Claims due rows (and rows whose worker lease expired) for the outbound worker. */
export const claimDue = mutation({
  args: { serverSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50)
    const now = Date.now()
    const pending = await ctx.db.query('syncOutbox').withIndex('by_state_nextAttemptAt', q => q.eq('state', 'pending').lte('nextAttemptAt', now)).take(limit)
    const expired = await ctx.db.query('syncOutbox').withIndex('by_state_nextAttemptAt', q => q.eq('state', 'claimed').lte('nextAttemptAt', now)).take(limit)
    const work: Array<NonNullable<Awaited<ReturnType<typeof prepare>>>> = []
    for (const row of [...pending, ...expired].sort((a, b) => a.createdAt - b.createdAt).slice(0, limit)) {
      const item = await prepare(ctx, row, now)
      if (item) work.push(item)
    }
    return work
  },
})

/**
 * Marks a row sent. A post records its platform id in the message map in the
 * same transaction; if the echo already created an Overlay copy (its wait ran
 * out), that copy is folded into the original so only one message remains.
 */
export const complete = mutation({
  args: { serverSecret: v.string(), outboxId: v.id('syncOutbox'), externalMessageId: v.optional(v.string()), externalThreadId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const row = await ctx.db.get(args.outboxId)
    if (!row || row.state !== 'claimed') return null
    const link = await ctx.db.get(row.linkId)
    if (row.action === 'post' && args.externalMessageId && link) {
      const existing = await ctx.db.query('syncMessageMap')
        .withIndex('by_provider_externalChannelId_externalMessageId', q => q
          .eq('provider', link.provider).eq('externalChannelId', link.externalChannelId).eq('externalMessageId', args.externalMessageId!))
        .unique()
      if (existing && existing.messageId !== row.messageId) {
        const reactions = await ctx.db.query('conversationMessageReactions')
          .withIndex('by_messageId_principalId_emoji', q => q.eq('messageId', existing.messageId))
          .collect()
        for (const reaction of reactions) await ctx.db.patch(reaction._id, { messageId: row.messageId })
        await ctx.db.delete(existing.messageId)
        await ctx.runMutation(internal.knowledge.knowledge.purgeKnowledgeSource, { sourceKind: 'message', sourceId: existing.messageId })
        await ctx.db.patch(existing._id, { messageId: row.messageId, direction: 'outbound' })
      } else if (!existing) {
        await ctx.db.insert('syncMessageMap', {
          linkId: link._id,
          conversationId: link.conversationId,
          provider: link.provider,
          externalChannelId: link.externalChannelId,
          externalMessageId: args.externalMessageId,
          ...(args.externalThreadId ? { externalThreadId: args.externalThreadId } : {}),
          messageId: row.messageId,
          direction: 'outbound',
          createdAt: Date.now(),
        })
      }
    }
    return await settle(ctx, row, 'done')
  },
})

/** Returns a claimed row to the queue with backoff, or fails it for good with a reason the member can read. */
export const release = mutation({
  args: {
    serverSecret: v.string(), outboxId: v.id('syncOutbox'), error: v.string(),
    retryAfterMs: v.optional(v.number()), permanent: v.optional(v.boolean()), refundAttempt: v.optional(v.boolean()),
    revokeAccount: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const row = await ctx.db.get(args.outboxId)
    if (!row || row.state !== 'claimed') return null
    const now = Date.now()
    const lastError = args.error.slice(0, 300)
    if (args.revokeAccount) {
      const account = await activeAccount(ctx, row.workspaceId, row.actorUserId, row.provider)
      if (account) await ctx.db.patch(account._id, { status: 'revoked', sealedToken: '', sealedRefreshToken: undefined, updatedAt: now })
    }
    const attempts = args.refundAttempt ? Math.max(row.attempts - 1, 0) : row.attempts
    if (args.permanent || attempts >= MAX_ATTEMPTS) return await settle(ctx, row, 'failed', lastError)
    const backoff = Math.min(MAX_BACKOFF_MS, 10_000 * 2 ** Math.max(attempts - 1, 0))
    await ctx.db.patch(row._id, { state: 'pending', attempts, nextAttemptAt: now + (args.retryAfterMs ?? backoff), lastError, updatedAt: now })
    return null
  },
})

export const hasDue = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async ctx => {
    const now = Date.now()
    for (const state of ['pending', 'claimed'] as const) {
      if (await ctx.db.query('syncOutbox').withIndex('by_state_nextAttemptAt', q => q.eq('state', state).lte('nextAttemptAt', now)).first()) return true
    }
    return false
  },
})

/** Wakes the web server's outbound worker, which holds the platform clients and opens members' tokens. */
export const dispatch = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!baseUrl || !serverSecret) {
      console.warn('[sync/outbox] OVERLAY_BFF_URL or INTERNAL_API_SECRET is not configured; outbound sync deferred')
      return null
    }
    const response = await fetchAppCallback(baseUrl + '/api/v1/sync/outbound', {
      method: 'POST',
      headers: { 'x-internal-api-secret': serverSecret },
    })
    if (!response.ok) throw new Error('sync_outbound_dispatch_failed:' + response.status)
    return null
  },
})

/** Cron: retries due rows and rows a crashed worker left claimed. */
export const sweep = internalAction({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    if (await ctx.runQuery(internal.sync.outbox.hasDue, {})) await ctx.scheduler.runAfter(0, internal.sync.outbox.dispatch, {})
    return null
  },
})

/** Cron: drops settled rows once they can no longer explain an echo or help debugging. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const now = Date.now()
    for (const [state, retention] of [['done', DONE_RETENTION_MS], ['failed', FAILED_RETENTION_MS]] as const) {
      const rows = await ctx.db.query('syncOutbox').withIndex('by_state_nextAttemptAt', q => q.eq('state', state).lt('nextAttemptAt', now - retention)).take(200)
      for (const row of rows) await ctx.db.delete(row._id)
    }
    return null
  },
})
