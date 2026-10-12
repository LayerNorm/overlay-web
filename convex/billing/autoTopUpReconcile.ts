'use node'

import Stripe from 'stripe'
import { v } from 'convex/values'
import { internalAction } from '../_generated/server'
import { internal } from '../_generated/api'

/** A top-up still waiting on the customer (3-D Secure, bank) this long is given up on, falling back to the hard stop. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Backstop for the Stripe webhook: asks Stripe about automatic workspace top-ups that are still pending and settles
 * them (credit on success, failed or canceled otherwise). Runs every few minutes.
 */
export const reconcilePendingAutoTopUps = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), granted: v.number(), closed: v.number() }),
  handler: async (ctx): Promise<{ checked: number; granted: number; closed: number }> => {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) return { checked: 0, granted: 0, closed: 0 }
    const pending: Array<{ stripePaymentIntentId: string; createdAt: number }> = await ctx.runQuery(internal.billing.autoTopUpSettlement.listPendingAutoTopUpsInternal, {
      olderThanMs: 60_000,
      limit: 25,
    })
    const stripe = new Stripe(key)
    let granted = 0
    let closed = 0
    for (const row of pending) {
      // Sequential on purpose: a handful of rows, and each settlement touches the same balance.
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const intent = await stripe.paymentIntents.retrieve(row.stripePaymentIntentId).catch((_error) => null)
      const outcome = settlementFor(intent?.status, Date.now() - row.createdAt)
      if (!outcome) continue
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const result: { settled: boolean; granted: boolean } = await ctx.runMutation(internal.billing.autoTopUpSettlement.settlePendingTopUpInternal, {
        stripePaymentIntentId: row.stripePaymentIntentId,
        outcome,
        ...(outcome === 'succeeded' ? {} : { errorMessage: `stripe_status:${intent?.status ?? 'unknown'}` }),
      })
      if (result.granted) granted += 1
      else if (result.settled) closed += 1
    }
    return { checked: pending.length, granted, closed }
  },
})

function settlementFor(status: string | undefined, ageMs: number): 'succeeded' | 'failed' | 'canceled' | null {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'canceled') return 'canceled'
  if (status === 'requires_payment_method') return 'failed'
  // requires_action / processing / requires_confirmation: still in progress, unless it has waited too long.
  return ageMs > GIVE_UP_AFTER_MS ? 'failed' : null
}
