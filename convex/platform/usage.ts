import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireAccessToken, requireServerSecret, validateServerSecret } from '../lib/auth'
import { logAuthDebug, summarizeJwtForLog } from '../lib/authDebug'
import { FREE_TIER_AUTO_MODEL_ID } from '../../src/shared/ai/gateway/model-types'
import { getOrCreateSubscription, getStorageBytesUsed, getStorageLimitForUser } from '../files/lib/storageQuota'
import { paidWorkspaceAccountFor } from '../billing/workspacePayer'
import { usageCountSubject } from '../../src/shared/billing/free-allowance'
import { normalizeUsageReconciliationResolution } from '../../src/shared/billing/usage-reconciliation'
import { canceledPlanCreditPatch, ensureEmptyBalance, ensurePersonalBillingAccount } from '../billing/accountModel'
import { previewProviderBudgetAvailable, recordPreviewProviderSpend } from '../lib/previewProviderBudget'

const usageReconciliationQueueItemValidator = v.object({
  createdAt: v.number(),
  errorMessage: v.optional(v.string()),
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
  providerWorkCompleted: v.boolean(),
  providerWorkStarted: v.boolean(),
  reconciliationAttempts: v.number(),
  reconciliationLastAttemptAt: v.optional(v.number()),
  reservationId: v.string(),
  reservedCents: v.number(),
  updatedAt: v.number(),
  userId: v.string(),
})

const usageReconciliationSweepResultValidator = v.object({
  oldestReconciliationUpdatedAt: v.optional(v.number()),
  pendingReconciliation: v.number(),
  reconcileRequired: v.number(),
  reconciliationQueueTruncated: v.boolean(),
  released: v.number(),
})

const usageReservationStatusValidator = v.union(
  v.literal('reserved'),
  v.literal('finalized'),
  v.literal('released'),
  v.literal('reconcile_required'),
  v.literal('expired'),
)

const workspaceReservationResultValidator = v.object({
  budgetRemainingCents: v.number(),
  budgetTotalCents: v.number(),
  budgetUsedCents: v.number(),
  idempotent: v.boolean(),
  reservationId: v.string(),
  reservedCents: v.number(),
  status: usageReservationStatusValidator,
})

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
  providerCostUsd?: number
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
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10_000) / 10_000
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

/**
 * Whose weekly count the usage belongs to: the workspace the person is working in, so a free workspace has one
 * allowance everyone in it shares. "Working in" is the person's active workspace, which the app sets whenever they open
 * or switch to one. See `usageCountSubject`. (A paid workspace pays for usage instead and never counts it here.)
 */
async function usageCounterSubject(ctx: EntitlementCtx, userId: string): Promise<string> {
  const preference = await ctx.db
    .query('workspaceUserPreferences')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  return usageCountSubject({ userId, free: true, activeWorkspaceId: preference?.activeWorkspaceId })
}

type EntitlementCtx = QueryCtx | MutationCtx

const FREE_WEEKLY_LIMITS = { ask: 15, write: 15, agent: 15 } as const
const FREE_WEEKLY_TRANSCRIPTION_SECONDS = 600

async function weeklyFreeUsage(ctx: EntitlementCtx, countSubject: string) {
  const records = await Promise.all(getPastWeekDates().map((date) =>
    ctx.db
      .query('dailyUsage')
      .withIndex('by_userId_date', (q) => q.eq('userId', countSubject).eq('date', date))
      .first()))
  return records.reduce(
    (acc, record) => ({
      ask: acc.ask + (record?.askCount ?? 0),
      write: acc.write + (record?.writeCount ?? 0),
      agent: acc.agent + (record?.agentCount ?? 0),
      transcriptionSeconds: acc.transcriptionSeconds + (record?.transcriptionSeconds ?? 0),
    }),
    { ask: 0, write: 0, agent: 0, transcriptionSeconds: 0 },
  )
}

/**
 * A person's own entitlements. An account is never free or paid (plans belong to workspaces), so this is always the
 * free allowance of the workspace they are working in, plus their storage. A paid workspace's entitlements come from
 * its billing account instead.
 */
async function buildEntitlements(ctx: EntitlementCtx, userId: string) {
  const subscription = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  const weekly = await weeklyFreeUsage(ctx, await usageCounterSubject(ctx, userId))
  return {
    billingAccountId: subscription?.billingAccountId,
    ...FREE_BUDGET,
    autoTopUpConsentGranted: false,
    overlayStorageBytesUsed: getStorageBytesUsed(subscription),
    overlayStorageBytesLimit: await getStorageLimitForUser(ctx, userId),
    dailyUsage: { ask: weekly.ask, write: weekly.write, agent: weekly.agent },
    dailyLimits: FREE_WEEKLY_LIMITS,
    transcriptionSecondsUsed: weekly.transcriptionSeconds,
    transcriptionSecondsLimit: FREE_WEEKLY_TRANSCRIPTION_SECONDS,
    localTranscriptionEnabled: false,
    resetAt: getNextWeeklyReset(),
    billingPeriodEnd: '',
    lastSyncedAt: Date.now()
  }
}

const FREE_BUDGET = {
  tier: 'free' as const,
  planKind: 'free' as const,
  planAmountCents: 0,
  budgetUsedCents: 0,
  budgetTotalCents: 0,
  budgetRemainingCents: 0,
  allowanceTotalCents: 0,
  allowanceUsedCents: 0,
  allowancePercentUsed: 0,
  topUpBalanceCents: 0,
  autoTopUpEnabled: false,
  autoTopUpAmountCents: 0,
  creditsUsed: 0,
  creditsTotal: 0,
}

export async function applyUsageEvents(
  ctx: MutationCtx,
  userId: string,
  events: UsageEvent[],
): Promise<{ success: true; eventsProcessed: number }> {
  const billingAccount = await ensurePersonalBillingAccount(ctx, userId)
  const today = new Date().toISOString().split('T')[0]
  const countSubject = await usageCounterSubject(ctx, userId)

  let dailyUsage = await ctx.db
    .query('dailyUsage')
    .withIndex('by_userId_date', (q) => q.eq('userId', countSubject).eq('date', today))
    .first()

  if (!dailyUsage) {
    const id = await ctx.db.insert('dailyUsage', {
      userId: countSubject,
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

    // An audit tally of what free usage cost us, by calendar month; nothing is charged to the person.
    const billingPeriodStart = `${today.slice(0, 7)}-01`

    let tokenUsage = await ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', billingPeriodStart)
      )
      .first()

    if (!tokenUsage) {
      const id = await ctx.db.insert('tokenUsage', {
        userId,
        billingAccountId: billingAccount.billingAccountId,
        email: subscription?.email ?? '',
        billingPeriodStart,
        creditsUsed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      })
      tokenUsage = await ctx.db.get(id)
    } else {
      if (
        tokenUsage.billingAccountId &&
        tokenUsage.billingAccountId !== billingAccount.billingAccountId
      ) {
        throw new Error('legacy_usage_account_conflict')
      }
      if (tokenUsage.billingAccountId !== billingAccount.billingAccountId || (!tokenUsage.email && subscription?.email)) {
        await ctx.db.patch(tokenUsage._id, {
          billingAccountId: billingAccount.billingAccountId,
          ...(!tokenUsage.email && subscription?.email ? { email: subscription.email } : {}),
        })
      }
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
    return {
      billingAccountId: subscription?.billingAccountId,
      ...FREE_BUDGET,
      overlayStorageBytesUsed: getStorageBytesUsed(subscription),
      overlayStorageBytesLimit: await getStorageLimitForUser(ctx, userId),
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
    await ensurePersonalBillingAccount(ctx, userId)
    const subscription = await getOrCreateSubscription(ctx, userId)
    return {
      success: true,
      tier: 'free' as const,
      overlayStorageBytesUsed: getStorageBytesUsed(subscription),
    }
  },
})

/** Holds usage outside a paid workspace to the workspace's free weekly allowance. */
async function enforceFreeTierUsageLimits(
  ctx: MutationCtx,
  userId: string,
  events: UsageEvent[],
): Promise<void> {
  const weeklyUsage = await weeklyFreeUsage(ctx, await usageCounterSubject(ctx, userId))

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

  if (weeklyUsage.ask + batchAsk > FREE_WEEKLY_LIMITS.ask) {
    throw new Error('free_tier_limit_exceeded: weekly ask limit reached')
  }
  if (weeklyUsage.write + batchWrite > FREE_WEEKLY_LIMITS.write) {
    throw new Error('free_tier_limit_exceeded: weekly write limit reached')
  }
  if (weeklyUsage.agent + batchAgent > FREE_WEEKLY_LIMITS.agent) {
    throw new Error('free_tier_limit_exceeded: weekly agent limit reached')
  }
  if (weeklyUsage.transcriptionSeconds + batchTranscriptionSeconds > FREE_WEEKLY_TRANSCRIPTION_SECONDS) {
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
    /** The workspace the usage happened in; defaults to the person's active workspace. */
    workspaceId: v.optional(v.string()),
    operationId: v.optional(v.string()),
    /** Accepted for older callers; usage outside a paid workspace is always held to the free allowance. */
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
        providerCostUsd: v.optional(v.number()),
        cost: v.number(),
        durationSeconds: v.optional(v.number()),
        timestamp: v.number()
      })
    )
  },
  handler: async (ctx, { serverSecret, userId, workspaceId, operationId: rawOperationId, events }) => {
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
    // Plans belong to workspaces: in a workspace with a paid plan the workspace pays, never the person.
    const paidWorkspace = await paidWorkspaceAccountFor(ctx, userId, workspaceId)
    if (paidWorkspace) {
      await chargeWorkspaceDirect(ctx, { billingAccountId: paidWorkspace.billingAccountId, userId, operationId, events })
      return { success: true, eventsProcessed: events.length, recorded: events.length, idempotent: false }
    }
    const billingAccount = await ensurePersonalBillingAccount(ctx, userId)
    await enforceFreeTierUsageLimits(ctx, userId, events)
    const result = await applyUsageEvents(ctx, userId, events)
    if (operationId) {
      const cents = events.reduce((sum, event) => sum + Math.max(0, event.cost), 0)
      await ctx.db.insert('usageOperations', {
        userId,
        billingAccountId: billingAccount.billingAccountId,
        operationId,
        recorded: events.length,
        ...(cents > 0 ? { cents, kind: events[0].type, ...(events[0].modelId ? { modelId: events[0].modelId } : {}), ...usageQuantities(events) } : {}),
        createdAt: Date.now(),
      })
    }
    return { ...result, recorded: events.length, idempotent: false }
  }
})

/**
 * Charges usage recorded after the fact (no reservation) to a paid workspace's balance, capped at what the balance
 * holds, and records the amount on the usage operation for the itemized usage list.
 */
async function chargeWorkspaceDirect(ctx: MutationCtx, args: {
  billingAccountId: string
  userId: string
  operationId: string | undefined
  events: Array<{ type: UsageEvent['type']; modelId?: string; cost: number; inputTokens?: number; outputTokens?: number; durationSeconds?: number }>
}) {
  const cents = args.events.reduce((sum, event) => sum + Math.max(0, event.cost), 0)
  const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
  const availableMicros = Math.max(0, balance.includedMicros + balance.institutionalGrantMicros - balance.allowanceUsedMicros)
    + Math.max(0, balance.topUpBalanceMicros)
  const chargeMicros = Math.min(Math.round(cents * 10_000), availableMicros)
  if (chargeMicros > 0) {
    const limit = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q
        .eq('billingAccountId', args.billingAccountId).eq('subjectKind', 'member').eq('subjectId', args.userId))
      .unique()
    await finalizeWorkspaceLedger(ctx, { actualMicros: chargeMicros, balance, limit, reservedMicros: 0 })
  }
  await ctx.db.insert('usageOperations', {
    userId: args.userId,
    billingAccountId: args.billingAccountId,
    operationId: args.operationId || `batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    recorded: args.events.length,
    ...(chargeMicros > 0
      ? { cents: chargeMicros / 10_000, kind: args.events[0].type, ...(args.events[0].modelId ? { modelId: args.events[0].modelId } : {}), ...usageQuantities(args.events) }
      : {}),
    createdAt: Date.now(),
  })
}

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
    const billingAccount = await ensurePersonalBillingAccount(ctx, userId)
    const normalizedReservationId = reservationId.trim()
    if (!normalizedReservationId) throw new Error('invalid_reservation_id')

    const existing = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', normalizedReservationId))
      .first()
    if (existing) {
      if (existing.userId !== userId) throw new Error('reservation_user_mismatch')
      if (existing.billingAccountId && existing.billingAccountId !== billingAccount.billingAccountId) {
        throw new Error('reservation_billing_account_mismatch')
      }
      if (
        existing.reservedCents !== roundCreditAmount(Math.max(0, reservedCents)) ||
        existing.kind !== kind ||
        existing.modelId !== modelId ||
        existing.operationId !== operationId ||
        existing.requestFingerprint !== requestFingerprint
      ) {
        throw new Error('reservation_parameter_mismatch')
      }
      if (!existing.billingAccountId) {
        await ctx.db.patch(existing._id, { billingAccountId: billingAccount.billingAccountId })
      }
      return {
        success: true,
        reservationId: existing.reservationId,
        reservedCents: existing.reservedCents,
        status: existing.status,
        idempotent: true,
      }
    }

    // A person's own account has no credit (plans belong to workspaces), so only free work can be held here.
    const safeReservedCents = roundCreditAmount(Math.max(0, reservedCents))
    if (safeReservedCents > 0) throw new Error('insufficient_budget: paid plan required')

    const now = Date.now()
    await ctx.db.insert('budgetReservations', {
      userId,
      billingAccountId: billingAccount.billingAccountId,
      reservationId: normalizedReservationId,
      status: 'reserved',
      kind,
      modelId,
      operationId,
      requestFingerprint,
      reservedCents: safeReservedCents,
      reservedAllowanceCents: 0,
      reservedTopUpCents: 0,
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

export const reserveWorkspaceBudgetByServer = mutation({
  args: {
    billingAccountId: v.string(),
    expiresAt: v.optional(v.number()),
    kind: v.union(
      v.literal('ask'), v.literal('write'), v.literal('agent'), v.literal('embedding'),
      v.literal('transcription'), v.literal('generation'), v.literal('sandbox'),
    ),
    modelId: v.optional(v.string()),
    operationId: v.string(),
    requestFingerprint: v.string(),
    reservationId: v.string(),
    reservedCents: v.number(),
    serverSecret: v.string(),
    spendSubjectId: v.string(),
    spendSubjectKind: v.union(v.literal('member'), v.literal('programmatic')),
    userId: v.string(),
    workspaceId: v.string(),
  },
  returns: workspaceReservationResultValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const billingAccountId = args.billingAccountId.trim()
    const reservationId = args.reservationId.trim()
    const spendSubjectId = args.spendSubjectId.trim()
    const userId = args.userId.trim()
    const workspaceId = args.workspaceId.trim()
    if (!billingAccountId || !reservationId || !spendSubjectId || !userId || !workspaceId) {
      throw new Error('workspace_reservation_identity_required')
    }
    const safeReservedCents = roundCreditAmount(Math.max(0, args.reservedCents))
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique()
    if (!account || account.scope !== 'workspace' || account.workspaceId !== workspaceId) {
      throw new Error('workspace_billing_account_mismatch')
    }
    const balance = await ctx.db.query('billingAccountBalances')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
      .unique()
    if (!balance) throw new Error('workspace_billing_balance_missing')
    const existing = await ctx.db.query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', reservationId))
      .unique()
    if (existing) {
      if (
        existing.userId !== userId || existing.billingAccountId !== billingAccountId ||
        existing.spendSubjectKind !== args.spendSubjectKind || existing.spendSubjectId !== spendSubjectId ||
        existing.reservedCents !== safeReservedCents || existing.kind !== args.kind ||
        existing.modelId !== args.modelId || existing.operationId !== args.operationId ||
        existing.requestFingerprint !== args.requestFingerprint
      ) throw new Error('reservation_parameter_mismatch')
      return {
        ...workspaceBalanceSummary(balance),
        idempotent: true,
        reservationId,
        reservedCents: existing.reservedCents,
        status: existing.status,
      }
    }
    if (account.status !== 'active') {
      throw new Error('workspace_billing_account_inactive')
    }
    const availableMicros = balance.mode === 'unlimited'
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, balance.includedMicros + balance.institutionalGrantMicros + balance.topUpPurchasedMicros - balance.usedMicros - balance.reservedMicros)
    const reservedMicros = Math.round(safeReservedCents * 10_000)
    if (availableMicros < reservedMicros) throw new Error('insufficient_budget')
    const limit = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q
        .eq('billingAccountId', billingAccountId)
        .eq('subjectKind', args.spendSubjectKind)
        .eq('subjectId', spendSubjectId))
      .unique()
    const now = Date.now()
    if (limit) {
      const availableLimit = now >= limit.periodStart && now < limit.periodEnd
        ? Math.max(0, limit.limitMicros - limit.usedMicros - limit.reservedMicros)
        : 0
      if (availableLimit < reservedMicros) throw new Error('spend_limit_exceeded')
    }
    if (!await previewProviderBudgetAvailable(ctx, reservedMicros)) throw new Error('preview_provider_budget_exhausted')
    await ctx.db.insert('budgetReservations', {
      billingAccountId,
      createdAt: now,
      expiresAt: args.expiresAt ?? now + 30 * 60_000,
      kind: args.kind,
      modelId: args.modelId,
      operationId: args.operationId,
      providerWorkCompleted: false,
      providerWorkStarted: false,
      requestFingerprint: args.requestFingerprint,
      reservationId,
      reservedCents: safeReservedCents,
      spendSubjectId,
      spendSubjectKind: args.spendSubjectKind,
      status: 'reserved',
      updatedAt: now,
      userId,
    })
    await ctx.db.patch(balance._id, {
      reservedMicros: balance.reservedMicros + reservedMicros,
      updatedAt: now,
      version: balance.version + 1,
    })
    if (limit) {
      await ctx.db.patch(limit._id, {
        reservedMicros: limit.reservedMicros + reservedMicros,
        updatedAt: now,
        version: limit.version + 1,
      })
    }
    return {
      ...workspaceBalanceSummary({
        ...balance,
        reservedMicros: balance.reservedMicros + reservedMicros,
      }),
      idempotent: false,
      reservationId,
      reservedCents: safeReservedCents,
      status: 'reserved' as const,
    }
  },
})

export const reconcileExpiredBudgetReservationsByServer = mutation({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  returns: usageReconciliationSweepResultValidator,
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
  returns: usageReconciliationSweepResultValidator,
  handler: async (ctx, args) => await reconcileExpiredBudgetReservations(ctx, args),
})

/**
 * A reservation whose provider call failed or overran its estimate sits in `reconcile_required` until someone
 * supplies provider evidence, and counts as held credit the whole time. Nothing supplied that evidence, so
 * holds accumulated and quietly shrank people's remaining credit (one account had 356 holds, $11.66 of a $20
 * allowance). After this long, a hold is settled by policy:
 *  - the call finished but cost more than was held (`actual_cost_exceeds_reservation`): the work was done, so
 *    the amount that was held is charged;
 *  - anything else (the call failed, or its outcome never arrived): the hold is released; the person is not
 *    charged for work they did not get.
 */
export const STALE_RECONCILIATION_AFTER_MS = 6 * 60 * 60_000
/** Each settlement reads the person's usage buckets and billing shadows, so a batch must stay small to fit one function's read limit. */
const SETTLE_BATCH_SIZE = 8

async function settleStaleReconciliations(ctx: MutationCtx, args: { limit?: number; now?: number; staleAfterMs?: number }) {
  const now = args.now ?? Date.now()
  const stale = await ctx.db
    .query('budgetReservations')
    .withIndex('by_status_updatedAt', (q) => q.eq('status', 'reconcile_required')
      .lte('updatedAt', now - (args.staleAfterMs ?? STALE_RECONCILIATION_AFTER_MS)))
    .order('asc')
    .take(Math.min(Math.max(args.limit ?? SETTLE_BATCH_SIZE, 1), 50))
  let finalized = 0
  let released = 0
  let failed = 0
  for (const reservation of stale) {
    if (await remoteRunOwnsReservation(ctx, reservation, now)) continue
    const overran = reservation.errorMessage === 'actual_cost_exceeds_reservation'
    try {
      // Sequential on purpose: each settlement reads and rewrites the same usage buckets.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await applyReservationReconciliation(ctx, {
        userId: reservation.userId,
        reservationId: reservation.reservationId,
        resolution: overran ? 'finalize' : 'release',
        ...(overran ? { actualCents: reservation.reservedCents } : {}),
        evidence: {
          source: 'system:stale-hold-policy',
          reference: reservation.reservationId,
          reason: overran
            ? 'The call finished and cost more than was held; the held amount was charged.'
            : 'The call failed or never reported an outcome; the hold was released after the grace period.',
        },
      })
      if (overran) finalized += 1
      else released += 1
    } catch (error) {
      failed += 1
      console.warn('[UsageReconciliation] Could not settle a stale hold', {
        reservationId: reservation.reservationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  // More than a batch of backlog: continue in a fresh function. Stop when a batch settled nothing, so a hold that
  // cannot be settled does not make this reschedule forever.
  if (stale.length >= Math.min(Math.max(args.limit ?? SETTLE_BATCH_SIZE, 1), 50) && finalized + released > 0) {
    await ctx.scheduler.runAfter(500, internal.platform.usage.settleStaleBudgetReservationsInternal, { ...args, now: undefined })
  }
  return { finalized, released, failed }
}

export const settleStaleBudgetReservationsInternal = internalMutation({
  args: { limit: v.optional(v.number()), now: v.optional(v.number()), staleAfterMs: v.optional(v.number()) },
  returns: v.object({ finalized: v.number(), released: v.number(), failed: v.number() }),
  handler: async (ctx, args) => await settleStaleReconciliations(ctx, args),
})

export const listBudgetReservationReconciliationByServer = query({
  args: {
    serverSecret: v.string(),
    limit: v.optional(v.number()),
    updatedBefore: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  returns: v.array(usageReconciliationQueueItemValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1_000)
    const rows = args.userId === undefined
      ? await ctx.db
        .query('budgetReservations')
        .withIndex('by_status_updatedAt', (q) => {
          const statusQuery = q.eq('status', 'reconcile_required')
          return args.updatedBefore === undefined
            ? statusQuery
            : statusQuery.lte('updatedAt', args.updatedBefore)
        })
        .order('asc')
        .take(limit)
      : (await ctx.db
        .query('budgetReservations')
        .withIndex('by_userId_createdAt', (q) => q.eq('userId', args.userId!))
        .collect())
        .filter((row) => row.status === 'reconcile_required' &&
          (args.updatedBefore === undefined || row.updatedAt <= args.updatedBefore))
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, limit)
    return rows.map((row) => ({
      createdAt: row.createdAt,
      ...(row.errorMessage === undefined ? {} : { errorMessage: row.errorMessage }),
      kind: row.kind,
      ...(row.modelId === undefined ? {} : { modelId: row.modelId }),
      providerWorkCompleted: row.providerWorkCompleted ?? false,
      providerWorkStarted: row.providerWorkStarted ?? false,
      reconciliationAttempts: row.reconciliationAttempts ?? 0,
      ...(row.reconciliationLastAttemptAt === undefined
        ? {}
        : { reconciliationLastAttemptAt: row.reconciliationLastAttemptAt }),
      reservationId: row.reservationId,
      reservedCents: row.reservedCents,
      updatedAt: row.updatedAt,
      userId: row.userId,
    }))
  },
})

export const resolveBudgetReservationReconciliationByServer = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    reservationId: v.string(),
    resolution: v.union(v.literal('finalize'), v.literal('release')),
    actualCents: v.optional(v.number()),
    evidence: v.object({
      reason: v.string(),
      reference: v.string(),
      source: v.string(),
    }),
  },
  returns: v.object({
    finalizedCents: v.optional(v.number()),
    idempotent: v.boolean(),
    status: v.union(v.literal('finalized'), v.literal('released')),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await applyReservationReconciliation(ctx, args)
  },
})

type ReservationReconciliationInput = {
  userId: string
  reservationId: string
  resolution: 'finalize' | 'release'
  actualCents?: number
  evidence: { reason: string; reference: string; source: string }
}

/** Settles one `reconcile_required` reservation with evidence. Shared by the ops mutation and the stale-hold sweep. */
async function applyReservationReconciliation(ctx: MutationCtx, args: ReservationReconciliationInput) {
    const reservation = await ctx.db
      .query('budgetReservations')
      .withIndex('by_reservationId', (q) => q.eq('reservationId', args.reservationId.trim()))
      .first()
    if (!reservation) throw new Error('reservation_not_found')
    if (reservation.userId !== args.userId) throw new Error('reservation_user_mismatch')

    const safeActualCents = args.actualCents === undefined
      ? undefined
      : roundCreditAmount(Math.max(0, args.actualCents))
    const normalized = normalizeUsageReconciliationResolution({
      actualCostCents: safeActualCents,
      evidence: args.evidence,
      reservedCents: reservation.reservedCents,
      resolution: args.resolution,
    })
    const expectedStatus: 'finalized' | 'released' = normalized.resolution === 'finalize'
      ? 'finalized'
      : 'released'
    if (reservation.reconciliationResolvedAt !== undefined) {
      const sameResolution =
        reservation.status === expectedStatus &&
        reservation.reconciliationResolution === expectedStatus &&
        reservation.reconciliationEvidenceSource === normalized.evidence.source &&
        reservation.reconciliationEvidenceReference === normalized.evidence.reference &&
        reservation.reconciliationReason === normalized.evidence.reason &&
        (expectedStatus === 'released' ||
          (reservation.finalizedCents ?? reservation.reservedCents) === normalized.actualCostCents)
      if (!sameResolution) throw new Error('reconciliation_resolution_conflict')
      return {
        ...(reservation.finalizedCents === undefined ? {} : { finalizedCents: reservation.finalizedCents }),
        idempotent: true,
        status: expectedStatus,
      }
    }
    if (reservation.status !== 'reconcile_required') {
      throw new Error(`reservation_not_reconcilable:${reservation.status}`)
    }

    const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
    if (workspaceLedger) {
      const reservedMicros = Math.round(reservation.reservedCents * 10_000)
      const finalizedCents = normalized.resolution === 'finalize' ? normalized.actualCostCents : undefined
      if (normalized.resolution === 'release') {
        await releaseWorkspaceLedger(ctx, {
          balance: workspaceLedger.balance,
          limit: workspaceLedger.limit,
          reservedMicros,
        })
      } else {
        await finalizeWorkspaceLedger(ctx, {
          actualMicros: Math.round((normalized.actualCostCents ?? 0) * 10_000),
          balance: workspaceLedger.balance,
          limit: workspaceLedger.limit,
          reservedMicros,
        })
      }
      const now = Date.now()
      await ctx.db.patch(reservation._id, {
        status: expectedStatus,
        ...(finalizedCents === undefined ? {} : { finalizedCents }),
        providerWorkCompleted: normalized.resolution === 'finalize',
        reconciliationAttempts: (reservation.reconciliationAttempts ?? 0) + 1,
        reconciliationLastAttemptAt: now,
        reconciliationResolvedAt: now,
        reconciliationResolution: expectedStatus,
        reconciliationEvidenceSource: normalized.evidence.source,
        reconciliationEvidenceReference: normalized.evidence.reference,
        reconciliationReason: normalized.evidence.reason,
        updatedAt: now,
      })
      return {
        ...(finalizedCents === undefined ? {} : { finalizedCents }),
        idempotent: false,
        status: expectedStatus,
      }
    }

    // A personal hold: the account has no balance to refund or charge, so settling it only records the outcome.
    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)

    const now = Date.now()
    const finalizedCents = normalized.resolution === 'finalize'
      ? normalized.actualCostCents
      : undefined
    await ctx.db.patch(reservation._id, {
      billingAccountId: billingAccount.billingAccountId,
      status: expectedStatus,
      ...(finalizedCents === undefined ? {} : { finalizedCents }),
      providerWorkCompleted: normalized.resolution === 'finalize',
      reconciliationAttempts: (reservation.reconciliationAttempts ?? 0) + 1,
      reconciliationLastAttemptAt: now,
      reconciliationResolvedAt: now,
      reconciliationResolution: expectedStatus,
      reconciliationEvidenceSource: normalized.evidence.source,
      reconciliationEvidenceReference: normalized.evidence.reference,
      reconciliationReason: normalized.evidence.reason,
      updatedAt: now,
    })
    return {
      ...(finalizedCents === undefined ? {} : { finalizedCents }),
      idempotent: false,
      status: expectedStatus,
    }
}

async function workspaceReservationLedger(
  ctx: MutationCtx,
  reservation: Doc<'budgetReservations'>,
): Promise<{
  balance: Doc<'billingAccountBalances'>
  limit: Doc<'billingAccountSpendLimits'> | null
} | null> {
  const workspaceTagged = Boolean(reservation.spendSubjectKind || reservation.spendSubjectId)
  if (!reservation.billingAccountId) {
    if (workspaceTagged) throw new Error('workspace_billing_account_missing')
    return null
  }
  const account = await ctx.db.query('billingAccounts')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', reservation.billingAccountId!))
    .unique()
  if (!account) {
    if (workspaceTagged) throw new Error('workspace_billing_account_missing')
    return null
  }
  if (account.scope !== 'workspace') {
    if (workspaceTagged) throw new Error('workspace_billing_account_mismatch')
    return null
  }
  const balance = await ctx.db.query('billingAccountBalances')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', reservation.billingAccountId!))
    .unique()
  if (!balance) throw new Error('workspace_billing_balance_missing')
  const limit = reservation.spendSubjectKind && reservation.spendSubjectId
    ? await ctx.db.query('billingAccountSpendLimits')
        .withIndex('by_account_subject', (q) => q
          .eq('billingAccountId', reservation.billingAccountId!)
          .eq('subjectKind', reservation.spendSubjectKind!)
          .eq('subjectId', reservation.spendSubjectId!))
        .unique()
    : null
  return { balance, limit }
}

function workspaceBalanceSummary(balance: {
  includedMicros: number
  institutionalGrantMicros: number
  mode: 'budgeted' | 'unlimited'
  reservedMicros: number
  topUpPurchasedMicros: number
  usedMicros: number
}) {
  const totalMicros = balance.mode === 'unlimited'
    ? Number.MAX_SAFE_INTEGER
    : balance.includedMicros + balance.institutionalGrantMicros + balance.topUpPurchasedMicros
  const remainingMicros = balance.mode === 'unlimited'
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, totalMicros - balance.usedMicros - balance.reservedMicros)
  return {
    budgetRemainingCents: roundCreditAmount(remainingMicros / 10_000),
    budgetTotalCents: roundCreditAmount(totalMicros / 10_000),
    budgetUsedCents: roundCreditAmount(balance.usedMicros / 10_000),
  }
}

export async function finalizeWorkspaceLedger(
  ctx: MutationCtx,
  args: {
    actualMicros: number
    balance: Doc<'billingAccountBalances'>
    limit: Doc<'billingAccountSpendLimits'> | null
    reservedMicros: number
    reserveMicros?: number
  },
): Promise<void> {
  await recordPreviewProviderSpend(ctx, args.actualMicros)
  const allowanceRemaining = Math.max(
    0,
    args.balance.includedMicros + args.balance.institutionalGrantMicros - args.balance.allowanceUsedMicros,
  )
  const allowanceCharge = Math.min(args.actualMicros, allowanceRemaining)
  const topUpCharge = Math.max(0, args.actualMicros - allowanceCharge)
  if (topUpCharge > args.balance.topUpBalanceMicros) throw new Error('workspace_billing_allocation_invalid')
  const now = Date.now()
  const reservedMicros = Math.max(0, args.balance.reservedMicros - args.reservedMicros) + (args.reserveMicros ?? 0)
  const usedMicros = args.balance.usedMicros + args.actualMicros
  await ctx.db.patch(args.balance._id, {
    ...await canceledPlanCreditPatch(ctx, args.balance, usedMicros, reservedMicros),
    allowanceUsedMicros: args.balance.allowanceUsedMicros + allowanceCharge,
    reservedMicros,
    topUpBalanceMicros: args.balance.topUpBalanceMicros - topUpCharge,
    updatedAt: now,
    usedMicros,
    version: args.balance.version + 1,
  })
  if (args.limit) {
    await ctx.db.patch(args.limit._id, {
      reservedMicros: Math.max(0, args.limit.reservedMicros - args.reservedMicros) + (args.reserveMicros ?? 0),
      updatedAt: now,
      usedMicros: args.limit.usedMicros + args.actualMicros,
      version: args.limit.version + 1,
    })
  }
}

async function releaseWorkspaceLedger(
  ctx: MutationCtx,
  args: {
    balance: Doc<'billingAccountBalances'>
    limit: Doc<'billingAccountSpendLimits'> | null
    reservedMicros: number
  },
): Promise<void> {
  const now = Date.now()
  const reservedMicros = Math.max(0, args.balance.reservedMicros - args.reservedMicros)
  await ctx.db.patch(args.balance._id, {
    ...await canceledPlanCreditPatch(ctx, args.balance, args.balance.usedMicros, reservedMicros),
    reservedMicros,
    updatedAt: now,
    version: args.balance.version + 1,
  })
  if (args.limit) {
    await ctx.db.patch(args.limit._id, {
      reservedMicros: Math.max(0, args.limit.reservedMicros - args.reservedMicros),
      updatedAt: now,
      version: args.limit.version + 1,
    })
  }
}

async function reconcileExpiredBudgetReservations(
  ctx: MutationCtx,
  args: { limit?: number; now?: number },
): Promise<{
  oldestReconciliationUpdatedAt?: number
  pendingReconciliation: number
  reconcileRequired: number
  reconciliationQueueTruncated: boolean
  released: number
}> {
  const now = args.now ?? Date.now()
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 1000)
  const rows = await ctx.db
    .query('budgetReservations')
    .withIndex('by_status_expiresAt', (q) =>
      q.eq('status', 'reserved').lte('expiresAt', now),
    )
    .take(limit)
  let reconcileRequired = 0
  let released = 0
  for (const reservation of rows) {
    if ((reservation.expiresAt ?? reservation.createdAt + 30 * 60_000) > now) continue
    if (await remoteRunOwnsReservation(ctx, reservation, now)) continue
    if (reservation.providerWorkStarted) {
      const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
      const billingAccount = workspaceLedger ? null : await ensurePersonalBillingAccount(ctx, reservation.userId)
      await ctx.db.patch(reservation._id, {
        billingAccountId: workspaceLedger ? reservation.billingAccountId! : billingAccount!.billingAccountId,
        status: 'reconcile_required',
        errorMessage: 'reservation_expired_after_provider_work',
        reconciliationAttempts: (reservation.reconciliationAttempts ?? 0) + 1,
        reconciliationLastAttemptAt: now,
        updatedAt: now,
      })
      reconcileRequired += 1
      continue
    }
    const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
    const billingAccount = workspaceLedger ? null : await ensurePersonalBillingAccount(ctx, reservation.userId)
    if (workspaceLedger && reservation.reservedCents > 0) {
      await releaseWorkspaceLedger(ctx, {
        balance: workspaceLedger.balance,
        limit: workspaceLedger.limit,
        reservedMicros: Math.round(reservation.reservedCents * 10_000),
      })
    }
    await ctx.db.patch(reservation._id, {
      billingAccountId: workspaceLedger ? reservation.billingAccountId! : billingAccount!.billingAccountId,
      status: 'released',
      errorMessage: 'reservation_expired_before_provider_work',
      updatedAt: now,
    })
    released += 1
  }
  const queueSample = await ctx.db
    .query('budgetReservations')
    .withIndex('by_status_updatedAt', (q) => q.eq('status', 'reconcile_required'))
    .order('asc')
    .take(1_001)
  const reconciliationQueueTruncated = queueSample.length > 1_000
  const pendingReconciliation = Math.min(queueSample.length, 1_000)
  const oldestReconciliationUpdatedAt = queueSample[0]?.updatedAt
  if (pendingReconciliation > 0) {
    console.warn('[UsageReconciliation] Reservations require provider evidence', {
      oldestAgeMs: oldestReconciliationUpdatedAt === undefined
        ? undefined
        : Math.max(0, now - oldestReconciliationUpdatedAt),
      pendingReconciliation,
      reconciliationQueueTruncated,
    })
  }
  return {
    ...(oldestReconciliationUpdatedAt === undefined ? {} : { oldestReconciliationUpdatedAt }),
    pendingReconciliation,
    reconcileRequired,
    reconciliationQueueTruncated,
    released,
  }
}

/** Token and second counts for the itemized usage list (only set when the events carry them). */
function usageQuantities(events: Array<{ inputTokens?: number; outputTokens?: number; durationSeconds?: number }> | undefined) {
  if (!events?.length) return {}
  const tokens = events.reduce((sum, event) => sum + Math.max(0, event.inputTokens ?? 0) + Math.max(0, event.outputTokens ?? 0), 0)
  const seconds = events.reduce((sum, event) => sum + Math.max(0, event.durationSeconds ?? 0), 0)
  return { ...(tokens > 0 ? { usageTokens: tokens } : {}), ...(seconds > 0 ? { usageSeconds: seconds } : {}) }
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
        providerCostUsd: v.optional(v.number()),
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
    const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
    const billingAccount = workspaceLedger ? null : await ensurePersonalBillingAccount(ctx, userId)
    const billingAccountId = workspaceLedger
      ? reservation.billingAccountId!
      : billingAccount!.billingAccountId

    const safeActualCents = roundCreditAmount(Math.max(0, actualCents))
    const providerCostMicros = events?.some((event) => event.providerCostUsd !== undefined)
      ? Math.round(events.reduce((total, event) => total + Math.max(0, event.providerCostUsd ?? 0), 0) * 1_000_000)
      : undefined
    const quantities = usageQuantities(events)
    if (safeActualCents > reservation.reservedCents + 0.000001) {
      const now = Date.now()
      await ctx.db.patch(reservation._id, {
        billingAccountId,
        status: 'reconcile_required',
        providerWorkStarted: true,
        providerWorkCompleted: true,
        errorMessage: 'actual_cost_exceeds_reservation',
        reconciliationAttempts: (reservation.reconciliationAttempts ?? 0) + 1,
        reconciliationLastAttemptAt: now,
        updatedAt: now,
      })
      return {
        success: false,
        status: 'reconcile_required' as const,
        error: 'actual_cost_exceeds_reservation',
      }
    }
    if (workspaceLedger) {
      const reservedMicros = Math.round(reservation.reservedCents * 10_000)
      const actualMicros = Math.round(safeActualCents * 10_000)
      await finalizeWorkspaceLedger(ctx, {
        actualMicros,
        balance: workspaceLedger.balance,
        limit: workspaceLedger.limit,
        reservedMicros,
      })
      await ctx.db.patch(reservation._id, {
        status: 'finalized',
        finalizedCents: safeActualCents,
        ...(providerCostMicros === undefined ? {} : { providerCostMicros }),
        ...quantities,
        providerWorkStarted: true,
        providerWorkCompleted: true,
        updatedAt: Date.now(),
      })
      return { success: true, status: 'finalized' as const, finalizedCents: safeActualCents }
    }
    if (!billingAccount) throw new Error('personal_billing_account_missing')
    // A personal hold is always free work (see reserveBudgetByServer); record the usage against the free allowance.
    if (events?.length) {
      await enforceFreeTierUsageLimits(ctx, userId, events)
      await applyUsageEvents(ctx, userId, events)
    }

    await ctx.db.patch(reservation._id, {
      billingAccountId: billingAccount.billingAccountId,
      status: 'finalized',
      finalizedCents: safeActualCents,
      ...(providerCostMicros === undefined ? {} : { providerCostMicros }),
      ...quantities,
      providerWorkStarted: true,
      providerWorkCompleted: true,
      updatedAt: Date.now(),
    })

    return { success: true, status: 'finalized', finalizedCents: safeActualCents }
  },
})

export const getBillingAccountOperationalReportByServer = query({
  args: {
    billingAccountId: v.string(),
    now: v.optional(v.number()),
    periodStart: v.number(),
    reconciliationSlaMs: v.number(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const now = args.now ?? Date.now()
    const finalized = await ctx.db.query('budgetReservations')
      .withIndex('by_billingAccountId_status_createdAt', (q) => q
        .eq('billingAccountId', args.billingAccountId)
        .eq('status', 'finalized')
        .gte('createdAt', args.periodStart))
      .collect()
    const inPeriod = finalized.filter((row) => row.createdAt <= now)
    const retailCostCents = inPeriod.reduce((total, row) => total + (row.finalizedCents ?? 0), 0)
    const providerCostMicros = inPeriod.reduce((total, row) => total + (row.providerCostMicros ?? 0), 0)
    const covered = inPeriod.filter((row) => row.providerCostMicros !== undefined).length
    const reconciliation = await ctx.db.query('budgetReservations')
      .withIndex('by_billingAccountId_status_createdAt', (q) => q
        .eq('billingAccountId', args.billingAccountId)
        .eq('status', 'reconcile_required'))
      .collect()
    const oldestUpdatedAt = reconciliation.reduce<number | undefined>((oldest, row) => (
      oldest === undefined || row.updatedAt < oldest ? row.updatedAt : oldest
    ), undefined)
    const actualProviderCostCents = providerCostMicros / 10_000
    return {
      actualProviderCostCents,
      costCoveragePercent: inPeriod.length > 0 ? Math.round((covered / inPeriod.length) * 10_000) / 100 : 100,
      meteredReservations: inPeriod.length,
      oldestReconciliationAgeMs: oldestUpdatedAt === undefined ? 0 : Math.max(0, now - oldestUpdatedAt),
      periodEnd: now,
      periodStart: args.periodStart,
      realizedMarginPercent: retailCostCents > 0
        ? Math.round(((retailCostCents - actualProviderCostCents) / retailCostCents) * 10_000) / 100
        : null,
      retailCostCents,
      retailCredits: Math.round(retailCostCents * 10),
      staleReconciliationReservations: reconciliation.filter((row) => row.updatedAt <= now - args.reconciliationSlaMs).length,
      reconciliationReservations: reconciliation.length,
    }
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
      const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
      const billingAccount = workspaceLedger ? null : await ensurePersonalBillingAccount(ctx, userId)
      await ctx.db.patch(reservation._id, {
        billingAccountId: workspaceLedger ? reservation.billingAccountId! : billingAccount!.billingAccountId,
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
    const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
    const billingAccount = workspaceLedger ? null : await ensurePersonalBillingAccount(ctx, userId)
    const billingAccountId = workspaceLedger ? reservation.billingAccountId! : billingAccount!.billingAccountId

    if (providerWorkStarted || reservation.providerWorkStarted) {
      const now = Date.now()
      await ctx.db.patch(reservation._id, {
        billingAccountId,
        status: 'reconcile_required',
        providerWorkStarted: true,
        errorMessage: reason?.slice(0, 2000),
        reconciliationAttempts: (reservation.reconciliationAttempts ?? 0) + 1,
        reconciliationLastAttemptAt: now,
        updatedAt: now,
      })
      return { success: true, status: 'reconcile_required' }
    }

    if (workspaceLedger && reservation.reservedCents > 0) {
      await releaseWorkspaceLedger(ctx, {
        balance: workspaceLedger.balance,
        limit: workspaceLedger.limit,
        reservedMicros: Math.round(reservation.reservedCents * 10_000),
      })
    }
    await ctx.db.patch(reservation._id, {
      billingAccountId,
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
    return await markBudgetReservationReconcile(ctx, { userId, reservationId, errorMessage })
  },
})

/** Internal callers use this helper when terminal provider state is committed in the same mutation. */
export async function markBudgetReservationReconcile(
  ctx: MutationCtx,
  args: { userId: string; reservationId: string; errorMessage?: string },
) {
  const reservation = await ctx.db
    .query('budgetReservations')
    .withIndex('by_reservationId', (q) => q.eq('reservationId', args.reservationId.trim()))
    .first()
  if (!reservation) return { success: true, status: 'missing' as const }
  if (reservation.userId !== args.userId) throw new Error('reservation_user_mismatch')
  if (reservation.status === 'finalized' || reservation.status === 'reconcile_required') {
    return { success: true, status: reservation.status }
  }
  if (reservation.status !== 'reserved') return { success: true, status: reservation.status }
  const workspaceLedger = await workspaceReservationLedger(ctx, reservation)
  const billingAccount = workspaceLedger ? null : await ensurePersonalBillingAccount(ctx, args.userId)
  const now = Date.now()
  await ctx.db.patch(reservation._id, {
    billingAccountId: workspaceLedger ? reservation.billingAccountId! : billingAccount!.billingAccountId,
    status: 'reconcile_required',
    providerWorkStarted: true,
    errorMessage: args.errorMessage?.slice(0, 2000),
    reconciliationAttempts: (reservation.reconciliationAttempts ?? 0) + 1,
    reconciliationLastAttemptAt: now,
    updatedAt: now,
  })
  return { success: true, status: 'reconcile_required' as const }
}

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
    const billingAccount = await ensurePersonalBillingAccount(ctx, userId)
    const [subscription, existing] = await Promise.all([
      ctx.db
      .query('subscriptions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
        .first(),
      ctx.db
      .query('tokenUsage')
      .withIndex('by_userId_period', (q) =>
        q.eq('userId', userId).eq('billingPeriodStart', newPeriodStart)
      )
        .first(),
    ])

    if (!existing) {
      await ctx.db.insert('tokenUsage', {
        userId,
        billingAccountId: billingAccount.billingAccountId,
        email: subscription?.email ?? '',
        billingPeriodStart: newPeriodStart,
        creditsUsed: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0
      })
    } else if (existing.billingAccountId !== billingAccount.billingAccountId) {
      if (existing.billingAccountId) throw new Error('legacy_usage_account_conflict')
      await ctx.db.patch(existing._id, { billingAccountId: billingAccount.billingAccountId })
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
    const billingAccount = await ensurePersonalBillingAccount(ctx, args.userId)
    await ctx.db.insert('toolInvocations', {
      userId: args.userId,
      billingAccountId: billingAccount.billingAccountId,
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

/** Unknown consumed usage cannot be released by expiry while execution/settlement is unresolved. */
async function remoteRunOwnsReservation(ctx: MutationCtx, reservation: { remoteRunId?: string }, now: number) {
  if (!reservation.remoteRunId) return false
  const run = await ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', reservation.remoteRunId!)).unique()
  if (!run?.remoteLifecycle) return false
  if (!['completed', 'cancelled', 'failed'].includes(run.remoteLifecycle.phase)) return true
  const finalization = await ctx.db.query('agentRemoteRunIntents').withIndex('by_intentId', q => q.eq('intentId', `finalize:${reservation.remoteRunId}:${run.remoteLifecycle!.currentAttemptId}`)).unique()
  void now
  return finalization?.status === 'pending'
}
