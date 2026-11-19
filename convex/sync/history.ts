import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction, internalQuery, mutation } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { validateServerSecret } from '../lib/auth'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { fetchAppCallback } from '../lib/appCallback'
import { providerValidator } from './validators'

/** Gap repair runs once a day per syncing link, after this hour (UTC; about 2–3 a.m. Pacific). */
const REPAIR_HOUR_UTC = 10
const DEFAULT_MAX_WORKSPACES = 8
const DEFAULT_LEASE_MS = 3 * 60_000
const WORKSPACE_SCAN_LIMIT = 200

type Link = Doc<'syncChannelLinks'>

/** The most recent nightly repair cutoff at or before now. */
export function repairCutoff(now: number): number {
  const day = new Date(now)
  const today = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), REPAIR_HOUR_UTC)
  return today <= now ? today : today - 24 * 60 * 60 * 1000
}

async function resumeCaughtUp(ctx: Pick<MutationCtx, 'db'>, now: number) {
  const rows = await ctx.db.query('syncChannelLinks').withIndex('by_status_updatedAt', q => q.eq('status', 'catching_up')).take(100)
  for (const link of rows) {
    if (link.catchUpUntil !== undefined && link.catchUpUntil > now) continue
    await ctx.db.patch(link._id, {
      status: link.historyCompletedAt !== undefined ? 'syncing' : 'history',
      catchUpUntil: undefined,
      repairedAt: undefined,
      repairCursor: undefined,
      updatedAt: now,
    })
  }
}

async function dueRepairs(ctx: Pick<QueryCtx, 'db'>, now: number) {
  const cutoff = repairCutoff(now)
  const never = await ctx.db.query('syncChannelLinks')
    .withIndex('by_status_repairedAt', q => q.eq('status', 'syncing').eq('repairedAt', undefined))
    .take(WORKSPACE_SCAN_LIMIT)
  const stale = await ctx.db.query('syncChannelLinks')
    .withIndex('by_status_repairedAt', q => q.eq('status', 'syncing').gt('repairedAt', 0).lt('repairedAt', cutoff))
    .take(WORKSPACE_SCAN_LIMIT)
  return [...never, ...stale]
}

/** One history link per workspace: the one a member asked for, else the one served longest ago. */
async function historyCandidates(ctx: Pick<QueryCtx, 'db'>) {
  const firsts: Link[] = []
  let after: string | undefined
  for (let index = 0; index < WORKSPACE_SCAN_LIMIT; index += 1) {
    const next = await ctx.db.query('syncChannelLinks')
      .withIndex('by_status_workspaceId_updatedAt', q => after === undefined
        ? q.eq('status', 'history')
        : q.eq('status', 'history').gt('workspaceId', after))
      .first()
    if (!next) break
    after = next.workspaceId
    firsts.push(next)
  }
  firsts.sort((a, b) => a.updatedAt - b.updatedAt)
  const picked: Link[] = []
  for (const first of firsts) {
    const prioritized = await ctx.db.query('syncChannelLinks')
      .withIndex('by_status_workspaceId_historyPriorityAt', q => q.eq('status', 'history').eq('workspaceId', first.workspaceId))
      .order('desc')
      .first()
    picked.push(prioritized?.historyPriorityAt !== undefined ? prioritized : first)
  }
  return picked
}

function workView(link: Link, mode: 'history' | 'repair') {
  return {
    mode,
    link: {
      linkId: link._id,
      workspaceId: link.workspaceId,
      provider: link.provider,
      externalOrgId: link.externalOrgId,
      externalChannelId: link.externalChannelId,
      ...(link.externalGroupId ? { externalGroupId: link.externalGroupId } : {}),
      conversationId: link.conversationId,
      ...(link.historyTargetAt !== undefined ? { historyTargetAt: link.historyTargetAt } : {}),
      ...(link.historyOldestAt !== undefined ? { historyOldestAt: link.historyOldestAt } : {}),
      ...(link.historyCursor ? { historyCursor: link.historyCursor } : {}),
      ...(link.repairCursor ? { repairCursor: link.repairCursor } : {}),
    },
  }
}

export type SyncHistoryWork = ReturnType<typeof workView>

/**
 * Leases the next history and repair work for the web server's worker. Links
 * whose catch-up window has passed resume first. Each workspace gets at most
 * one link at a time (its Slack or Graph budget is shared anyway), repair goes
 * before history, and at most maxWorkspaces workspaces run at once, counting
 * leases still held by an earlier tick, so one big workspace never starves the rest.
 */
export const claimWork = mutation({
  args: { serverSecret: v.string(), maxWorkspaces: v.optional(v.number()), leaseMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const now = Date.now()
    await resumeCaughtUp(ctx, now)
    const leased = await ctx.db.query('syncChannelLinks').withIndex('by_historyLeaseUntil', q => q.gt('historyLeaseUntil', now)).take(100)
    const busy = new Set(leased.map(link => link.workspaceId))
    const slots = Math.min(args.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES, 50) - busy.size
    const work: SyncHistoryWork[] = []
    const consider = (links: Link[], mode: 'history' | 'repair') => {
      for (const link of links) {
        if (work.length >= slots) return
        if (busy.has(link.workspaceId) || (link.historyLeaseUntil ?? 0) > now) continue
        busy.add(link.workspaceId)
        work.push(workView(link, mode))
      }
    }
    if (slots <= 0) return work
    consider(await dueRepairs(ctx, now), 'repair')
    consider(await historyCandidates(ctx), 'history')
    const leaseUntil = now + (args.leaseMs ?? DEFAULT_LEASE_MS)
    for (const item of work) await ctx.db.patch(item.link.linkId, { historyLeaseUntil: leaseUntil })
    return work
  },
})

/**
 * Saves repair progress, finishes a history import and releases a worker's
 * lease. A finished import moves to syncing only if nothing paused or
 * rate-limited it meanwhile, and its first gap repair becomes due at once.
 * Null clears a field.
 */
export const updateWork = mutation({
  args: {
    serverSecret: v.string(),
    linkId: v.id('syncChannelLinks'),
    repairCursor: v.optional(v.union(v.string(), v.null())),
    repairedAt: v.optional(v.union(v.number(), v.null())),
    completeHistory: v.optional(v.boolean()),
    release: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const link = await ctx.db.get(args.linkId)
    if (!link) return null
    await ctx.db.patch(link._id, {
      ...(args.completeHistory
        ? { status: link.status === 'history' ? 'syncing' : link.status, repairedAt: undefined, repairCursor: undefined, updatedAt: Date.now() }
        : {}),
      ...(args.repairCursor !== undefined ? { repairCursor: args.repairCursor ?? undefined } : {}),
      ...(args.repairedAt !== undefined ? { repairedAt: args.repairedAt ?? undefined } : {}),
      ...(args.release ? { historyLeaseUntil: undefined } : {}),
    })
    return null
  },
})

/**
 * Slack stopped delivering events for an org (app_rate_limited). Its live
 * links show Catching up and, once the window passes, resume and repair the
 * last day so dropped events are filled in.
 */
export const markCatchingUp = mutation({
  args: { serverSecret: v.string(), provider: providerValidator, externalOrgId: v.string(), catchUpUntil: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const now = Date.now()
    const links = await ctx.db.query('syncChannelLinks')
      .withIndex('by_provider_externalOrgId_externalChannelId', q => q.eq('provider', args.provider).eq('externalOrgId', args.externalOrgId))
      .collect()
    let marked = 0
    for (const link of links) {
      if (link.status === 'paused') continue
      await ctx.db.patch(link._id, {
        status: 'catching_up',
        catchUpUntil: Math.max(link.catchUpUntil ?? 0, args.catchUpUntil),
        updatedAt: now,
      })
      marked += 1
    }
    return marked
  },
})

/**
 * A member scrolled past imported history in a linked channel: import that
 * channel next. Quietly does nothing for unlinked or already imported channels.
 */
export const prioritize = mutation({
  args: { workspaceId: v.string(), conversationId: v.id('conversations') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireNativeWorkspace(ctx, args.workspaceId)
    const link = await ctx.db.query('syncChannelLinks').withIndex('by_conversationId', q => q.eq('conversationId', args.conversationId)).unique()
    if (!link || link.workspaceId !== args.workspaceId || link.status !== 'history') return null
    await ctx.db.patch(link._id, { historyPriorityAt: Date.now() })
    return null
  },
})

export const hasWorkInternal = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const now = Date.now()
    for (const status of ['history', 'catching_up'] as const) {
      if (await ctx.db.query('syncChannelLinks').withIndex('by_status_updatedAt', q => q.eq('status', status)).first()) return true
    }
    return (await dueRepairs(ctx, now)).length > 0
  },
})

/**
 * Cron entry: when any link has history, catch-up or repair work, asks the web
 * server's worker to run one bounded tick. Platform tokens stay on the web server.
 */
export const runTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!await ctx.runQuery(internal.sync.history.hasWorkInternal, {})) return null
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    const serverSecret = process.env.INTERNAL_API_SECRET
    if (!baseUrl || !serverSecret) {
      console.warn('[sync/history] OVERLAY_BFF_URL or INTERNAL_API_SECRET is not configured; history tick skipped')
      return null
    }
    const response = await fetchAppCallback(baseUrl + '/api/v1/sync/history/process', {
      method: 'POST',
      headers: { 'x-internal-api-secret': serverSecret },
    })
    if (!response.ok) throw new Error('sync_history_tick_failed:' + response.status)
    return null
  },
})
