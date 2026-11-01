import { v, type Infer } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { growthAccountUsageValidator, growthCountFields } from '../lib/growthSchema'

/**
 * Nightly growth rollups (see internal/plans/GROWTH_ANALYTICS_PLAN.md).
 *
 * One UTC day is counted as a chain of small mutations: each reads one page of
 * one source table, adds to the running counts in `growthJobState`, and
 * schedules the next page. A page and its counts commit together, so a retry
 * never double-counts, and re-running a day starts its counts from zero.
 */

type Counts = { [Field in keyof typeof growthCountFields]: number }
type AccountUsage = Infer<typeof growthAccountUsageValidator>
type JobState = Doc<'growthJobState'>

const DAY_MS = 86_400_000
/** A run with no progress for this long is treated as stopped and restarted. */
const STALE_RUN_MS = 2 * 60 * 60 * 1_000
const TOP_WORKSPACES = 10

export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** The Monday (UTC) of the week containing `day`. */
export function weekStartOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

function zeroCounts(): Counts {
  return Object.fromEntries(Object.keys(growthCountFields).map((key) => [key, 0])) as Counts
}

function dayRange(day: string): { start: number; end: number } {
  const start = Date.parse(`${day}T00:00:00Z`)
  return { start, end: start + DAY_MS }
}

async function getState(ctx: MutationCtx): Promise<JobState | null> {
  return await ctx.db.query('growthJobState').withIndex('by_key', (q) => q.eq('key', 'daily')).unique()
}

// ─── Attribution ─────────────────────────────────────────────────────────

async function growthUser(ctx: MutationCtx, userId: string): Promise<Doc<'growthUsers'> | null> {
  return await ctx.db.query('growthUsers').withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
}

async function bumpCohort(ctx: MutationCtx, signupDay: string, field: 'users' | 'w1Active' | 'w4Active') {
  const weekStart = weekStartOf(signupDay)
  const cohort = await ctx.db.query('growthCohortWeeks').withIndex('by_weekStart', (q) => q.eq('weekStart', weekStart)).unique()
  if (cohort) await ctx.db.patch(cohort._id, { [field]: cohort[field] + 1 })
  else {
    await ctx.db.insert('growthCohortWeeks', {
      weekStart,
      users: field === 'users' ? 1 : 0,
      w1Active: field === 'w1Active' ? 1 : 0,
      w4Active: field === 'w4Active' ? 1 : 0,
    })
  }
}

async function recordSignup(ctx: MutationCtx, userId: string, day: string) {
  const existing = await growthUser(ctx, userId)
  if (existing?.signupDay) return
  if (existing) await ctx.db.patch(existing._id, { signupDay: day })
  else await ctx.db.insert('growthUsers', { userId, signupDay: day, w1Active: false, w4Active: false })
  await bumpCohort(ctx, day, 'users')
}

/** Marks each person active on `day`: one user-day row, last active day, and the retention windows. */
async function creditActive(ctx: MutationCtx, userIds: Iterable<string>, day: string) {
  for (const userId of new Set(userIds)) {
    const userDay = await ctx.db.query('growthUserDays')
      .withIndex('by_userId_day', (q) => q.eq('userId', userId).eq('day', day)).unique()
    if (!userDay) await ctx.db.insert('growthUserDays', { userId, day })

    const user = await growthUser(ctx, userId)
    if (!user) {
      await ctx.db.insert('growthUsers', { userId, lastActiveDay: day, w1Active: false, w4Active: false })
      continue
    }
    const patch: Partial<Doc<'growthUsers'>> = {}
    if (!user.lastActiveDay || user.lastActiveDay < day) patch.lastActiveDay = day
    if (user.signupDay) {
      const offset = daysBetween(user.signupDay, day)
      if (!user.w1Active && offset >= 7 && offset <= 13) {
        patch.w1Active = true
        await bumpCohort(ctx, user.signupDay, 'w1Active')
      }
      if (!user.w4Active && offset >= 28 && offset <= 34) {
        patch.w4Active = true
        await bumpCohort(ctx, user.signupDay, 'w4Active')
      }
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(user._id, patch)
  }
}

/** The person behind a workspace principal; agents and services are nobody. */
async function principalUserIds(ctx: MutationCtx, principalIds: Iterable<string>): Promise<string[]> {
  const userIds: string[] = []
  for (const principalId of new Set(principalIds)) {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', principalId)).first()
    if (principal?.type === 'human' && principal.userId) userIds.push(principal.userId)
  }
  return userIds
}

// ─── Steps ───────────────────────────────────────────────────────────────

type StepInput = { ctx: MutationCtx; state: JobState; day: string; cursor: string | null; counts: Counts }
type StepResult = { isDone: boolean; continueCursor: string }
type Step = (input: StepInput) => Promise<StepResult>

function isCountedFile(file: Doc<'files'>): boolean {
  if (file.kind) return file.kind === 'note' || file.kind === 'upload'
  return file.type === 'file' && !file.outputType
}

/** Steps run in this order for every day. Signups come first so later activity can find the signup day. */
const STEPS: Step[] = [
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('subscriptions')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    for (const row of page.page) {
      counts.usersCreated += 1
      await recordSignup(ctx, row.userId, day)
    }
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('workItems')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    counts.tasksCreated += page.page.length
    await creditActive(ctx, page.page.map((item) => item.userId), day)
    return page
  },
  async ({ ctx, day, cursor }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('workItemEvents')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    const actors = page.page.filter((event) => event.kind !== 'created').map((event) => event.actorPrincipalId)
    await creditActive(ctx, await principalUserIds(ctx, actors), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    const agents = page.page.filter((agent) => !agent.isDefault)
    counts.agentsCreated += agents.length
    await creditActive(ctx, await principalUserIds(ctx, agents.map((agent) => agent.createdByPrincipalId)), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('automations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    counts.automationsCreated += page.page.length
    await creditActive(ctx, page.page.map((automation) => automation.userId), day)
    return page
  },
  // Files can carry up to 1 MiB of text each, so their pages stay small.
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('files')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 10 })
    const files = page.page.filter(isCountedFile)
    counts.filesCreated += files.length
    await creditActive(ctx, files.map((file) => file.userId), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('files')
      .withIndex('by_contentEditedAt', (q) => q.gte('contentEditedAt', start).lt('contentEditedAt', end))
      .paginate({ cursor, numItems: 10 })
    counts.filesEdited += page.page.length
    await creditActive(ctx, page.page.flatMap((file) => file.contentEditedBy ? [file.contentEditedBy] : []), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('conversations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    const threads = page.page.filter((thread) => !thread.isAutomation)
    counts.threadsCreated += threads.length
    // A Slack-linked thread's owner may not be the person who wrote in Slack.
    await creditActive(ctx, threads.filter((thread) => !thread.externalPlatform).map((thread) => thread.userId), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('conversationMessages')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 15 })
    const conversations = new Map<string, Doc<'conversations'> | null>()
    const active: string[] = []
    for (const message of page.page) {
      if (message.role !== 'user' || message.importedAuthorName) continue
      if (message.authorKind && message.authorKind !== 'human') continue
      if (!conversations.has(message.conversationId)) {
        conversations.set(message.conversationId, await ctx.db.get(message.conversationId))
      }
      const conversation = conversations.get(message.conversationId)
      // Automation runs post their prompt as a user message; that's the automation, not a person.
      if (conversation?.isAutomation) continue
      counts.messagesSent += 1
      if (!conversation?.externalPlatform) active.push(message.userId)
    }
    await creditActive(ctx, active, day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('automationRuns')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 50 })
    const active: string[] = []
    for (const run of page.page) {
      if (run.status === 'skipped') continue
      counts.automationRuns += 1
      if (run.status === 'succeeded' || run.status === 'completed') counts.automationRunsSucceeded += 1
      if (run.status === 'failed' || run.status === 'dead_letter') counts.automationRunsFailed += 1
      // Scheduled runs are the automation working by itself.
      if (run.triggerSource === 'manual' || run.triggerSource === 'retry') active.push(run.userId)
    }
    await creditActive(ctx, active, day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('budgetTopUps')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    for (const topUp of page.page) {
      if (topUp.status !== 'succeeded') continue
      counts.topUps += 1
      counts.topUpCents += topUp.amountCents - (topUp.refundedAmountCents ?? 0)
    }
    return page
  },
  async ({ ctx, state, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('usageOperations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    const byAccount = new Map((state.accountUsage ?? []).map((usage) => [usage.billingAccountId, { ...usage }]))
    for (const operation of page.page) {
      const cents = operation.cents ?? 0
      const seconds = operation.kind === 'sandbox' ? operation.usageSeconds ?? 0 : 0
      counts.usageCents += cents
      counts.sandboxSeconds += seconds
      if (!operation.billingAccountId) continue
      const usage = byAccount.get(operation.billingAccountId)
        ?? { billingAccountId: operation.billingAccountId, cents: 0, sandboxSeconds: 0 }
      usage.cents += cents
      usage.sandboxSeconds += seconds
      byAccount.set(operation.billingAccountId, usage)
    }
    state.accountUsage = [...byAccount.values()]
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const page = await ctx.db.query('growthUserDays').withIndex('by_day', (q) => q.eq('day', day))
      .paginate({ cursor, numItems: 1_000 })
    counts.activeUsers += page.page.length
    return page
  },
  // Weekly/monthly actives use each user's last active day, which is only right
  // when no later day has been counted yet.
  async ({ ctx, state, day, cursor }) => {
    if (state.maxCompletedDay && state.maxCompletedDay >= day) return { isDone: true, continueCursor: '' }
    const monthStart = addDays(day, -29)
    const weekStart = addDays(day, -6)
    const page = await ctx.db.query('growthUsers')
      .withIndex('by_lastActiveDay', (q) => q.gte('lastActiveDay', monthStart).lte('lastActiveDay', day))
      .paginate({ cursor, numItems: 1_000 })
    state.monthlyActiveUsers = (state.monthlyActiveUsers ?? 0) + page.page.length
    state.weeklyActiveUsers = (state.weeklyActiveUsers ?? 0)
      + page.page.filter((user) => user.lastActiveDay && user.lastActiveDay >= weekStart).length
    return page
  },
  // Paid plans are only known as they are now, so the snapshot is taken for yesterday only.
  async ({ ctx, state, day, cursor }) => {
    if (day !== addDays(dayOf(Date.now()), -1)) return { isDone: true, continueCursor: '' }
    const page = await ctx.db.query('billingAccountSubscriptions').paginate({ cursor, numItems: 500 })
    for (const subscription of page.page) {
      if (!isPaid(subscription)) continue
      state.paidSubscriptions = (state.paidSubscriptions ?? 0) + 1
      const seen = await ctx.db.query('growthPaidAccounts')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', subscription.billingAccountId)).first()
      if (!seen) {
        await ctx.db.insert('growthPaidAccounts', { billingAccountId: subscription.billingAccountId, firstPaidDay: day, approximate: false })
      }
    }
    return page
  },
]

function isPaid(subscription: Doc<'billingAccountSubscriptions'>): boolean {
  return subscription.planKind === 'paid' && (subscription.status === 'active' || subscription.status === 'trialing')
}

async function topWorkspaces(ctx: MutationCtx, accountUsage: AccountUsage[]) {
  const top: Array<{ workspaceId: string; cents: number; sandboxSeconds: number }> = []
  for (const usage of [...accountUsage].sort((a, b) => b.cents - a.cents)) {
    if (top.length >= TOP_WORKSPACES) break
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', usage.billingAccountId)).first()
    // Personal accounts are people, not workspaces; they stay in the totals only.
    if (account?.scope !== 'workspace' || !account.workspaceId) continue
    top.push({ workspaceId: account.workspaceId, cents: usage.cents, sandboxSeconds: usage.sandboxSeconds })
  }
  return top
}

async function finishDay(ctx: MutationCtx, state: JobState, day: string) {
  const counts = state.counts ?? zeroCounts()
  const newPaid = await ctx.db.query('growthPaidAccounts').withIndex('by_firstPaidDay', (q) => q.eq('firstPaidDay', day)).collect()
  const existing = await ctx.db.query('growthDailyTotals').withIndex('by_day', (q) => q.eq('day', day)).unique()
  const rerun = Boolean(state.maxCompletedDay && state.maxCompletedDay >= day)
  const totals = {
    day,
    ...counts,
    weeklyActiveUsers: rerun ? existing?.weeklyActiveUsers : state.weeklyActiveUsers ?? 0,
    monthlyActiveUsers: rerun ? existing?.monthlyActiveUsers : state.monthlyActiveUsers ?? 0,
    paidSubscriptions: state.paidSubscriptions ?? existing?.paidSubscriptions,
    newPaidSubscriptions: newPaid.length,
    topWorkspaces: await topWorkspaces(ctx, state.accountUsage ?? []),
    computedAt: Date.now(),
  }
  if (existing) await ctx.db.replace(existing._id, totals)
  else await ctx.db.insert('growthDailyTotals', totals)

  const maxCompletedDay = rerun ? state.maxCompletedDay : day
  if (state.untilDay && day < state.untilDay) {
    await ctx.db.patch(state._id, { lastCompletedDay: day, maxCompletedDay })
    await beginDay(ctx, addDays(day, 1))
    return
  }
  await ctx.db.patch(state._id, {
    lastCompletedDay: day, maxCompletedDay, day: undefined, step: undefined, cursor: undefined, counts: undefined,
    accountUsage: undefined, weeklyActiveUsers: undefined, monthlyActiveUsers: undefined, paidSubscriptions: undefined,
    untilDay: undefined, updatedAt: Date.now(),
  })
}

async function beginDay(ctx: MutationCtx, day: string, untilDay?: string) {
  const state = await getState(ctx)
  const fresh = {
    day, step: 0, cursor: undefined, counts: zeroCounts(), accountUsage: [],
    weeklyActiveUsers: undefined, monthlyActiveUsers: undefined, paidSubscriptions: undefined, updatedAt: Date.now(),
  }
  if (state) await ctx.db.patch(state._id, { ...fresh, ...(untilDay ? { untilDay } : {}) })
  else await ctx.db.insert('growthJobState', { key: 'daily', ...fresh, untilDay })
  await ctx.scheduler.runAfter(0, internal.platform.growth.runStep, { day })
}

// ─── Entry points ────────────────────────────────────────────────────────

/** Counts one page of the current step, then schedules the next. */
export const runStep = internalMutation({
  args: { day: v.string() },
  returns: v.null(),
  handler: async (ctx, { day }) => {
    const state = await getState(ctx)
    // A newer run took over; this scheduled call is left over.
    if (!state || state.day !== day || state.step === undefined) return null
    if (state.step >= STEPS.length) {
      await finishDay(ctx, state, day)
      return null
    }
    const counts = { ...(state.counts ?? zeroCounts()) }
    const working = { ...state }
    const result = await STEPS[state.step]!({ ctx, state: working, day, cursor: state.cursor ?? null, counts })
    await ctx.db.patch(state._id, {
      counts,
      accountUsage: working.accountUsage,
      weeklyActiveUsers: working.weeklyActiveUsers,
      monthlyActiveUsers: working.monthlyActiveUsers,
      paidSubscriptions: working.paidSubscriptions,
      step: result.isDone ? state.step + 1 : state.step,
      cursor: result.isDone ? undefined : result.continueCursor,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.platform.growth.runStep, { day })
    return null
  },
})

/** Nightly cron: counts every day since the last completed one, up to yesterday. */
export const startDaily = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    const yesterday = addDays(dayOf(now), -1)
    const state = await getState(ctx)
    if (state?.day && now - state.updatedAt < STALE_RUN_MS) return null
    if (state?.day) {
      // A stopped run: count that day again from the start.
      await beginDay(ctx, state.day, state.untilDay ?? yesterday)
      return null
    }
    const nextDay = state?.lastCompletedDay ? addDays(state.lastCompletedDay, 1) : yesterday
    if (nextDay > yesterday) return null
    await beginDay(ctx, nextDay, yesterday)
    return null
  },
})

/**
 * One-time (or repair) backfill: recounts every day from `fromDay` (default:
 * the first signup) to yesterday. Paid accounts get their subscription's
 * creation day, marked approximate.
 */
export const startBackfill = internalMutation({
  args: { fromDay: v.optional(v.string()), force: v.optional(v.boolean()) },
  returns: v.object({ fromDay: v.union(v.string(), v.null()), untilDay: v.string() }),
  handler: async (ctx, { fromDay, force }) => {
    const now = Date.now()
    const untilDay = addDays(dayOf(now), -1)
    const state = await getState(ctx)
    if (state?.day && now - state.updatedAt < STALE_RUN_MS && !force) {
      throw new Error(`Growth job is already counting ${state.day}; pass force to restart.`)
    }
    const firstSignup = await ctx.db.query('subscriptions').order('asc').first()
    const start = fromDay ?? (firstSignup ? dayOf(firstSignup._creationTime) : null)
    if (!start || start > untilDay) return { fromDay: null, untilDay }

    for (const subscription of await ctx.db.query('billingAccountSubscriptions').take(5_000)) {
      if (!isPaid(subscription)) continue
      const seen = await ctx.db.query('growthPaidAccounts')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', subscription.billingAccountId)).first()
      if (!seen) {
        await ctx.db.insert('growthPaidAccounts', {
          billingAccountId: subscription.billingAccountId, firstPaidDay: dayOf(subscription.createdAt), approximate: true,
        })
      }
    }
    await beginDay(ctx, start, untilDay)
    return { fromDay: start, untilDay }
  },
})
