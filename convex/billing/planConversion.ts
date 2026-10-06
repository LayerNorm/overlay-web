import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { derivePlanKind, getStorageLimitBytes } from '../../src/shared/billing/billing-pricing'
import {
  resolveWorkspaceBillingRollout,
  workspaceBillingRolloutConfigFromEnv,
} from '../../src/shared/billing/workspace-billing-rollout'
import {
  activeReservationSummary,
  balanceDifferences,
  legacyBalanceSnapshot,
  syncPersonalBillingShadows,
} from './accountMigration'
import { ensurePersonalBillingAccount, uniquePersonalAccount, uniqueWorkspaceAccount } from './accountModel'

/**
 * Moves a person's paid plan onto one of their workspaces, on request (docs/develop/billing-plan-conversion.md).
 *
 * A personal plan lives in the person's `subscriptions` row and is mirrored into the account-keyed tables after every
 * change; a workspace plan lives in the account-keyed tables alone. Converting makes the same billing account (so its
 * Stripe subscription, balance, top-ups, and history all stay) the workspace's: it stops being a personal account, the
 * person's legacy row is reset to the free plan, and the person gets a fresh free personal account. No Stripe object is
 * touched. Run `previewPlanConversion` first: it changes nothing and lists what would block the move and what it does.
 * `revertPlanConversion` undoes a conversion, carrying balances and usage back.
 */

const MICROS_PER_CENT = 10_000

type ReadCtx = QueryCtx | MutationCtx

export type PlanConversionPreview = {
  blockers: string[]
  ok: boolean
  billingAccountId?: string
  plan?: { amountCents: number; stripeSubscriptionId?: string; status: string }
  balance?: { usedCents: number; topUpBalanceCents: number; remainingCents: number }
  effects: string[]
}

async function ownerOf(ctx: ReadCtx, workspaceId: string, userId: string): Promise<boolean> {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
  if (!principal) return false
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
    .unique()
  return membership?.role === 'owner' && membership.status === 'active'
}

async function planConversion(ctx: ReadCtx, args: { userId: string; workspaceId: string }): Promise<PlanConversionPreview> {
  const blockers: string[] = []
  const effects: string[] = []
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
    .unique()
  if (!workspace || workspace.status !== 'active') blockers.push('workspace_not_active')
  if (!(await ownerOf(ctx, args.workspaceId, args.userId))) blockers.push('person_is_not_the_workspace_owner')
  if (await uniqueWorkspaceAccount(ctx, args.workspaceId)) blockers.push('workspace_already_has_a_billing_account')
  if (!resolveWorkspaceBillingRollout(workspaceBillingRolloutConfigFromEnv(process.env), args.workspaceId).eligible) {
    // Without this the workspace would resolve to the free allowance and the person would lose the plan they paid for.
    blockers.push('workspace_billing_is_not_enabled_for_this_workspace')
  }
  const previous = await ctx.db.query('billingPlanConversions')
    .withIndex('by_userId', (q) => q.eq('userId', args.userId))
    .collect()
  if (previous.some((row) => row.revertedAt === undefined)) blockers.push('person_already_converted_a_plan')

  const account = await uniquePersonalAccount(ctx, args.userId)
  const subscription = await ctx.db.query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', args.userId))
    .unique()
  if (!account) blockers.push('no_personal_billing_account')
  if (!subscription || derivePlanKind(subscription) !== 'paid') blockers.push('personal_plan_is_not_paid')
  if (subscription && !subscription.stripeSubscriptionId) blockers.push('no_stripe_subscription_on_the_plan')
  // Workspace pools have no auto top-up, so converting would silently stop it.
  if (subscription?.autoTopUpEnabled) blockers.push('auto_top_up_is_on_turn_it_off_first')
  if (!account || !subscription) return { blockers, ok: false, effects }

  const reservations = await activeReservationSummary(ctx, account.billingAccountId)
  if (reservations.truncated || reservations.reservedCents > 0) blockers.push('usage_is_in_flight_try_again_shortly')
  const canonical = await ctx.db.query('billingAccountBalances')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId))
    .unique()
  const legacy = legacyBalanceSnapshot(account.billingAccountId, subscription, reservations.reservedCents)
  if (canonical) {
    const differences = balanceDifferences(legacy, canonical)
    if (differences.length > 0) blockers.push(`balance_copy_differs:${differences.join(',')}`)
  }

  const freeStorageLimit = getStorageLimitBytes({ planKind: 'free', planAmountCents: 0 })
  const storageUsed = Math.max(0, subscription.overlayStorageBytesUsed ?? 0)
  effects.push('The person’s own plan becomes Free; they get a fresh free personal account.')
  effects.push('Everyone in the workspace draws from the plan’s credits; members’ usage is attributed per member and per agent.')
  effects.push('The Stripe subscription, customer, and top-up history are untouched; renewals and changes route to the workspace.')
  if (storageUsed > freeStorageLimit) {
    effects.push(`The person’s storage limit drops to the free limit; they use ${storageUsed} bytes against ${freeStorageLimit}, so they keep their files but cannot add more until they are under it.`)
  }
  const usedCents = legacy.usedMicros / MICROS_PER_CENT
  return {
    blockers,
    ok: blockers.length === 0,
    billingAccountId: account.billingAccountId,
    plan: {
      amountCents: legacy.includedMicros / MICROS_PER_CENT,
      ...(subscription.stripeSubscriptionId ? { stripeSubscriptionId: subscription.stripeSubscriptionId } : {}),
      status: subscription.status,
    },
    balance: {
      usedCents,
      topUpBalanceCents: legacy.topUpBalanceMicros / MICROS_PER_CENT,
      remainingCents: Math.max(0, (legacy.includedMicros + legacy.institutionalGrantMicros + legacy.topUpPurchasedMicros - legacy.usedMicros) / MICROS_PER_CENT),
    },
    effects,
  }
}

/** Read-only: what converting this person's plan onto this workspace would do, and what blocks it. */
export const previewPlanConversion = internalQuery({
  args: { userId: v.string(), workspaceId: v.string() },
  handler: async (ctx, args): Promise<PlanConversionPreview> => await planConversion(ctx, args),
})

export const convertPlanToWorkspace = internalMutation({
  args: { userId: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    const preview = await planConversion(ctx, args)
    if (!preview.ok) throw new Error(`plan_conversion_blocked:${preview.blockers.join(',')}`)
    const accountId = preview.billingAccountId!
    // Make the account-keyed copy equal the person's row one last time; it becomes the only copy.
    await syncPersonalBillingShadows(ctx, args.userId, accountId)
    const subscription = (await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', args.userId)).unique())!
    const account = (await uniquePersonalAccount(ctx, args.userId))!
    const now = Date.now()
    const { _id, _creationTime, ...snapshot } = subscription
    void _id
    void _creationTime
    await ctx.db.insert('billingPlanConversions', {
      billingAccountId: accountId,
      userId: args.userId,
      workspaceId: args.workspaceId,
      legacySubscription: snapshot,
      createdAt: now,
    })
    await ctx.db.patch(account._id, {
      scope: 'workspace',
      workspaceId: args.workspaceId,
      userId: undefined,
      primaryBillingContactUserId: args.userId,
      updatedAt: now,
    })
    await ctx.db.patch(subscription._id, {
      tier: 'free',
      planKind: 'free',
      planAmountCents: 0,
      status: 'active',
      stripeCustomerId: undefined,
      stripeSubscriptionId: undefined,
      stripePriceId: undefined,
      stripeQuantity: undefined,
      billingAccountId: undefined,
      creditsUsed: 0,
      allowanceUsedCents: 0,
      topUpPurchasedCents: 0,
      topUpBalanceCents: 0,
      institutionalGrantCents: undefined,
      autoTopUpEnabled: false,
      autoTopUpAmountCents: 0,
      offSessionConsentAt: undefined,
    })
    const personal = await ensurePersonalBillingAccount(ctx, args.userId)
    await syncPersonalBillingShadows(ctx, args.userId, personal.billingAccountId)
    return { billingAccountId: accountId, workspaceId: args.workspaceId, personalBillingAccountId: personal.billingAccountId }
  },
})

/**
 * Undoes a conversion: the account goes back to the person, and the credits used since (by anyone in the workspace) and
 * the balance carry back into their subscription row. Refused while usage is in flight, while per-member spend limits
 * exist, or if the person has started using their new personal account.
 */
export const revertPlanConversion = internalMutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const conversion = (await ctx.db.query('billingPlanConversions').withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect())
      .find((row) => row.revertedAt === undefined)
    if (!conversion) throw new Error('no_plan_conversion_to_revert')
    const account = await uniqueWorkspaceAccount(ctx, args.workspaceId)
    if (!account || account.billingAccountId !== conversion.billingAccountId) throw new Error('plan_conversion_account_changed')
    const reservations = await activeReservationSummary(ctx, account.billingAccountId)
    if (reservations.truncated || reservations.reservedCents > 0) throw new Error('plan_revert_blocked:usage_is_in_flight')
    const limits = await ctx.db.query('billingAccountSpendLimits')
      .withIndex('by_account_subject', (q) => q.eq('billingAccountId', account.billingAccountId))
      .first()
    if (limits) throw new Error('plan_revert_blocked:spend_limits_exist')

    const userId = conversion.userId
    const personal = await uniquePersonalAccount(ctx, userId)
    const row = await ctx.db.query('subscriptions').withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
    if (!row) throw new Error('plan_revert_blocked:person_has_no_subscription_row')
    const personalInUse = Boolean(
      (row.creditsUsed ?? 0) > 0 || row.stripeSubscriptionId || (row.topUpPurchasedCents ?? 0) > 0
      || (personal && (await ctx.db.query('budgetReservations').withIndex('by_billingAccountId_status_createdAt', (q) => q.eq('billingAccountId', personal.billingAccountId)).first())),
    )
    if (personalInUse) throw new Error('plan_revert_blocked:personal_account_in_use')

    const [balance, planRow] = await Promise.all([
      ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId)).unique(),
      ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', account.billingAccountId)).unique(),
    ])
    if (!balance || !planRow) throw new Error('plan_revert_blocked:workspace_plan_rows_missing')

    // Drop the empty personal account made at conversion, then hand the original back.
    if (personal) {
      const [personalBalance, personalPlan] = await Promise.all([
        ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', personal.billingAccountId)).unique(),
        ctx.db.query('billingAccountSubscriptions').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', personal.billingAccountId)).unique(),
      ])
      if (personalBalance) await ctx.db.delete(personalBalance._id)
      if (personalPlan) await ctx.db.delete(personalPlan._id)
      await ctx.db.delete(personal._id)
    }
    const now = Date.now()
    await ctx.db.patch(account._id, {
      scope: 'personal',
      userId,
      workspaceId: undefined,
      primaryBillingContactUserId: userId,
      updatedAt: now,
    })
    const original = conversion.legacySubscription as Partial<Doc<'subscriptions'>>
    await ctx.db.patch(row._id, {
      tier: original.tier ?? 'pro',
      planKind: planRow.planKind,
      planAmountCents: planRow.planAmountCents,
      status: planRow.status,
      stripeCustomerId: planRow.providerCustomerId,
      stripeSubscriptionId: planRow.providerSubscriptionId,
      stripePriceId: planRow.providerPriceId,
      stripeQuantity: planRow.providerQuantity,
      billingAccountId: account.billingAccountId,
      currentPeriodStart: planRow.currentPeriodStart,
      currentPeriodEnd: planRow.currentPeriodEnd,
      creditsUsed: balance.usedMicros / MICROS_PER_CENT,
      allowanceUsedCents: balance.allowanceUsedMicros / MICROS_PER_CENT,
      topUpPurchasedCents: balance.topUpPurchasedMicros / MICROS_PER_CENT,
      topUpBalanceCents: balance.topUpBalanceMicros / MICROS_PER_CENT,
      institutionalGrantCents: balance.institutionalGrantMicros / MICROS_PER_CENT || undefined,
      autoTopUpEnabled: planRow.autoTopUpEnabled,
      autoTopUpAmountCents: planRow.autoTopUpAmountCents,
      offSessionConsentAt: planRow.offSessionConsentAt,
    })
    await syncPersonalBillingShadows(ctx, userId, account.billingAccountId)
    await ctx.db.patch(conversion._id, { revertedAt: now })
    return { billingAccountId: account.billingAccountId, userId }
  },
})

/**
 * For Stripe webhooks: the workspace billing account a subscription or customer now belongs to, if its plan was
 * converted. Null for everything else, so every other event keeps its existing route.
 */
export const resolveWorkspaceAccountByProviderReference = internalQuery({
  args: { stripeCustomerId: v.optional(v.string()), stripeSubscriptionId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string | null> => {
    const rows = [
      args.stripeSubscriptionId
        ? await ctx.db.query('billingAccountSubscriptions').withIndex('by_providerSubscriptionId', (q) => q.eq('providerSubscriptionId', args.stripeSubscriptionId)).first()
        : null,
      args.stripeCustomerId
        ? await ctx.db.query('billingAccountSubscriptions').withIndex('by_providerCustomerId', (q) => q.eq('providerCustomerId', args.stripeCustomerId)).first()
        : null,
    ]
    for (const row of rows) {
      if (!row) continue
      const account = await ctx.db.query('billingAccounts').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', row.billingAccountId)).unique()
      if (account?.scope === 'workspace') return account.billingAccountId
    }
    return null
  },
})
