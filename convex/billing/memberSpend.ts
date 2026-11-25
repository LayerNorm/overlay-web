import { v } from 'convex/values'
import { canManageWorkspace } from '@overlay/workspace-contracts'
import { mutation, query, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { spendLimitRow } from '../lib/spendLimitCharges'
import { workspaceBillingAccountFor } from './accounts'
import { accountPlanFor } from './accountSubscriptions'
import { spendLimitUsedNow } from '@/shared/billing/spend-limit-period'

/** Enough for a busy month; beyond it the list says it is `truncated` rather than silently undercounting. */
const MAX_CHARGES = 20_000
const DAY_MS = 24 * 60 * 60 * 1000

type Member = { userId: string; principalId: string; name: string; role: string }

async function activeHumanMembers(ctx: Pick<QueryCtx, 'db'>, workspaceId: string): Promise<Member[]> {
  const memberships = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).take(500)
  const members: Member[] = []
  for (const membership of memberships) {
    if (membership.status !== 'active') continue
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', membership.principalId)).unique()
    if (!principal || principal.type !== 'human' || !principal.userId || principal.archivedAt) continue
    members.push({ userId: principal.userId, principalId: principal.principalId, name: principal.displayName ?? 'Member', role: membership.role })
  }
  return members
}

/**
 * The billing period caps and spend are counted in: the paid plan's current period, or (without one) 30-day periods
 * from the plan's last start, or from now. Always contains `now`.
 */
async function currentPeriod(ctx: Pick<QueryCtx, 'db'>, billingAccountId: string, now: number) {
  const plan = await accountPlanFor(ctx, { billingAccountId })
  if (plan?.currentPeriodStart !== undefined && plan.currentPeriodEnd !== undefined
    && plan.currentPeriodStart <= now && now < plan.currentPeriodEnd) {
    return { periodStart: plan.currentPeriodStart, periodEnd: plan.currentPeriodEnd }
  }
  let periodStart = plan?.currentPeriodStart !== undefined && plan.currentPeriodStart <= now ? plan.currentPeriodStart : now
  while (periodStart + 30 * DAY_MS <= now) periodStart += 30 * DAY_MS
  return { periodStart, periodEnd: periodStart + 30 * DAY_MS }
}

/** Everything each person triggered since `periodStart`, their automations and agents included, in cents. */
async function spendByPerson(ctx: Pick<QueryCtx, 'db'>, billingAccountId: string, periodStart: number) {
  const rows = await ctx.db.query('usageOperations')
    .withIndex('by_billingAccountId_createdAt', (q) => q.eq('billingAccountId', billingAccountId).gte('createdAt', periodStart))
    .take(MAX_CHARGES + 1)
  const spent = new Map<string, number>()
  for (const row of rows.slice(0, MAX_CHARGES)) {
    if (row.cents) spent.set(row.userId, (spent.get(row.userId) ?? 0) + row.cents)
  }
  return { spent, truncated: rows.length > MAX_CHARGES }
}

/**
 * Workspace → Billing → Spend per person, live, for owners and admins: what each member has spent this billing period
 * and their cap, if any. Null for anyone else.
 */
export const members = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId).catch(() => null)
    if (!viewer || !canManageWorkspace(viewer.membership.role)) return null
    const account = await workspaceBillingAccountFor(ctx, { workspaceId })
    const people = await activeHumanMembers(ctx, workspaceId)
    if (!account) {
      return { hasBillingAccount: false, truncated: false, people: people.map((person) => ({ ...person, spentCents: 0, capCents: null, capUsedCents: 0 })) }
    }
    const now = Date.now()
    const period = await currentPeriod(ctx, account.billingAccountId, now)
    const { spent, truncated } = await spendByPerson(ctx, account.billingAccountId, period.periodStart)
    const rows = await Promise.all(people.map(async (person) => {
      const cap = await spendLimitRow(ctx, account.billingAccountId, { kind: 'member', id: person.userId })
      return {
        ...person,
        spentCents: Math.round((spent.get(person.userId) ?? 0) * 100) / 100,
        capCents: cap ? cap.limitMicros / 10_000 : null,
        capUsedCents: cap
          ? spendLimitUsedNow({ periodStart: cap.periodStart, periodEnd: cap.periodEnd, used: cap.usedMicros, reserved: cap.reservedMicros }, now) / 10_000
          : 0,
      }
    }))
    rows.sort((a, b) => b.spentCents - a.spentCents || a.name.localeCompare(b.name))
    return { hasBillingAccount: true, periodStart: period.periodStart, periodEnd: period.periodEnd, truncated, people: rows }
  },
})

/**
 * Sets or removes a member's cap (owners and admins only). A new cap counts what the person already spent this period,
 * so it takes effect at once; it renews every billing period. `capCents: null` removes it.
 */
export const setMemberCapByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    actorUserId: v.string(),
    userId: v.string(),
    capCents: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const people = await activeHumanMembers(ctx, args.workspaceId)
    const actor = people.find((person) => person.userId === args.actorUserId)
    if (!actor || !canManageWorkspace(actor.role as never)) throw new Error('WORKSPACE_BILLING_MANAGE_FORBIDDEN')
    if (!people.some((person) => person.userId === args.userId)) throw new Error('WORKSPACE_MEMBER_NOT_FOUND')
    if (args.capCents !== null && (!Number.isFinite(args.capCents) || args.capCents < 0 || args.capCents > 100_000_000)) {
      throw new Error('billing_spend_limit_invalid')
    }
    const account = await workspaceBillingAccountFor(ctx, { workspaceId: args.workspaceId })
    if (!account || account.status !== 'active') throw new Error('billing_account_inactive')
    const existing = await spendLimitRow(ctx, account.billingAccountId, { kind: 'member', id: args.userId })
    if (args.capCents === null) {
      if (existing) await ctx.db.delete(existing._id)
      return { capCents: null }
    }
    const limitMicros = Math.round(args.capCents * 10_000)
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { limitMicros, updatedAt: now, version: existing.version + 1 })
      return { capCents: args.capCents }
    }
    const period = await currentPeriod(ctx, account.billingAccountId, now)
    const { spent } = await spendByPerson(ctx, account.billingAccountId, period.periodStart)
    await ctx.db.insert('billingAccountSpendLimits', {
      billingAccountId: account.billingAccountId,
      subjectKind: 'member',
      subjectId: args.userId,
      limitMicros,
      usedMicros: Math.round((spent.get(args.userId) ?? 0) * 10_000),
      reservedMicros: 0,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      version: 0,
      createdAt: now,
      updatedAt: now,
    })
    return { capCents: args.capCents }
  },
})
