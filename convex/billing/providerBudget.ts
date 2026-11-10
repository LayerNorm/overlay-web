import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { workspaceExecutionAccess } from '../../src/shared/billing/execution-access'
import { paidWorkspaceAccountFor } from './workspacePayer'

/**
 * Background provider work (embeddings, memory extraction) pays from a paid workspace. Before the call this reads
 * the real balance and refuses only when the workspace cannot run work (under 2% of its budget left, plan not
 * active) or the admin's spend limit for this member or program is used up. Nothing is estimated or held: the
 * actual cost is charged after the call (`chargeProviderUsageDirect` in convex/lib/providerBudgetCharge.ts).
 * `alreadyCharged` reports that this exact operation was charged before, so a replay can skip the work.
 */
export const providerBudgetGate = internalQuery({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    programmaticSubjectId: v.optional(v.string()),
    operationId: v.optional(v.string()),
  },
  returns: v.object({ allowed: v.boolean(), alreadyCharged: v.boolean() }),
  handler: async (ctx, args) => {
    const operationId = args.operationId?.trim()
    const alreadyCharged = operationId
      ? (await ctx.db.query('usageOperations').withIndex('by_operationId', (q) => q.eq('operationId', operationId)).first()) !== null
      : false
    const paid = await paidWorkspaceAccountFor(ctx, args.userId, args.workspaceId)
    if (!paid) return { allowed: false, alreadyCharged }
    const [account, balance, subscription] = await Promise.all([
      ctx.db.query('billingAccounts').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', paid.billingAccountId)).unique(),
      ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', paid.billingAccountId)).unique(),
      ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', paid.billingAccountId)).first(),
    ])
    if (!account || !balance) return { allowed: false, alreadyCharged }
    const now = Date.now()
    const totalMicros = balance.includedMicros + balance.institutionalGrantMicros + balance.topUpPurchasedMicros
    const access = workspaceExecutionAccess({
      billingEnabled: true,
      accountStatus: account.status,
      subscription,
      remainingCents: balance.mode === 'unlimited'
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, totalMicros - balance.usedMicros - balance.reservedMicros) / 10_000,
      totalCents: balance.mode === 'unlimited' ? undefined : totalMicros / 10_000,
      now,
    })
    if (!access.canExecute) return { allowed: false, alreadyCharged }
    const programmatic = args.programmaticSubjectId?.trim()
    const limit = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q
        .eq('billingAccountId', paid.billingAccountId)
        .eq('subjectKind', programmatic ? 'programmatic' : 'member')
        .eq('subjectId', programmatic ?? args.userId))
      .unique()
    if (limit && (now < limit.periodStart || now >= limit.periodEnd
      || limit.usedMicros + limit.reservedMicros >= limit.limitMicros)) {
      return { allowed: false, alreadyCharged }
    }
    return { allowed: true, alreadyCharged }
  },
})
