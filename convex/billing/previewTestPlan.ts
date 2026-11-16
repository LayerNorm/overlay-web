import { ConvexError, v } from 'convex/values'
import { mutation } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { requirePreviewDeployment } from '../lib/preview'
import { ensureEmptyBalance, uniqueWorkspaceAccount } from './accountModel'

/** Synthetic allowance a preview test plan includes: five dollars, never replenished by granting again. */
const PREVIEW_TEST_ALLOWANCE_MICROS = 5_000_000
const PERIOD_MS = 30 * 24 * 60 * 60_000

/**
 * Makes a workspace paid on a PR preview, so QA can run agents without a card (internal/develop/workspace-billing.md).
 * Uses the same `preview-fixture` subscription the preview seed writes. Refuses on every deployment that is not a PR
 * preview; the web route checks the caller manages the workspace.
 */
export const grantByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  returns: v.object({ granted: v.boolean() }),
  handler: async (ctx, { serverSecret, workspaceId }) => {
    requireServerSecret(serverSecret)
    requirePreviewDeployment()
    const account = await uniqueWorkspaceAccount(ctx, workspaceId)
    if (!account) throw new ConvexError('WORKSPACE_WALLET_MISSING')
    const now = Date.now()
    const subscription = await ctx.db.query('billingAccountSubscriptions')
      .withIndex('by_billingAccountId', q => q.eq('billingAccountId', account.billingAccountId)).unique()
    if (subscription?.planKind === 'paid' && subscription.status === 'active') return { granted: false }
    const fields = {
      provider: 'preview-fixture', planKind: 'paid' as const, planVersion: 'variable_v2' as const, planAmountCents: 100,
      markupBasisPoints: account.markupBasisPoints, status: 'active' as const, autoTopUpEnabled: false, autoTopUpAmountCents: 0,
      currentPeriodStart: now, currentPeriodEnd: now + PERIOD_MS,
      paidInvoiceId: `preview-fixture:${workspaceId}`, paidPeriodStart: now, paidPeriodEnd: now + PERIOD_MS,
      updatedAt: now,
    }
    if (subscription) await ctx.db.patch(subscription._id, fields)
    else await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: account.billingAccountId, ...fields, createdAt: now })
    const balance = await ensureEmptyBalance(ctx, account.billingAccountId)
    if (balance.includedMicros < PREVIEW_TEST_ALLOWANCE_MICROS) {
      await ctx.db.patch(balance._id, { includedMicros: PREVIEW_TEST_ALLOWANCE_MICROS, version: balance.version + 1, updatedAt: now })
    }
    return { granted: true }
  },
})
