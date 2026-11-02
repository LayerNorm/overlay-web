import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'

/** Operator-only inventory; old ledger and subscription records are never deleted. */
export const candidatesInternal = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('billingAccountSubscriptions').order('asc').paginate({ cursor, numItems: 25 })
    const candidates = []
    for (const subscription of page.page) {
      if (subscription.planKind !== 'paid' || subscription.status !== 'active') continue
      if (subscription.paidPeriodStart === subscription.currentPeriodStart && subscription.paidPeriodEnd === subscription.currentPeriodEnd
        && subscription.paidPeriodEnd !== undefined && subscription.paidPeriodEnd > Date.now()) continue
      const account = await ctx.db.query('billingAccounts').withIndex('by_billingAccountId', q => q.eq('billingAccountId', subscription.billingAccountId)).unique()
      if (account?.scope === 'workspace' && account.status === 'active') candidates.push(subscription)
    }
    return { candidates, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})
