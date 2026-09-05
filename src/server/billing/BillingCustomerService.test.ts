import assert from 'node:assert/strict'
import test from 'node:test'
import { BillingCustomerService, BillingServiceError } from './BillingCustomerService'
import type { BillingEntitlementsRecord, BillingRepository } from './BillingRepository'

const paidEntitlements: BillingEntitlementsRecord = {
  tier: 'pro',
  planKind: 'paid',
  planAmountCents: 2000,
  status: 'active',
  stripeQuantity: 20,
  cancelAtPeriodEnd: false,
  budgetUsedCents: 500,
  budgetTotalCents: 2000,
  budgetRemainingCents: 1500,
  autoTopUpEnabled: true,
  autoTopUpAmountCents: 1000,
  autoTopUpConsentGranted: true,
  creditsUsed: 5,
  creditsTotal: 20,
  dailyUsage: { ask: 1, write: 2, agent: 3 },
  dailyLimits: { ask: 10, write: 20, agent: 30 },
  transcriptionSecondsUsed: 60,
  transcriptionSecondsLimit: 120,
  localTranscriptionEnabled: false,
  overlayStorageBytesUsed: 100,
  overlayStorageBytesLimit: 1000,
  resetAt: 1_700_000_000_000,
  billingPeriodEnd: '2026-06-01T00:00:00.000Z',
  lastSyncedAt: 1_700_000_000_100,
}

function createRepository(overrides: Partial<BillingRepository> = {}): BillingRepository & {
  updatedPreferences: Array<Record<string, unknown>>
} {
  const updatedPreferences: Array<Record<string, unknown>> = []
  return {
    updatedPreferences,
    async listAdministrativeUsage() {
      return []
    },
    async adjustAdministrativeBudget() {
      throw new Error('not implemented in billing customer fixture')
    },
    async getEntitlementsByServer() {
      return paidEntitlements
    },
    async getSubscriptionByUserIdByServer() {
      return {
        planKind: 'paid',
        autoTopUpEnabled: false,
        autoTopUpAmountCents: 1000,
        offSessionConsentAt: 1_700_000_000_000,
      }
    },
    async getSubscriptionByUserId() {
      return null
    },
    async updateBillingPreferences(args) {
      updatedPreferences.push(args)
      return { success: true }
    },
    async upsertSubscription() {
      return null
    },
    async listBudgetTopUpsByServer() {
      return []
    },
    async recordBudgetTopUp() {
      return null
    },
    ...overrides,
  }
}

test('BillingCustomerService.getLandingSubscription preserves response mapping', async () => {
  const service = new BillingCustomerService({ repository: createRepository() })
  const response = await service.getLandingSubscription({ userId: 'user_1' })

  assert.equal(response.tier, 'pro')
  assert.equal(response.planKind, 'paid')
  assert.equal(response.planId, null)
  assert.equal(response.planDisplayName, 'Legacy $20')
  assert.equal(response.isLegacyPlan, true)
  assert.equal(response.status, 'active')
  assert.equal(response.stripeQuantity, 20)
  assert.equal(response.cancelAtPeriodEnd, false)
  assert.equal(response.creditsUsed, 500)
  assert.equal(response.creditsTotal, 2000)
  assert.equal(response.topUpAmountCents, 1000)
  assert.equal(response.allowancePercentUsed, 25)
  assert.equal(response.topUpBalanceCents, 0)
  assert.equal(response.billingPeriodEnd, '2026-06-01T00:00:00.000Z')
})

test('BillingCustomerService.getAppSubscription reads a workspace billing account when provided', async () => {
  const requestedBillingAccountIds: string[] = []
  const repository = createRepository({
    async getBillingAccountEntitlementsByServer({ billingAccountId }) {
      requestedBillingAccountIds.push(billingAccountId)
      return {
        ...paidEntitlements,
        billingAccountId,
        planAmountCents: 800,
        budgetTotalCents: 800,
        budgetRemainingCents: 300,
      }
    },
    async getEntitlementsByServer() {
      throw new Error('personal entitlements must not be read for a workspace payer')
    },
  })
  const service = new BillingCustomerService({ repository })

  const response = await service.getAppSubscription({
    billingAccountId: 'ba_workspace',
    userId: 'member_1',
  })

  assert.deepEqual(requestedBillingAccountIds, ['ba_workspace'])
  assert.equal(response.planKind, 'paid')
  assert.equal(response.planAmountCents, 800)
  assert.equal(response.budgetRemainingCents, 300)
  assert.equal('planId' in response, false)
})

test('BillingCustomerService.updateBillingSettings validates current response shapes', async () => {
  const service = new BillingCustomerService({ repository: createRepository() })

  await assert.rejects(
    () => service.updateBillingSettings({ userId: 'user_1', body: null }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Invalid request body',
  )

  await assert.rejects(
    () => service.updateBillingSettings({ userId: 'user_1', body: { autoTopUpEnabled: 'yes' } }),
    (error) =>
      error instanceof BillingServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Invalid autoTopUpEnabled',
  )
})

test('BillingCustomerService.updateBillingSettings writes validated preference DTO', async () => {
  const repository = createRepository()
  const service = new BillingCustomerService({ repository })

  const response = await service.updateBillingSettings({
    userId: 'user_1',
    body: {
      autoTopUpEnabled: true,
      topUpAmountCents: 1000,
      grantOffSessionConsent: true,
    },
  })

  assert.deepEqual(response, { success: true })
  assert.deepEqual(repository.updatedPreferences[0], {
    userId: 'user_1',
    autoTopUpEnabled: true,
    topUpAmountCents: 1000,
    grantOffSessionConsent: true,
  })
})

test('BillingCustomerService.getEntitlements preserves nested entitlement shape', async () => {
  const service = new BillingCustomerService({ repository: createRepository() })
  const response = await service.getEntitlements({ userId: 'user_1' })

  assert.equal(response.limits.askPerDay, 10)
  assert.equal(response.usage.tokenCostAccrued, 500)
  assert.equal(response.remaining.tokenBudget, 1500)
  assert.equal(response.creditsTotal, 20)
  assert.equal(response.allowancePercentUsed, 25)
  assert.equal(response.topUpBalanceCents, 0)
  assert.equal(response.billingPeriodEnd, 1780272000)
  assert.equal(response.planDisplayName, 'Legacy $20')
})

test('BillingCustomerService exposes named personal plans without changing stored records', async () => {
  const service = new BillingCustomerService({
    repository: createRepository({
      async getEntitlementsByServer() {
        return { ...paidEntitlements, planAmountCents: 2_400 }
      },
    }),
  })

  const response = await service.getLandingSubscription({ userId: 'user_1' })

  assert.equal(response.planId, 'pro')
  assert.equal(response.planDisplayName, 'Pro')
  assert.equal(response.isLegacyPlan, false)
})

test('BillingCustomerService exposes past-due and scheduled-cancellation states', async () => {
  const pastDueService = new BillingCustomerService({
    repository: createRepository({
      async getEntitlementsByServer() {
        return { ...paidEntitlements, status: 'past_due', stripeQuantity: 24 }
      },
    }),
  })
  const cancelingService = new BillingCustomerService({
    repository: createRepository({
      async getEntitlementsByServer() {
        return { ...paidEntitlements, cancelAtPeriodEnd: true, stripeQuantity: 24 }
      },
    }),
  })

  const pastDue = await pastDueService.getEntitlements({ userId: 'user_1' })
  const canceling = await cancelingService.getLandingSubscription({ userId: 'user_1' })

  assert.equal(pastDue.status, 'past_due')
  assert.equal(pastDue.planId, 'pro')
  assert.equal(canceling.cancelAtPeriodEnd, true)
  assert.equal(canceling.planId, 'pro')
})
