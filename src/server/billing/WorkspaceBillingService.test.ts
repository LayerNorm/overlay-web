import assert from 'node:assert/strict'
import test from 'node:test'
import type { BillingProvider, CheckoutArgs, CheckoutSessionVerificationArgs } from '@overlay/app-core'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { BillingRepository } from './BillingRepository'
import type { UsageRepository } from '@/server/usage/UsageRepository'
import { BillingServiceError } from './BillingCustomerService'
import { WorkspaceBillingService } from './WorkspaceBillingService'

test('workspace billing checkout binds payment to the account while retaining the admin as actor', async () => {
  const calls: CheckoutArgs[] = []
  const service = fixture({
    role: 'owner',
    provider: provider({
      async createCheckoutSession(args) {
        calls.push(args)
        return { url: 'https://stripe.test/checkout' }
      },
    }),
  })

  assert.deepEqual(await service.createSubscriptionCheckout({
    actorUserId: 'admin_1',
    workspaceId: 'workspace_1',
    planAmountCents: 800,
    topUpAmountCents: 800,
  }), { url: 'https://stripe.test/checkout' })
  assert.equal(calls[0]?.userId, 'admin_1')
  assert.equal(calls[0]?.billingAccountId, 'ba_workspace')
  assert.equal(calls[0]?.workspaceId, 'workspace_1')
})

test('workspace billing rejects members before any Stripe operation', async () => {
  let providerCalls = 0
  const service = fixture({
    role: 'member',
    provider: provider({
      async createCheckoutSession() {
        providerCalls += 1
        return { url: 'unexpected' }
      },
    }),
  })
  await assert.rejects(
    service.createTopUp({ actorUserId: 'member_1', workspaceId: 'workspace_1', amountCents: 800 }),
    (error: unknown) => error instanceof BillingServiceError && error.statusCode === 403,
  )
  assert.equal(providerCalls, 0)
})

test('workspace verification writes only the account-keyed subscription', async () => {
  const accountUpserts: Array<Record<string, unknown>> = []
  const service = fixture({
    role: 'admin',
    repository: repository({
      async upsertBillingAccountSubscription(args) {
        accountUpserts.push(args)
        return null
      },
      async upsertSubscription() {
        throw new Error('personal subscription path must not run')
      },
    }),
  })
  const result = await service.verify({
    actorUserId: 'admin_1',
    workspaceId: 'workspace_1',
    kind: 'paid_plan',
    sessionId: 'cs_test_workspace',
  })
  assert.deepEqual(result, { success: true, amountCents: 800, kind: 'paid_plan' })
  assert.equal(accountUpserts[0]?.billingAccountId, 'ba_workspace')
  assert.equal(accountUpserts[0]?.stripeSubscriptionId, 'sub_workspace')
})

function fixture(args: {
  provider?: BillingProvider
  repository?: BillingRepository
  role: 'owner' | 'admin' | 'member'
}) {
  return new WorkspaceBillingService({
    baseUrl: () => 'https://overlay.test',
    billingProvider: () => args.provider ?? provider(),
    repository: args.repository ?? repository(),
    rollout: () => ({ checkoutEnabled: true, eligible: true, stage: 'general' }),
    usage: {
      async getBillingAccountOperationalReport() {
        return {
          actualProviderCostCents: 0,
          costCoveragePercent: 100,
          meteredReservations: 0,
          oldestReconciliationAgeMs: 0,
          periodEnd: 2,
          periodStart: 1,
          realizedMarginPercent: null,
          retailCostCents: 0,
          retailCredits: 0,
          staleReconciliationReservations: 0,
          reconciliationReservations: 0,
        }
      },
    } as UsageRepository,
    workspaces: { resolveActiveWorkspace: async () => access(args.role) },
  })
}

function repository(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    async ensureWorkspaceBillingAccount() { return account() },
    async getWorkspaceBillingAccountByWorkspaceIdByServer() { return account() },
    async getBillingAccountEntitlementsByServer() { return null },
    async getBillingAccountSubscriptionByServer() { return null },
    async upsertBillingAccountSubscription() { return null },
    async recordBillingAccountTopUp() { return null },
    ...overrides,
  } as BillingRepository
}

function provider(overrides: Partial<BillingProvider> = {}): BillingProvider {
  return {
    async getEntitlements() { throw new Error('unused') },
    async createCheckoutSession() { return { url: 'https://stripe.test/checkout' } },
    async createPortalSession() { return { url: 'https://stripe.test/portal' } },
    async createCustomerPortalSession() { return { url: 'https://stripe.test/portal' } },
    async verifyCheckoutSession(args: CheckoutSessionVerificationArgs) {
      assert.equal(args.billingAccountId, 'ba_workspace')
      return {
        providerSessionId: 'cs_test_workspace',
        providerCustomerId: 'cus_workspace',
        providerSubscriptionId: 'sub_workspace',
        providerPriceId: 'price_paid',
        providerQuantity: 8,
        planAmountCents: 800,
        status: 'active',
      }
    },
    async recordUsage() {},
    ...overrides,
  }
}

function account() {
  return {
    billingAccountId: 'ba_workspace',
    workspaceId: 'workspace_1',
    scope: 'workspace' as const,
    status: 'active' as const,
    pricingVersion: 'markup_25_v1' as const,
    markupBasisPoints: 2_500,
    primaryBillingContactUserId: 'admin_1',
    createdAt: 1,
    updatedAt: 1,
  }
}

function access(role: 'owner' | 'admin' | 'member'): WorkspaceAccess {
  return {
    workspace: { id: 'workspace_1', kind: 'organization', status: 'active' },
    membership: { role, status: 'active' },
    principal: { id: 'principal_1', type: 'human' },
  } as WorkspaceAccess
}
