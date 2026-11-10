import { v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import { mutation, query, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireAccessToken, requireServerSecret, validateServerSecret } from '../lib/auth'
import { logAuthDebug, summarizeJwtForLog } from '../lib/authDebug'
import { getOrCreateSubscription, getStorageBytesUsed, getStorageLimitForUser } from '../files/lib/storageQuota'
import { paidWorkspaceAccountFor } from '../billing/workspacePayer'
import { workspaceBudgetLow } from '../../src/shared/billing/execution-access'
import { canceledPlanCreditPatch, ensureEmptyBalance, ensurePersonalBillingAccount } from '../billing/accountModel'
import { previewProviderBudgetSpent, recordPreviewProviderSpend } from '../lib/previewProviderBudget'

function countsAsMessage(event: {
  type: 'ask' | 'write' | 'agent' | 'embedding' | 'transcription' | 'generation' | 'sandbox'
  modelId?: string
  countAsRequest?: boolean
}): boolean {
  if (event.countAsRequest === false) return false
  if (event.type !== 'ask' && event.type !== 'write' && event.type !== 'agent') return false
  return true
}

export type UsageEvent = {
  type: 'ask' | 'write' | 'agent' | 'embedding' | 'transcription' | 'generation' | 'sandbox'
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  countAsRequest?: boolean
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

type EntitlementCtx = QueryCtx | MutationCtx

/** Personal setup/storage has no execution allowance. Workspace funding is resolved separately. */
export async function buildEntitlements(ctx: EntitlementCtx, userId: string) {
  const subscription = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  return {
    billingAccountId: subscription?.billingAccountId,
    ...EMPTY_EXECUTION_BUDGET,
    autoTopUpConsentGranted: false,
    overlayStorageBytesUsed: getStorageBytesUsed(subscription),
    overlayStorageBytesLimit: await getStorageLimitForUser(ctx, userId),
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: 0, write: 0, agent: 0 },
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: 0,
    localTranscriptionEnabled: false,
    resetAt: '',
    billingPeriodEnd: '',
    lastSyncedAt: Date.now()
  }
}

const EMPTY_EXECUTION_BUDGET = {
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
    if (countsAsMessage(event)) {
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

    // Historical reservations and billing-disabled installations still retain an audit tally.
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
      ...EMPTY_EXECUTION_BUDGET,
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
    /** Charges this program's admin spend limit instead of the member's. */
    programmaticSubjectId: v.optional(v.string()),
    operationId: v.optional(v.string()),
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
        countAsRequest: v.optional(v.boolean()),
        providerCostUsd: v.optional(v.number()),
        cost: v.number(),
        durationSeconds: v.optional(v.number()),
        timestamp: v.number()
      })
    )
  },
  handler: async (ctx, { serverSecret, userId, workspaceId, programmaticSubjectId, operationId: rawOperationId, events }) => {
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
      const { budgetLow } = await chargeWorkspaceDirect(ctx, {
        billingAccountId: paidWorkspace.billingAccountId, userId, programmaticSubjectId: programmaticSubjectId?.trim() || undefined, operationId, events,
      })
      return { success: true, eventsProcessed: events.length, recorded: events.length, idempotent: false, budgetLow }
    }
    const billingAccount = await ensurePersonalBillingAccount(ctx, userId)
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
export function workspaceAvailableMicros(balance: Doc<'billingAccountBalances'>): number {
  return Math.max(0, balance.includedMicros + balance.institutionalGrantMicros - balance.allowanceUsedMicros)
    + Math.max(0, balance.topUpBalanceMicros)
}

async function chargeWorkspaceDirect(ctx: MutationCtx, args: {
  billingAccountId: string
  userId: string
  programmaticSubjectId?: string
  operationId: string | undefined
  events: Array<{ type: UsageEvent['type']; modelId?: string; cost: number; inputTokens?: number; outputTokens?: number; durationSeconds?: number }>
}) {
  const cents = args.events.reduce((sum, event) => sum + Math.max(0, event.cost), 0)
  const balance = await ensureEmptyBalance(ctx, args.billingAccountId)
  const chargeMicros = Math.min(Math.round(cents * 10_000), workspaceAvailableMicros(balance))
  if (chargeMicros > 0) {
    const limit = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q
        .eq('billingAccountId', args.billingAccountId)
        .eq('subjectKind', args.programmaticSubjectId ? 'programmatic' : 'member')
        .eq('subjectId', args.programmaticSubjectId ?? args.userId))
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
  return { budgetLow: await workspaceBudgetLowAfterCharge(ctx, balance._id) }
}

/**
 * Read after a direct charge: the workspace now has under 2% of its budget left (work stops), or on Preview the
 * backend's provider budget is spent. Unlimited workspaces never stop for budget.
 */
export async function workspaceBudgetLowAfterCharge(ctx: MutationCtx, balanceId: Id<'billingAccountBalances'>): Promise<boolean> {
  if (await previewProviderBudgetSpent(ctx)) return true
  const after = await ctx.db.get(balanceId)
  if (!after || after.mode === 'unlimited') return false
  const summary = workspaceBalanceSummary(after)
  return workspaceBudgetLow({ remainingCents: summary.budgetRemainingCents, totalCents: summary.budgetTotalCents })
}

/** What a workspace balance has left, in cents, after holds. */
export function workspaceRemainingCents(balance: Doc<'billingAccountBalances'>): number {
  return workspaceBalanceSummary(balance).budgetRemainingCents
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

/**
 * Charges `actualMicros` to a workspace balance (allowance first, then top-ups) and its spend limit. `reservedMicros`
 * releases a legacy hold in the same write (a lease's runtime hold from before holds were removed); new charges pass 0.
 */
export async function finalizeWorkspaceLedger(
  ctx: MutationCtx,
  args: {
    actualMicros: number
    balance: Doc<'billingAccountBalances'>
    limit: Doc<'billingAccountSpendLimits'> | null
    reservedMicros: number
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
  const reservedMicros = Math.max(0, args.balance.reservedMicros - args.reservedMicros)
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
      reservedMicros: Math.max(0, args.limit.reservedMicros - args.reservedMicros),
      updatedAt: now,
      usedMicros: args.limit.usedMicros + args.actualMicros,
      version: args.limit.version + 1,
    })
  }
}

/** Token and second counts for the itemized usage list (only set when the events carry them). */
function usageQuantities(events: Array<{ inputTokens?: number; outputTokens?: number; durationSeconds?: number }> | undefined) {
  if (!events?.length) return {}
  const tokens = events.reduce((sum, event) => sum + Math.max(0, event.inputTokens ?? 0) + Math.max(0, event.outputTokens ?? 0), 0)
  const seconds = events.reduce((sum, event) => sum + Math.max(0, event.durationSeconds ?? 0), 0)
  return { ...(tokens > 0 ? { usageTokens: tokens } : {}), ...(seconds > 0 ? { usageSeconds: seconds } : {}) }
}

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
