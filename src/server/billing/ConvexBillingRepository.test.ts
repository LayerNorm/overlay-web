import assert from 'node:assert/strict'
import test from 'node:test'
import { ConvexBillingRepository } from './ConvexBillingRepository'

test('subscription writes propagate backend failures instead of reporting success', async t => {
  const previousSecret = process.env.INTERNAL_API_SECRET
  const previousUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  process.env.INTERNAL_API_SECRET = 'billing-repository-test-secret'
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://fixture.convex.cloud'
  t.after(() => {
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET
    else process.env.INTERNAL_API_SECRET = previousSecret
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL
    else process.env.NEXT_PUBLIC_CONVEX_URL = previousUrl
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    status: 'error', errorMessage: 'billing_period_rollover_has_active_reservations',
  })))
  await assert.rejects(new ConvexBillingRepository().upsertBillingAccountSubscription({
    billingAccountId: 'ba_workspace', planKind: 'paid', planAmountCents: 800,
  }), /billing_period_rollover_has_active_reservations/)
})
