import { v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireAccessToken, requireServerSecret, validateServerSecret } from '../lib/auth'
import { logAuthDebug, summarizeJwtForLog } from '../lib/authDebug'
import { FREE_TIER_AUTO_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { getOrCreateSubscription, getStorageBytesUsed, getStorageLimitForSubscription } from '../files/lib/storageQuota'
import { roundCurrencyAmount } from '../../src/shared/ai/sandbox/daytona-pricing'
import { derivePlanAmountCents, derivePlanKind } from '../../src/shared/billing/billing-pricing'

function getPastWeekDates(): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < 7; i++) {
    const date = new Date(now)
    date.setDate(now.getDate() - i)
    dates.push(date.toISOString().split('T')[0])
  }
  return dates
}

function countsTowardFreeTierMessageLimit(event: {
  type: 'ask' | 'write' | 'agent' | 'embedding' | 'transcription' | 'generation' | 'sandbox'
  modelId?: string
}): boolean {
  if (event.type !== 'ask' && event.type !== 'write' && event.type !== 'agent') return false
  return event.modelId !== FREE_TIER_AUTO_MODEL_ID
}

export type UsageEvent = {
  type: 'ask' | 'write' | 'agent' | 'embedding' | 'transcription' | 'generation' | 'sandbox'
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  cost: number
  durationSeconds?: number
  timestamp: number
}

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

function roundCreditAmount(value: number): number {
  return roundCurrencyAmount(value)
}

async function getSubscriptionBudgetState(ctx: MutationCtx, userId: string) {
  const subscription = await getOrCreateSubscription(ctx, userId)
  const planKind = derivePlanKind(subscription ?? {})
  const planAmountCents = derivePlanAmountCents(subscription ?? {})
  const topUpTotalCents = await getSucceededTopUpTotalCents(ctx, userId, subscription.currentPeriodStart)
  const budgetTotalCents = planKind === 'free'
    ? 0
    : planAmountCents + topUpTotalCents + (subscription?.institutionalGrantCents ?? 0)
  const budgetUsedCents = subscription.creditsUsed ?? 0
  return {
    subscription,
    planKind,
    budgetTotalCents,
    budgetUsedCents,
    budgetRemainingCents: Math.max(0, budgetTotalCents - budgetUsedCents),
  }
}

async function getDailyUsageForPatch(ctx: MutationCtx, userId: string, date: string) {
  const existing = await ctx.db
    .query('dailyUsage')
    .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', date))
    .first()
  if (existing) return existing
  const id = await ctx.db.insert('dailyUsage', {
    userId,
    date,
    askCount: 0,
    agentCount: 0,
    writeCount: 0,
    transcriptionSeconds: 0,
  })
  return await ctx.db.get(id)
}

type EntitlementCtx = QueryCtx | MutationCtx

async function getSucceededTopUpTotalCents(ctx: EntitlementCtx, userId: string, billingPeriodStart?: number): Promise<number> {
  if (!billingPeriodStart) return 0
  const rows = await ctx.db
    .query('budgetTopUps')
    .withIndex('by_userId_billingPeriodStart', (q) =>
      q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart),
    )
    .collect()
  return rows.reduce((sum, row) => (
    row.status === 'succeeded' ? sum + Math.max(0, row.amountCents) : sum
  ), 0)
}

async function buildEntitlements(ctx: EntitlementCtx, userId: string) {
  const subscription = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()

  const today = new Date().toISOString().split('T')[0]
  const dailyUsage = await ctx.db
    .query('dailyUsage')
    .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
    .first()

  const planKind = derivePlanKind(subscription ?? {})
  const tier = planKind === 'free' ? 'free' : ((subscription?.tier === 'max' ? 'max' : 'pro') as 'free' | 'pro' | 'max')
  const planAmountCents = derivePlanAmountCents(subscription ?? {})
  const topUpTotalCents = await getSucceededTopUpTotalCents(ctx, userId, subscription?.currentPeriodStart)
  const budgetTotalCents = planKind === 'free'
    ? 0
    : planAmountCents + topUpTotalCents + (subscription?.institutionalGrantCents ?? 0)

  const tierDefaults = {
    free: {
      dailyLimits: { ask: 15, write: 15, agent: 15 },
      transcriptionSecondsLimit: 600,
      localTranscriptionEnabled: false,
    },
    paid: {
      dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
      transcriptionSecondsLimit: Infinity,
      localTranscriptionEnabled: true,
    },
  } as const

  const defaults = tierDefaults[planKind]
  const budgetUsedCents = subscription?.creditsUsed ?? 0

  let weeklyTranscriptionSeconds = 0
  let weeklyUsage = { ask: 0, write: 0, agent: 0 }

  if (planKind === 'free') {
    const pastWeekDates = getPastWeekDates()
    const weeklyUsageRecords = await Promise.all(
      pastWeekDates.map(date =>
        ctx.db
          .query('dailyUsage')
          .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', date))
          .first()
      )
    )
    weeklyTranscriptionSeconds = weeklyUsageRecords.reduce(
      (sum, record) => sum + (record?.transcriptionSeconds ?? 0),
      0
    )
    weeklyUsage = weeklyUsageRecords.reduce(
      (acc, record) => ({
        ask: acc.ask + (record?.askCount ?? 0),
        write: acc.write + (record?.writeCount ?? 0),
        agent: acc.agent + (record?.agentCount ?? 0)
      }),
      { ask: 0, write: 0, agent: 0 }
    )
  }

  return {
    tier,
    planKind,
    planAmountCents,
    budgetUsedCents,
    budgetTotalCents,
    budgetRemainingCents: Math.max(0, budgetTotalCents - budgetUsedCents),
    autoTopUpEnabled: Boolean(subscription?.autoTopUpEnabled),
    autoTopUpAmountCents: subscription?.autoTopUpAmountCents ?? 0,
    autoTopUpConsentGranted: Boolean(subscription?.offSessionConsentAt),
    creditsUsed: budgetUsedCents,
    creditsTotal: budgetTotalCents / 100,
    overlayStorageBytesUsed: getStorageBytesUsed(subscription),
    overlayStorageBytesLimit: getStorageLimitForSubscription(subscription),
    dailyUsage: planKind === 'free' ? weeklyUsage : {
      ask: dailyUsage?.askCount || 0,
      write: dailyUsage?.writeCount || 0,
      agent: dailyUsage?.agentCount || 0
    },
    dailyLimits: defaults.dailyLimits,
    transcriptionSecondsUsed: planKind === 'free' ? weeklyTranscriptionSeconds : 0,
    transcriptionSecondsLimit: defaults.transcriptionSecondsLimit,
    localTranscriptionEnabled: defaults.localTranscriptionEnabled,
    resetAt: getNextWeeklyReset(),
    billingPeriodEnd: subscription?.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toISOString()
      : '',
    lastSyncedAt: Date.now()
  }
}

export async function applyUsageEvents(
  ctx: MutationCtx,
  userId: string,
  events: UsageEvent[],
  options: { chargeCredits?: boolean } = {},
): Promise<{ success: true; eventsProcessed: number }> {
  const chargeCredits = options.chargeCredits ?? true
  const today = new Date().toISOString().split('T')[0]

  let dailyUsage = await ctx.db
    .query('dailyUsage')
    .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', today))
    .first()

  if (!dailyUsage) {
    const id = await ctx.db.insert('dailyUsage', {
      userId,
      date: today,
      askCount: 0,
      agentCount: 0,
      writeCount: 0,
      transcriptionSeconds: 0,
    })
    dailyUsage = await ctx.db.get(id)
  }

  let askDelta = 0
  let writeDelta = 0
  let agentDelta = 0
  let transcriptionSecondsDelta = 0

  for (const event of events) {
    if (countsTowardFreeTierMessageLimit(event)) {
      if (event.type === 'ask') askDelta++
      else if (event.type === 'write') writeDelta++
      else if (event.type === 'agent') agentDelta++
    } else if (event.type === 'transcription') {
      transcriptionSecondsDelta += Math.max(0, Math.round(event.durationSeconds ?? 0))
    }
  }

  if (dailyUsage && (askDelta || writeDelta || agentDelta || transcriptionSecondsDelta)) {
    await ctx.db.patch(dailyUsage._id, {
      askCount: dailyUsage.askCount + askDelta,
      writeCount: dailyUsage.writeCount + writeDelta,
      agentCount: dailyUsage.agentCount + agentDelta,
      transcriptionSeconds: (dailyUsage.transcriptionSeconds ?? 0) + transcriptionSecondsDelta,
    })
  }

  let totalCost = 0
  let totalInputTokens = 0
  let totalCachedInputTokens = 0
  let totalOutputTokens = 0

  for (const event of events) {
    if (event.type !== 'transcription' && event.cost > 0) {
      totalCost = roundCreditAmount(totalCost + event.cost)
      totalInputTokens += event.inputTokens || 0
      totalCachedInputTokens += event.cachedTokens || 0
      totalOutputTokens += event.outputTokens || 0
    }
  }

  if (totalCost > 0) {
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    if (subscription && chargeCredits) {
      await ctx.db.patch(subscription._id, {
        creditsUsed: roundCreditAmount((subscription.creditsUsed ?? 0) + totalCost),
      })
    }

    const billingPeriodStart = subscription?.currentPeriodStart
      ? new Date(subscription.currentPeriodStart).toISOString().split('T')[0]
      : today

    let tokenUsage = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart)
      )
      .first()

    if (!tokenUsage) {
      const id = await ctx.db.insert('tokenUsage', {
        userId,
        email: subscription?.email ?? '',
        billingPeriodStart,
        creditsUsed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      })
      tokenUsage = await ctx.db.get(id)
    } else if (!tokenUsage.email && subscription?.email) {
      await ctx.db.patch(tokenUsage._id, { email: subscription.email })
    }

    if (tokenUsage) {
      await ctx.db.patch(tokenUsage._id, {
        creditsUsed: roundCreditAmount((tokenUsage.creditsUsed ?? tokenUsage.costAccrued ?? 0) + totalCost),
        inputTokens: tokenUsage.inputTokens + totalInputTokens,
        cachedInputTokens: tokenUsage.cachedInputTokens + totalCachedInputTokens,
        outputTokens: tokenUsage.outputTokens + totalOutputTokens,
      })
    }
  }

  return { success: true, eventsProcessed: events.length }
}

// creditsUsed is now read directly from subscriptions (single source of truth).
// tokenUsage is queried only for the audit-log token counts shown on the account page.
export const getEntitlements = query({
  args: { accessToken: v.string(), userId: v.string() },
  handler: async (ctx, { accessToken, userId }) => {
    logAuthDebug('platform/usage:getEntitlements start', {
      userId,
      accessToken: summarizeJwtForLog(accessToken),
    })
    await requireAccessToken(accessToken, userId)
    logAuthDebug('platform/usage:getEntitlements access token verified', { userId })
    const result = await buildEntitlements(ctx, userId)
    logAuthDebug('platform/usage:getEntitlements success', {
      userId,
      tier: result.tier,
    })
    return result
  }
})

export const getEntitlementsByServer = query({
  args: { serverSecret: v.string(), userId: v.string() },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    logAuthDebug('platform/usage:getEntitlementsByServer start', { userId })
    const result = await buildEntitlements(ctx, userId)
    logAuthDebug('platform/usage:getEntitlementsByServer success', {
      userId,
      tier: result.tier,
    })
    return result
  }
})

// Internal query for server-side credit enforcement (no access token needed).
export const getEntitlementsInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    const planKind = derivePlanKind(subscription ?? {})
    const tier = planKind === 'free' ? 'free' : ((subscription?.tier === 'max' ? 'max' : 'pro') as 'free' | 'pro' | 'max')
    const planAmountCents = derivePlanAmountCents(subscription ?? {})
    const topUpTotalCents = await getSucceededTopUpTotalCents(ctx, userId, subscription?.currentPeriodStart)
    const budgetTotalCents = planKind === 'free'
      ? 0
      : planAmountCents + topUpTotalCents + (subscription?.institutionalGrantCents ?? 0)
    return {
      tier,
      planKind,
      planAmountCents,
      budgetUsedCents: subscription?.creditsUsed ?? 0,
      budgetTotalCents,
      budgetRemainingCents: Math.max(0, budgetTotalCents - (subscription?.creditsUsed ?? 0)),
      autoTopUpEnabled: Boolean(subscription?.autoTopUpEnabled),
      autoTopUpAmountCents: subscription?.autoTopUpAmountCents ?? 0,
      creditsUsed: subscription?.creditsUsed ?? 0,
      creditsTotal: budgetTotalCents / 100,
      overlayStorageBytesUsed: getStorageBytesUsed(subscription),
      overlayStorageBytesLimit: getStorageLimitForSubscription(subscription),
    }
  }
})

export const initializeSubscriptionUsageByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, { serverSecret, userId }) => {
    requireServerSecret(serverSecret)
    const subscription = await getOrCreateSubscription(ctx, userId)
    return {
      success: true,
      tier: subscription.tier,
      overlayStorageBytesUsed: getStorageBytesUsed(subscription),
    }
  },
})

// Free-tier weekly limits (same values as tierDefaults in buildEntitlements).
const FREE_TIER_WEEKLY_LIMITS = { ask: 15, write: 15, agent: 15 } as const

async function enforceFreeTierUsageLimits(
  ctx: MutationCtx,
  userId: string,
  events: UsageEvent[],
  forceFreeTierLimits = false,
): Promise<void> {
  const subscription = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()

  const planKind = derivePlanKind(subscription ?? {})
  if (planKind !== 'free' && !forceFreeTierLimits) return

  const pastWeekDates = getPastWeekDates()
  const weeklyUsageRecords = await Promise.all(
    pastWeekDates.map((date) =>
      ctx.db
        .query('dailyUsage')
        .withIndex('by_userId_date', (q) => q.eq('userId', userId).eq('date', date))
        .first(),
    ),
  )
  const weeklyUsage = weeklyUsageRecords.reduce(
    (acc, record) => ({
      ask: acc.ask + (record?.askCount ?? 0),
      write: acc.write + (record?.writeCount ?? 0),
      agent: acc.agent + (record?.agentCount ?? 0),
      transcriptionSeconds: acc.transcriptionSeconds + (record?.transcriptionSeconds ?? 0),
    }),
    { ask: 0, write: 0, agent: 0, transcriptionSeconds: 0 },
  )

  let batchAsk = 0, batchWrite = 0, batchAgent = 0
  let batchTranscriptionSeconds = 0
  for (const event of events) {
    if (event.type === 'transcription') {
      batchTranscriptionSeconds += Math.max(0, Math.round(event.durationSeconds ?? 0))
    } else if (countsTowardFreeTierMessageLimit(event)) {
      if (event.type === 'ask') batchAsk++
      else if (event.type === 'write') batchWrite++
      else if (event.type === 'agent') batchAgent++
    }
  }

  if (weeklyUsage.ask + batchAsk > FREE_TIER_WEEKLY_LIMITS.ask) {
    throw new Error('free_tier_limit_exceeded: weekly ask limit reached')
  }
  if (weeklyUsage.write + batchWrite > FREE_TIER_WEEKLY_LIMITS.write) {
    throw new Error('free_tier_limit_exceeded: weekly write limit reached')
  }
  if (weeklyUsage.agent + batchAgent > FREE_TIER_WEEKLY_LIMITS.agent) {
    throw new Error('free_tier_limit_exceeded: weekly agent limit reached')
  }
  if (weeklyUsage.transcriptionSeconds + batchTranscriptionSeconds > 600) {
    throw new Error('free_tier_limit_exceeded: weekly transcription limit reached')
  }
}

// Record a batch of usage events — server-only. Clients may read entitlements
// for display but can never mutate authoritative usage or cost.
// Accumulates totals from all events and does a single patch to both
// subscriptions.creditsUsed (enforcement) and tokenUsage (audit log).
export const recordBatch = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    operationId: v.optional(v.string()),
    forceFreeTierLimits: v.optional(v.boolean()),
    events: v.array(
      v.object({
        type: v.union(
          v.literal('ask'),
          v.literal('write'),
          v.literal('agent'),
          v.literal('embedding'),
          v.literal('transcription'),
          v.literal('generation'),
          v.literal('sandbox'),
        ),
        modelId: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        cachedTokens: v.optional(v.number()),
        cost: v.number(),
        durationSeconds: v.optional(v.number()),
        timestamp: v.number()
      })
    )
  },
  handler: async (ctx, { serverSecret, userId, operationId: rawOperationId, forceFreeTierLimits, events }) => {
    requireServerSecret(serverSecret)
    const operationId = rawOperationId?.trim()
    if (operationId) {
      const existing = await ctx.db
        .query('usageOperations')
        .withIndex('by_operationId', (q) => q.eq('operationId', operationId))
        .first()
      if (existing) {
        if (existing.userId !== userId) throw new Error('usage_operation_user_mismatch')
        return { success: true, recorded: 0, idempotent: true }
      }
    }
    await enforceFreeTierUsageLimits(ctx, userId, events, forceFreeTierLimits === true)
    const result = await applyUsageEvents(ctx, userId, events)
    if (operationId) {
      await ctx.db.insert('usageOperations', {
        userId,
        operationId,
        recorded: events.length,
        createdAt: Date.now(),
      })
    }
    return { ...result, recorded: events.length, idempotent: false }
  }
})

export const adjustBudgetByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    amountCents: v.number(),
  },
  handler: async (ctx, { serverSecret, userId, amountCents }) => {
    requireServerSecret(serverSecret)
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!subscription) throw new Error('subscription_not_found')
    const nextCreditsUsed = Math.max(0, roundCreditAmount((subscription.creditsUsed ?? 0) + amountCents))
    await ctx.db.patch(subscription._id, { creditsUsed: nextCreditsUsed })
    return { success: true, creditsUsed: nextCreditsUsed }
  },
})

export const listAdministrativeUsageByServer = query({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const rows = args.userId
      ? (await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', args.userId!)).collect())
      : await ctx.db.query('subscriptions').take(limit)
    return await Promise.all(rows.slice(0, limit).map(async (subscription) => {
      const planKind = derivePlanKind(subscription)
      const planAmountCents = derivePlanAmountCents(subscription)
      const topUpTotalCents = await getSucceededTopUpTotalCents(ctx, subscription.userId, subscription.currentPeriodStart)
      const budgetTotalCents = planKind === 'free'
        ? 0
        : planAmountCents + topUpTotalCents + (subscription.institutionalGrantCents ?? 0)
      const budgetUsedCents = subscription.creditsUsed ?? 0
      return {
        userId: subscription.userId,
        email: subscription.email,
        planKind,
        status: subscription.status,
        budgetUsedCents,
        budgetTotalCents,
        budgetRemainingCents: Math.max(0, budgetTotalCents - budgetUsedCents),
      }
    }))
  },
})

export const adjustAdministrativeBudgetByServer = mutation({
  args: {
    serverSecret: v.string(),
    amountCents: v.number(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const subscription = await getOrCreateSubscription(ctx, args.userId)
    const institutionalGrantCents = Math.max(
      0,
      roundCreditAmount((subscription.institutionalGrantCents ?? 0) + args.amountCents),
    )
    await ctx.db.patch(subscription._id, { institutionalGrantCents })
    const planKind = derivePlanKind(subscription)
    const planAmountCents = derivePlanAmountCents(subscription)
    const topUpTotalCents = await getSucceededTopUpTotalCents(ctx, args.userId, subscription.currentPeriodStart)
    const budgetTotalCents = planKind === 'free'
      ? 0
      : planAmountCents + topUpTotalCents + institutionalGrantCents
    const budgetUsedCents = subscription.creditsUsed ?? 0
    return {
      userId: args.userId,
      email: subscription.email,
      planKind,
      status: subscription.status,
      budgetUsedCents,
      budgetTotalCents,
      budgetRemainingCents: Math.max(0, budgetTotalCents - budgetUsedCents),
    }
  },
})

export const recordFileBandwidthByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    bytes: v.number(),
  },
  handler: async (ctx, { serverSecret, userId, bytes }) => {
    requireServerSecret(serverSecret)
    const subscription = await getOrCreateSubscription(ctx, userId)
    const now = new Date()
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    const currentPeriodStart = subscription.fileBandwidthPeriodStart ?? monthStart
    const samePeriod = currentPeriodStart === monthStart
    const currentBytes = samePeriod ? (subscription.fileBandwidthBytesUsed ?? 0) : 0
    const nextBytes = currentBytes + Math.max(0, Math.ceil(bytes))
    await ctx.db.patch(subscription._id, {
      fileBandwidthPeriodStart: monthStart,
      fileBandwidthBytesUsed: nextBytes,
    })
    return { success: true, fileBandwidthBytesUsed: nextBytes, fileBandwidthPeriodStart: monthStart }
  },
})

export const reserveBudgetByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    reservationId: v.string(),
    kind: v.union(
      v.literal('ask'),
      v.literal('write'),
      v.literal('agent'),
      v.literal('embedding'),
      v.literal('transcription'),
      v.literal('generation'),
      v.literal('sandbox'),
    ),
    modelId: v.optional(v.string()),
    operationId: v.string(),
    requestFingerprint: v.string(),
    reservedCents: v.number(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, {
    serverSecret,
    userId,
    reservationId,
    kind,
    modelId,
    operationId,
    requestFingerprint,
    reservedCents,
    expiresAt,
  }) => {
    requireServerSecret(serverSecret)
    const normalizedReservationId = reservationId.trim()
    if (!normalizedReservationId) throw new Error('invalid_reservation_id')

    const existing = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', normalizedReservationId))
      .first()
    if (existing) {
      if (existing.userId !== userId) throw new Error('reservation_user_mismatch')
      if (
        existing.reservedCents !== roundCreditAmount(Math.max(0, reservedCents)) ||
        existing.kind !== kind ||
        existing.modelId !== modelId ||
        existing.operationId !== operationId ||
        existing.requestFingerprint !== requestFingerprint
      ) {
        throw new Error('reservation_parameter_mismatch')
      }
      return {
        success: true,
        reservationId: existing.reservationId,
        reservedCents: existing.reservedCents,
        status: existing.status,
        idempotent: true,
      }
    }

    const safeReservedCents = roundCreditAmount(Math.max(0, reservedCents))
    const budget = await getSubscriptionBudgetState(ctx, userId)
    if (safeReservedCents > 0) {
      if (budget.planKind !== 'paid') throw new Error('insufficient_budget: paid plan required')
      if (budget.budgetRemainingCents + 0.000001 < safeReservedCents) {
        throw new Error('insufficient_budget')
      }
      await ctx.db.patch(budget.subscription._id, {
        creditsUsed: roundCreditAmount(budget.budgetUsedCents + safeReservedCents),
      })
    }

    const now = Date.now()
    await ctx.db.insert('budgetReservations', {
      userId,
      reservationId: normalizedReservationId,
      status: 'reserved',
      kind,
      modelId,
      operationId,
      requestFingerprint,
      reservedCents: safeReservedCents,
      providerWorkStarted: false,
      providerWorkCompleted: false,
      expiresAt: expiresAt ?? now + 30 * 60_000,
      createdAt: now,
      updatedAt: now,
    })

    return {
      success: true,
      reservationId: normalizedReservationId,
      reservedCents: safeReservedCents,
      status: 'reserved',
      idempotent: false,
    }
  },
})

export const reconcileExpiredBudgetReservationsByServer = mutation({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await reconcileExpiredBudgetReservations(ctx, args)
  },
})

export const reconcileExpiredBudgetReservationsInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => await reconcileExpiredBudgetReservations(ctx, args),
})

async function reconcileExpiredBudgetReservations(
  ctx: MutationCtx,
  args: { limit?: number; now?: number },
): Promise<{ reconcileRequired: number; released: number }> {
  const now = args.now ?? Date.now()
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 1000)
  const rows = await ctx.db
    .query('budgetReservations')
    .withIndex('by_status_createdAt', (q) => q.eq('status', 'reserved'))
    .take(limit)
  let reconcileRequired = 0
  let released = 0
  for (const reservation of rows) {
    if ((reservation.expiresAt ?? reservation.createdAt + 30 * 60_000) > now) continue
    if (reservation.providerWorkStarted) {
      await ctx.db.patch(reservation._id, {
        status: 'reconcile_required',
        errorMessage: 'reservation_expired_after_provider_work',
        updatedAt: now,
      })
      reconcileRequired += 1
      continue
    }
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', reservation.userId))
      .first()
    if (subscription && reservation.reservedCents > 0) {
      await ctx.db.patch(subscription._id, {
        creditsUsed: Math.max(
          0,
          roundCreditAmount((subscription.creditsUsed ?? 0) - reservation.reservedCents),
        ),
      })
    }
    await ctx.db.patch(reservation._id, {
      status: 'released',
      errorMessage: 'reservation_expired_before_provider_work',
      updatedAt: now,
    })
    released += 1
  }
  return { reconcileRequired, released }
}

export const finalizeBudgetReservationByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    reservationId: v.string(),
    actualCents: v.number(),
    events: v.optional(v.array(
      v.object({
        type: v.union(
          v.literal('ask'),
          v.literal('write'),
          v.literal('agent'),
          v.literal('embedding'),
          v.literal('transcription'),
          v.literal('generation'),
          v.literal('sandbox'),
        ),
        modelId: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        cachedTokens: v.optional(v.number()),
        cost: v.number(),
        durationSeconds: v.optional(v.number()),
        timestamp: v.number(),
      }),
    )),
  },
  handler: async (ctx, { serverSecret, userId, reservationId, actualCents, events }) => {
    requireServerSecret(serverSecret)
    const reservation = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', reservationId.trim()))
      .first()
    if (!reservation) throw new Error('reservation_not_found')
    if (reservation.userId !== userId) throw new Error('reservation_user_mismatch')
    if (reservation.status === 'finalized') {
      return { success: true, status: reservation.status, finalizedCents: reservation.finalizedCents ?? reservation.reservedCents }
    }
    if (reservation.status !== 'reserved' && reservation.status !== 'reconcile_required') {
      throw new Error(`reservation_not_finalizable:${reservation.status}`)
    }

    const safeActualCents = roundCreditAmount(Math.max(0, actualCents))
    if (safeActualCents > reservation.reservedCents + 0.000001) {
      await ctx.db.patch(reservation._id, {
        status: 'reconcile_required',
        providerWorkStarted: true,
        providerWorkCompleted: true,
        errorMessage: 'actual_cost_exceeds_reservation',
        updatedAt: Date.now(),
      })
      return {
        success: false,
        status: 'reconcile_required' as const,
        error: 'actual_cost_exceeds_reservation',
      }
    }
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (!subscription) throw new Error('subscription_not_found')

    if (events?.length) {
      await enforceFreeTierUsageLimits(ctx, userId, events)
      await applyUsageEvents(ctx, userId, events, { chargeCredits: false })
    }

    const delta = roundCreditAmount(safeActualCents - reservation.reservedCents)
    if (delta !== 0) {
      await ctx.db.patch(subscription._id, {
        creditsUsed: Math.max(0, roundCreditAmount((subscription.creditsUsed ?? 0) + delta)),
      })
    }

    await ctx.db.patch(reservation._id, {
      status: 'finalized',
      finalizedCents: safeActualCents,
      providerWorkStarted: true,
      providerWorkCompleted: true,
      updatedAt: Date.now(),
    })

    return { success: true, status: 'finalized', finalizedCents: safeActualCents }
  },
})

export const markBudgetReservationStartedByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    reservationId: v.string(),
  },
  handler: async (ctx, { serverSecret, userId, reservationId }) => {
    requireServerSecret(serverSecret)
    const reservation = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', reservationId.trim()))
      .first()
    if (!reservation) return { success: true, status: 'missing' as const }
    if (reservation.userId !== userId) throw new Error('reservation_user_mismatch')
    if (reservation.status !== 'reserved') {
      return { success: true, status: reservation.status }
    }
    if (!reservation.providerWorkStarted) {
      await ctx.db.patch(reservation._id, {
        providerWorkStarted: true,
        updatedAt: Date.now(),
      })
    }
    return { success: true, status: 'reserved' as const }
  },
})

export const releaseBudgetReservationByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    reservationId: v.string(),
    providerWorkStarted: v.optional(v.boolean()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { serverSecret, userId, reservationId, providerWorkStarted, reason }) => {
    requireServerSecret(serverSecret)
    const reservation = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', reservationId.trim()))
      .first()
    if (!reservation) return { success: true, status: 'missing' }
    if (reservation.userId !== userId) throw new Error('reservation_user_mismatch')
    if (reservation.status !== 'reserved') {
      return { success: true, status: reservation.status }
    }

    if (providerWorkStarted || reservation.providerWorkStarted) {
      await ctx.db.patch(reservation._id, {
        status: 'reconcile_required',
        providerWorkStarted: true,
        errorMessage: reason?.slice(0, 2000),
        updatedAt: Date.now(),
      })
      return { success: true, status: 'reconcile_required' }
    }

    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    if (subscription && reservation.reservedCents > 0) {
      await ctx.db.patch(subscription._id, {
        creditsUsed: Math.max(0, roundCreditAmount((subscription.creditsUsed ?? 0) - reservation.reservedCents)),
      })
    }
    await ctx.db.patch(reservation._id, {
      status: 'released',
      errorMessage: reason?.slice(0, 2000),
      updatedAt: Date.now(),
    })
    return { success: true, status: 'released' }
  },
})

export const markBudgetReservationReconcileByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    reservationId: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { serverSecret, userId, reservationId, errorMessage }) => {
    requireServerSecret(serverSecret)
    const reservation = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', reservationId.trim()))
      .first()
    if (!reservation) return { success: true, status: 'missing' }
    if (reservation.userId !== userId) throw new Error('reservation_user_mismatch')
    if (reservation.status === 'finalized') return { success: true, status: 'finalized' }
    await ctx.db.patch(reservation._id, {
      status: 'reconcile_required',
      providerWorkStarted: true,
      errorMessage: errorMessage?.slice(0, 2000),
      updatedAt: Date.now(),
    })
    return { success: true, status: 'reconcile_required' }
  },
})

export const tryReserveBackgroundWorkInternal = internalMutation({
  args: {
    userId: v.string(),
    kind: v.union(v.literal('memory_extraction'), v.literal('indexing')),
    chunkCount: v.optional(v.number()),
    bytes: v.optional(v.number()),
  },
  handler: async (ctx, { userId, kind, chunkCount, bytes }) => {
    const today = new Date().toISOString().split('T')[0]
    const dailyUsage = await getDailyUsageForPatch(ctx, userId, today)
    if (!dailyUsage) return { allowed: false, reason: 'daily_usage_unavailable' }

    if (kind === 'memory_extraction') {
      const nextCount = (dailyUsage.memoryExtractionCount ?? 0) + 1
      if (nextCount > 120) return { allowed: false, reason: 'memory_extraction_cap' }
      await ctx.db.patch(dailyUsage._id, { memoryExtractionCount: nextCount })
      return { allowed: true, reason: 'ok' }
    }

    const nextChunks = (dailyUsage.indexingChunks ?? 0) + Math.max(0, Math.ceil(chunkCount ?? 0))
    const nextBytes = (dailyUsage.indexingBytes ?? 0) + Math.max(0, Math.ceil(bytes ?? 0))
    if (nextChunks > 200) return { allowed: false, reason: 'indexing_chunk_cap' }
    if (nextBytes > 5 * 1024 * 1024) return { allowed: false, reason: 'indexing_byte_cap' }
    await ctx.db.patch(dailyUsage._id, {
      indexingChunks: nextChunks,
      indexingBytes: nextBytes,
    })
    return { allowed: true, reason: 'ok' }
  },
})

// Reset token usage for new billing period — internal only (audit log housekeeping)
export const resetTokenUsage = internalMutation({
  args: {
    userId: v.string(),
    newPeriodStart: v.string()
  },
  handler: async (ctx, { userId, newPeriodStart }) => {
    const subscription = await ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()

    const existing = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', newPeriodStart)
      )
      .first()

    if (!existing) {
      await ctx.db.insert('tokenUsage', {
        userId,
        email: subscription?.email ?? '',
        billingPeriodStart: newPeriodStart,
        creditsUsed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0
      })
    }

    return { success: true, periodStart: newPeriodStart }
  }
})

function getNextWeeklyReset(): string {
  const now = new Date()
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7
  const nextMonday = new Date(now)
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday)
  nextMonday.setUTCHours(0, 0, 0, 0)
  return nextMonday.toISOString()
}

/** Audit log for individual chat tool calls (Perplexity, generation, Composio, etc.). */
export const recordToolInvocation = mutation({
  args: {
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    userId: v.string(),
    toolId: v.string(),
    mode: v.union(v.literal('ask'), v.literal('act')),
    modelId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    success: v.boolean(),
    durationMs: v.optional(v.number()),
    costBucket: v.union(
      v.literal('perplexity'),
      v.literal('image'),
      v.literal('video'),
      v.literal('browser'),
      v.literal('daytona'),
      v.literal('composio'),
      v.literal('internal'),
    ),
    providerCostCents: v.optional(v.number()),
    billableCostCents: v.optional(v.number()),
    pricingVersion: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorizeUserAccess({
      userId: args.userId,
      accessToken: args.accessToken,
      serverSecret: args.serverSecret,
    })
    await ctx.db.insert('toolInvocations', {
      userId: args.userId,
      toolId: args.toolId.slice(0, 256),
      mode: args.mode,
      modelId: args.modelId?.slice(0, 256),
      conversationId: args.conversationId?.slice(0, 256),
      turnId: args.turnId?.slice(0, 256),
      success: args.success,
      durationMs: args.durationMs,
      costBucket: args.costBucket,
      providerCostCents: args.providerCostCents,
      billableCostCents: args.billableCostCents,
      pricingVersion: args.pricingVersion,
      errorMessage: args.errorMessage?.slice(0, 2000),
      createdAt: Date.now(),
    })
    return { success: true }
  },
})

export const listToolInvocations = query({
  args: {
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    userId: v.string(),
    conversationId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      await authorizeUserAccess({
        userId: args.userId,
        accessToken: args.accessToken,
        serverSecret: args.serverSecret,
      })
    } catch {
      return []
    }

    const limit = Math.max(1, Math.min(args.limit ?? 50, 200))

    if (args.turnId?.trim()) {
      return await ctx.db
        .query('toolInvocations')
        .withIndex('by_turnId_createdAt', (q) => q.eq('turnId', args.turnId!.trim()))
        .order('desc')
        .take(limit)
    }

    if (args.conversationId?.trim()) {
      return await ctx.db
        .query('toolInvocations')
        .withIndex('by_conversationId_createdAt', (q) =>
          q.eq('conversationId', args.conversationId!.trim()),
        )
        .order('desc')
        .take(limit)
    }

    return await ctx.db
      .query('toolInvocations')
      .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(limit)
  },
})
