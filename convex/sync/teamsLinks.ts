import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction, internalQuery, query } from '../_generated/server'
import type { QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { validateServerSecret } from '../lib/auth'
import { fetchAppCallback } from '../lib/appCallback'
import { isTeamsAppMissingReason } from '../../src/shared/sync/teams'
import { syncExternalPrincipalId } from '../../src/shared/sync/types'

/** Subscriptions are renewed once they are this close to expiring; Graph allows just under 3 days for channel messages. */
const RENEW_WITHIN_MS = 12 * 60 * 60 * 1000
/** Links paused because Overlay is missing in Teams are retried this often, so re-adding the app resumes them. */
const RETRY_PAUSED_AFTER_MS = 15 * 60 * 1000
const BATCH = 25

function teamsLinkView(link: Doc<'syncChannelLinks'>) {
  return {
    linkId: link._id,
    workspaceId: link.workspaceId,
    externalOrgId: link.externalOrgId,
    externalGroupId: link.externalGroupId ?? null,
    externalChannelId: link.externalChannelId,
    externalChannelKind: link.externalChannelKind,
    conversationId: link.conversationId,
    status: link.status,
    pauseReason: link.pauseReason ?? null,
    subscriptionId: link.subscriptionId ?? null,
    subscriptionExpiresAt: link.subscriptionExpiresAt ?? null,
    historyCompletedAt: link.historyCompletedAt ?? null,
    lastEventAt: link.lastEventAt ?? null,
  }
}

export type TeamsLinkView = ReturnType<typeof teamsLinkView>

async function maintenance(ctx: Pick<QueryCtx, 'db'>, now: number) {
  const active: Doc<'syncChannelLinks'>[] = []
  for (const status of ['syncing', 'history', 'catching_up'] as const) {
    active.push(...await ctx.db.query('syncChannelLinks')
      .withIndex('by_provider_status_updatedAt', q => q.eq('provider', 'teams').eq('status', status))
      .take(500))
  }
  const standard = active.filter(link => link.externalChannelKind === 'public')
  const paused = await ctx.db.query('syncChannelLinks')
    .withIndex('by_provider_status_updatedAt', q => q.eq('provider', 'teams').eq('status', 'paused').lt('updatedAt', now - RETRY_PAUSED_AFTER_MS))
    .take(200)
  return {
    subscribe: standard.filter(link => !link.subscriptionId).slice(0, BATCH),
    renew: standard.filter(link => link.subscriptionId && (link.subscriptionExpiresAt ?? 0) < now + RENEW_WITHIN_MS).slice(0, BATCH),
    poll: active.filter(link => link.externalChannelKind !== 'public').slice(0, 2 * BATCH),
    retry: paused.filter(link => isTeamsAppMissingReason(link.pauseReason)).slice(0, BATCH),
  }
}

/**
 * Teams links that need work this tick: standard channels without a Graph
 * subscription or with one close to expiring, private and shared channels
 * (Graph refuses resource-specific-consent subscriptions there, so they are
 * polled), and links paused because Overlay was missing in Teams.
 */
export const listMaintenance = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const due = await maintenance(ctx, Date.now())
    return {
      subscribe: due.subscribe.map(teamsLinkView),
      renew: due.renew.map(teamsLinkView),
      poll: due.poll.map(teamsLinkView),
      retry: due.retry.map(teamsLinkView),
    }
  },
})

export const hasMaintenanceWork = internalQuery({
  args: { now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const due = await maintenance(ctx, args.now)
    return due.subscribe.length + due.renew.length + due.poll.length + due.retry.length > 0
  },
})

/** Cron entry: hands due Teams work to the web server, which holds the Microsoft credentials. Idle deployments make no call. */
export const runMaintenanceTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!await ctx.runQuery(internal.sync.teamsLinks.hasMaintenanceWork, { now: Date.now() })) return null
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    if (!baseUrl) {
      console.warn('[sync/teams] OVERLAY_BFF_URL is not configured; Teams maintenance deferred')
      return null
    }
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!internalSecret) throw new Error('teams_sync_maintenance_secret_missing')
    const response = await fetchAppCallback(baseUrl + '/api/v1/sync/teams/maintain', {
      method: 'POST',
      headers: { 'x-internal-api-secret': internalSecret },
    })
    if (!response.ok) throw new Error('teams_sync_maintenance_failed:' + response.status)
    return null
  },
})

/** One Teams link by id, for lifecycle notifications, which carry only the subscription and our clientState. */
export const getLink = query({
  args: { serverSecret: v.string(), linkId: v.string() },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const id = ctx.db.normalizeId('syncChannelLinks', args.linkId)
    const link = id ? await ctx.db.get(id) : null
    return link && link.provider === 'teams' ? teamsLinkView(link) : null
  },
})

/**
 * Reactions on a synced Teams message that came from Teams people, as
 * external user id and emoji. Graph reports a message's full reaction set, so
 * the web server diffs against this to emit removals. Reactions made only in
 * Overlay by members without a Teams identity are never listed or removed.
 */
export const messageReactions = query({
  args: { serverSecret: v.string(), externalChannelId: v.string(), externalMessageId: v.string() },
  returns: v.array(v.object({ externalUserId: v.string(), emoji: v.string() })),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const mapped = await ctx.db.query('syncMessageMap')
      .withIndex('by_provider_externalChannelId_externalMessageId', q => q
        .eq('provider', 'teams').eq('externalChannelId', args.externalChannelId).eq('externalMessageId', args.externalMessageId))
      .unique()
    if (!mapped) return []
    const message = await ctx.db.get(mapped.messageId)
    if (!message) return []
    const reactions = await ctx.db.query('conversationMessageReactions')
      .withIndex('by_messageId_principalId_emoji', q => q.eq('messageId', mapped.messageId))
      .collect()
    const prefix = syncExternalPrincipalId('teams', '')
    const result: Array<{ externalUserId: string; emoji: string }> = []
    for (const reaction of reactions) {
      if (reaction.principalId.startsWith(prefix)) {
        result.push({ externalUserId: reaction.principalId.slice(prefix.length), emoji: reaction.emoji })
        continue
      }
      const identity = await ctx.db.query('syncIdentities')
        .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', reaction.workspaceId).eq('principalId', reaction.principalId))
        .filter(q => q.eq(q.field('provider'), 'teams'))
        .first()
      if (identity) result.push({ externalUserId: identity.externalUserId, emoji: reaction.emoji })
    }
    return result
  },
})
