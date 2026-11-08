import { v } from 'convex/values'
import { canManageWorkspace } from '@overlay/workspace-contracts'
import type { QueryCtx } from '../_generated/server'
import { query } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { nativeDeploymentFeatureEnabled } from '../lib/nativeDeploymentPolicy'
import { buildEntitlements } from '../platform/usage'
import { workspaceBillingAccountFor } from './accounts'
import { accountEntitlementsFor, accountPlanFor } from './accountSubscriptions'
import { usageTotalsFor } from './usageTotals'
import { appSubscriptionResponse, unfundedAppSubscription } from '@/shared/billing/app-subscription'
import { billingPeriodStartOf, composeWorkspaceBillingSummary } from '@/shared/billing/workspace-billing-summary'

type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>

async function viewerFor(ctx: Pick<QueryCtx, 'auth' | 'db'>, workspaceId: string): Promise<Viewer | null> {
  try {
    return await requireNativeWorkspace(ctx, workspaceId)
  } catch {
    return null
  }
}

/** Owners and admins may always add usage; members only when the workspace lets members top up. */
async function mayTopUp(ctx: Pick<QueryCtx, 'db'>, viewer: Viewer) {
  if (canManageWorkspace(viewer.membership.role)) return true
  if (viewer.membership.role !== 'member') return false
  const policy = await ctx.db.query('workspaceSharingPolicies').withIndex('by_workspaceId', q => q.eq('workspaceId', viewer.workspaceId)).unique()
  return (policy?.usageTopUpBy ?? 'admins') === 'members'
}

/**
 * Workspace → Billing, live, for any active member: plan, balance in credits, what happens at $0 and the paid
 * period's itemized usage, built exactly as the billing route builds it. A webhook-confirmed payment, a top-up or a
 * charge updates every open Billing tab. Provider customer, subscription and payment IDs never leave Convex.
 */
export const workspaceSummary = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await viewerFor(ctx, workspaceId)
    if (!viewer) return null
    const [account, mine, canTopUp, billingEnabled] = await Promise.all([
      workspaceBillingAccountFor(ctx, { workspaceId }),
      buildEntitlements(ctx, viewer.userId),
      mayTopUp(ctx, viewer),
      nativeDeploymentFeatureEnabled(ctx, 'billing'),
    ])
    const now = Date.now()
    const [balance, plan] = account
      ? await Promise.all([
          accountEntitlementsFor(ctx, { billingAccountId: account.billingAccountId }),
          accountPlanFor(ctx, { billingAccountId: account.billingAccountId }),
        ])
      : [null, null]
    const usageTotals = account && plan?.planKind === 'paid'
      ? await usageTotalsFor(ctx, { billingAccountId: account.billingAccountId, periodStart: billingPeriodStartOf(plan, now) })
      : undefined
    return composeWorkspaceBillingSummary({
      workspaceId,
      canManage: canManageWorkspace(viewer.membership.role),
      canTopUp,
      billingEnabled,
      storage: { usedBytes: mine.overlayStorageBytesUsed ?? 0, limitBytes: mine.overlayStorageBytesLimit ?? 0 },
      account,
      balance,
      plan,
      usageTotals,
      now,
    })
  },
})

/**
 * What the composer, model pickers and sidebar meters need to know about the workspace's balance, live: the same
 * view as the subscription route, so a charge, top-up or payment shows without refetching after each turn. With
 * billing off on this deployment, the member's own entitlements (what the server enforces then). Null without access.
 */
export const entitlements = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await viewerFor(ctx, workspaceId)
    if (!viewer) return null
    const mine = await buildEntitlements(ctx, viewer.userId)
    if (!(await nativeDeploymentFeatureEnabled(ctx, 'billing'))) return mine
    const account = await workspaceBillingAccountFor(ctx, { workspaceId })
    if (!account || account.status !== 'active') return unfundedAppSubscription(mine)
    const funded = await accountEntitlementsFor(ctx, { billingAccountId: account.billingAccountId })
    if (!funded) return unfundedAppSubscription(mine)
    return appSubscriptionResponse({
      ...funded,
      overlayStorageBytesUsed: mine.overlayStorageBytesUsed,
      overlayStorageBytesLimit: mine.overlayStorageBytesLimit,
    })
  },
})
