import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

// Plans belong to workspaces (docs/plans/WORKSPACE_PRICING_PLAN.md, phase 6). These are the personal plan and credit
// fields left on people's own rows; once every row is stripped they are removed from the schema, and this module goes.
const PERSONAL_PLAN_FIELDS = [
  'stripeCustomerId', 'stripeSubscriptionId', 'stripePriceId', 'stripeQuantity',
  'tier', 'planKind', 'planVersion', 'planAmountCents', 'institutionalGrantCents', 'markupBasisPoints', 'status',
  'currentPeriodStart', 'currentPeriodEnd',
  'creditsUsed', 'allowanceUsedCents', 'topUpPurchasedCents', 'topUpBalanceCents',
  'autoTopUpEnabled', 'autoTopUpAmountCents', 'offSessionConsentAt', 'autoRefillEnabled',
] as const

/** Strips the personal plan fields from one page of `subscriptions` rows. Run until `isDone`. */
export const stripPersonalPlanFieldsInternal = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ stripped: v.number(), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('subscriptions').paginate({ cursor, numItems: 200 })
    let stripped = 0
    for (const row of page.page) {
      const present = PERSONAL_PLAN_FIELDS.filter((field) => row[field] !== undefined)
      if (present.length === 0) continue
      await ctx.db.patch(row._id, Object.fromEntries(present.map((field) => [field, undefined])))
      stripped += 1
    }
    return { stripped, continueCursor: page.continueCursor, isDone: page.isDone }
  },
})
