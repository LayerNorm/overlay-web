import assert from 'node:assert/strict'
import test from 'node:test'
import type { BillingRepository, BillingSubscriptionRecord } from './BillingRepository'
import { maybeAutoTopUpWorkspaceBudget } from './stripe-billing'

const plan: BillingSubscriptionRecord = {
  billingAccountId: 'account',
  planKind: 'paid',
  status: 'active',
  stripeCustomerId: 'cus_test',
  autoTopUpEnabled: true,
  autoTopUpAmountCents: 800,
  autoTopUpMonthlyLimitCents: 1_600,
  autoTopUpSpentThisPeriodCents: 0,
  offSessionConsentAt: 123,
  currentPeriodStart: 100,
}

function fakeRepository(options: {
  claim: BillingRepository['claimAutoTopUpIntentByServer']
  records?: unknown[]
}): BillingRepository {
  const records = options.records ?? []
  return {
    getBillingAccountSubscriptionByServer: async () => plan,
    claimAutoTopUpIntentByServer: options.claim,
    recordBillingAccountTopUp: async (record) => { records.push(record); return { granted: true } },
  } as unknown as BillingRepository
}

const params = {
  actorUserId: 'owner',
  billingAccountId: 'account',
  minimumRequiredCents: 250,
  workspaceId: 'workspace',
}

test('a lost Stripe response reuses the same claimed idempotency identity', async () => {
  let claimArgs: Parameters<BillingRepository['claimAutoTopUpIntentByServer']>[0] | undefined
  let createCount = 0
  const keys: string[] = []
  const records: unknown[] = []
  const repository = fakeRepository({
    records,
    claim: async (args) => {
      claimArgs ??= args
      assert.deepEqual(args, claimArgs)
      return { status: 'claimed', idempotencyKey: args.idempotencyKey }
    },
  })
  const deps = {
    resolvePaymentMethodId: async () => 'pm_test',
    createPaymentIntent: async (_input: unknown, options: { idempotencyKey: string }) => {
      createCount += 1
      keys.push(options.idempotencyKey)
      if (createCount === 1) throw new Error('connection reset')
      return { id: 'pi_test', status: 'succeeded' }
    },
  }
  const first = await maybeAutoTopUpWorkspaceBudget(params, repository, deps)
  const second = await maybeAutoTopUpWorkspaceBudget(params, repository, deps)

  assert.equal(first.applied, false)
  assert.equal(first.reason, 'pending')
  assert.equal(second.applied, true)
  assert.equal(createCount, 2)
  assert.equal(keys[0], keys[1])
  assert.equal(records.length, 1)
  assert.deepEqual(records[0], expectTopUpRecord('pi_test', claimArgs?.intentKey))
})

test('concurrent resource requests claim one top-up before Stripe', async () => {
  let claimCreated = false
  let createCount = 0
  const repository = fakeRepository({
    claim: async (args) => {
      if (claimCreated) return { status: 'pending' }
      claimCreated = true
      return { status: 'claimed', idempotencyKey: args.idempotencyKey }
    },
  })
  const deps = {
    resolvePaymentMethodId: async () => 'pm_test',
    createPaymentIntent: async () => {
      createCount += 1
      await Promise.resolve()
      return { id: 'pi_once', status: 'succeeded' }
    },
  }

  const results = await Promise.all([
    maybeAutoTopUpWorkspaceBudget(params, repository, deps),
    maybeAutoTopUpWorkspaceBudget(params, repository, deps),
  ])
  assert.equal(createCount, 1)
  assert.equal(results.filter((result) => result.applied).length, 1)
})

test('an unrecorded pending claim retries the same Stripe parameters and original metadata', async () => {
  const intent = {
    intentKey: 'original-intent',
    idempotencyKey: 'workspace-auto-topup-original-intent',
    actorUserId: 'original-owner',
    workspaceId: 'workspace',
    amountCents: 800,
    currentPeriodStart: 100,
    consentAt: 123,
    paymentMethodId: 'pm_original',
    customerId: 'cus_test',
    createdAt: Date.now(),
  }
  const records: unknown[] = []
  const repository = {
    getBillingAccountSubscriptionByServer: async () => ({ ...plan, autoTopUpPending: true }),
    getPendingAutoTopUpIntentByServer: async () => intent,
    claimAutoTopUpIntentByServer: async () => { throw new Error('must not create a new claim') },
    recordBillingAccountTopUp: async (record: unknown) => { records.push(record); return { granted: true } },
  } as unknown as BillingRepository
  const calls: unknown[] = []
  const result = await maybeAutoTopUpWorkspaceBudget({ ...params, actorUserId: 'new-trigger-user' }, repository, {
    resolvePaymentMethodId: async () => 'pm_original',
    createPaymentIntent: async (input: unknown, options: unknown) => {
      calls.push({ input, options })
      return { id: 'pi_retried', status: 'succeeded' }
    },
  })
  assert.equal(result.applied, true)
  assert.deepEqual(calls, [{
    input: {
      amount: 800, currency: 'usd', customer: 'cus_test', payment_method: 'pm_original',
      off_session: true, confirm: true,
      metadata: {
        kind: 'budget_topup', source: 'auto', billingAccountId: 'account',
        intentKey: 'original-intent', workspaceId: 'workspace', userId: 'original-owner',
      },
    },
    options: { idempotencyKey: 'workspace-auto-topup-original-intent' },
  }])
  assert.deepEqual(records, [{
    actorUserId: 'original-owner', billingAccountId: 'account', workspaceId: 'workspace', amountCents: 800, source: 'auto',
    status: 'succeeded', stripeCustomerId: 'cus_test', stripePaymentIntentId: 'pi_retried',
    autoTopUpIntentKey: 'original-intent',
  }])
})

test('changed consent or payment method keeps an unrecorded claim pending without creating an intent', async () => {
  const pending = {
    intentKey: 'original-intent', idempotencyKey: 'workspace-auto-topup-original-intent',
    actorUserId: 'owner', workspaceId: 'workspace', amountCents: 800, currentPeriodStart: 100,
    consentAt: 123, paymentMethodId: 'pm_original', customerId: 'cus_test', createdAt: Date.now(),
  }
  for (const changed of [
    { subscription: { offSessionConsentAt: 124 }, paymentMethod: 'pm_original' },
    { subscription: {}, paymentMethod: 'pm_changed' },
  ]) {
    let creates = 0
    const repository = {
      getBillingAccountSubscriptionByServer: async () => ({ ...plan, ...changed.subscription, autoTopUpPending: true }),
      getPendingAutoTopUpIntentByServer: async () => pending,
      claimAutoTopUpIntentByServer: async () => { throw new Error('must not create a new claim') },
      recordBillingAccountTopUp: async () => { throw new Error('must not settle an unauthorized retry') },
    } as unknown as BillingRepository
    const result = await maybeAutoTopUpWorkspaceBudget(params, repository, {
      resolvePaymentMethodId: async () => changed.paymentMethod,
      createPaymentIntent: async () => { creates += 1; return { id: 'unexpected', status: 'succeeded' } },
    })
    assert.equal(result.reason, 'authorization_changed')
    assert.equal(creates, 0)
  }
})

test('an ambiguous claim older than 24 hours remains pending and is never retried as a new charge', async () => {
  const repository = {
    getBillingAccountSubscriptionByServer: async () => ({ ...plan, autoTopUpPending: true }),
    getPendingAutoTopUpIntentByServer: async () => ({
      intentKey: 'old-intent', idempotencyKey: 'old-key', actorUserId: 'owner', workspaceId: 'workspace',
      amountCents: 800, currentPeriodStart: 100, consentAt: 123, paymentMethodId: 'pm_test',
      customerId: 'cus_test', createdAt: Date.now() - 24 * 60 * 60 * 1_000,
    }),
  } as unknown as BillingRepository
  let creates = 0
  const result = await maybeAutoTopUpWorkspaceBudget(params, repository, {
    resolvePaymentMethodId: async () => 'pm_test',
    createPaymentIntent: async () => { creates += 1; return { id: 'unexpected', status: 'succeeded' } },
  })
  assert.deepEqual(result, { applied: false, reason: 'already_pending' })
  assert.equal(creates, 0)
})

function expectTopUpRecord(stripePaymentIntentId: string, autoTopUpIntentKey?: string) {
  return {
    actorUserId: 'owner',
    billingAccountId: 'account',
    workspaceId: 'workspace',
    amountCents: 800,
    source: 'auto',
    status: 'succeeded',
    stripeCustomerId: 'cus_test',
    stripePaymentIntentId,
    autoTopUpIntentKey,
  }
}
