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

test('checkout, top-up and portal return to the initiating workspace when another tab changes the active workspace', async () => {
  const checkouts: CheckoutArgs[] = []
  const portalReturns: string[] = []
  const service = fixture({ role: 'owner', provider: provider({
    async createCheckoutSession(args) {
      checkouts.push(args)
      return { url: 'https://stripe.test/checkout' }
    },
    async createCustomerPortalSession(args) {
      portalReturns.push(args.returnUrl ?? '')
      return { url: 'https://stripe.test/portal' }
    },
  }) })
  await service.createSubscriptionCheckout({ actorUserId: 'owner_1', workspaceId: 'workspace_1', planAmountCents: 800, topUpAmountCents: 800 })
  await service.createTopUp({ actorUserId: 'owner_1', workspaceId: 'workspace_1', amountCents: 800 })
  await service.createPortal({ actorUserId: 'owner_1', workspaceId: 'workspace_1' })
  const expected = 'https://overlay.test/app/w/workspace_1/settings?'
  for (const checkout of checkouts) {
    assert.ok(checkout.successUrl?.startsWith(expected))
    assert.ok(checkout.cancelUrl?.startsWith(expected))
    assert.equal(new URL(checkout.successUrl).searchParams.get('workspace_session_id'), '{CHECKOUT_SESSION_ID}')
  }
  assert.ok(portalReturns[0]?.startsWith(expected))
})

test('members may add usage only when the workspace lets them, and never change the plan', async () => {
  const checkouts: Array<Record<string, unknown>> = []
  const recording = provider({
    async createCheckoutSession(input) {
      checkouts.push(input as unknown as Record<string, unknown>)
      return { url: 'https://checkout.test' }
    },
  })
  const allowed = fixture({ role: 'member', usageTopUpBy: 'members', provider: recording })
  assert.deepEqual(
    await allowed.createTopUp({ actorUserId: 'member_1', workspaceId: 'workspace_1', amountCents: 800 }),
    { url: 'https://checkout.test' },
  )
  assert.equal(checkouts[0]?.kind, 'budget_topup')
  assert.equal((await allowed.summary({ actorUserId: 'member_1', workspaceId: 'workspace_1' })).canTopUp, true)
  assert.equal((await allowed.summary({ actorUserId: 'member_1', workspaceId: 'workspace_1' })).canManage, false)
  await assert.rejects(
    allowed.createSubscriptionCheckout({
      actorUserId: 'member_1', workspaceId: 'workspace_1', planAmountCents: 800, topUpAmountCents: 800,
    }),
    (error: unknown) => error instanceof BillingServiceError && error.statusCode === 403,
  )
  const restricted = fixture({ role: 'member', usageTopUpBy: 'admins', provider: recording })
  assert.equal((await restricted.summary({ actorUserId: 'member_1', workspaceId: 'workspace_1' })).canTopUp, false)
  const guest = fixture({ role: 'guest', usageTopUpBy: 'members', provider: recording })
  await assert.rejects(
    guest.createTopUp({ actorUserId: 'guest_1', workspaceId: 'workspace_1', amountCents: 800 }),
    (error: unknown) => error instanceof BillingServiceError && error.statusCode === 403,
  )
  assert.equal(checkouts.length, 1)
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

test('any workspace, including a first one, can be set up for a plan; until then it reads as free', async () => {
  const noWallet = fixture({
    role: 'owner',
    kind: 'personal',
    repository: repository({
      async getWorkspaceBillingAccountByWorkspaceIdByServer() { return null },
      async getEntitlementsByServer() {
        return { overlayStorageBytesUsed: 512, overlayStorageBytesLimit: 10_000_000 } as never
      },
    }),
  })
  const free = await noWallet.summary({ actorUserId: 'owner_1', workspaceId: 'workspace_1' })
  assert.equal(free.initialized, false)
  assert.equal(free.canManage, true)
  assert.equal(free.subscription.planKind, 'free')
  assert.deepEqual(free.storage, { usedBytes: 512, limitBytes: 10_000_000 })

  const paid = await fixture({
    role: 'owner',
    repository: repository({
      async getEntitlementsByServer() {
        return { overlayStorageBytesUsed: 2048, overlayStorageBytesLimit: 50_000_000 } as never
      },
      async getBillingAccountEntitlementsByServer() {
        return {
          billingAccountId: 'ba_workspace',
          tier: 'pro',
          planKind: 'paid',
          planAmountCents: 800,
          budgetUsedCents: 0,
          budgetTotalCents: 800,
          budgetRemainingCents: 800,
          autoTopUpEnabled: false,
          autoTopUpAmountCents: 0,
          autoTopUpConsentGranted: false,
          creditsUsed: 0,
          creditsTotal: 8,
        }
      },
      async getBillingAccountSubscriptionByServer() {
        return { planKind: 'paid', planAmountCents: 800 } as never
      },
      async getBillingAccountUsageTotalsByServer() {
        return { totals: [], truncated: false }
      },
    }),
  }).summary({ actorUserId: 'owner_1', workspaceId: 'workspace_1' })
  assert.deepEqual(paid.storage, { usedBytes: 2048, limitBytes: 50_000_000 })

  const initialized = await fixture({ role: 'owner', kind: 'personal' }).initialize({ actorUserId: 'owner_1', workspaceId: 'workspace_1' })
  assert.equal(initialized.initialized, true)

  await assert.rejects(
    fixture({ role: 'member', kind: 'personal' }).initialize({ actorUserId: 'member_1', workspaceId: 'workspace_1' }),
    (error: unknown) => error instanceof BillingServiceError && error.statusCode === 403,
  )
})

test('workspace verification fails when a paid subscription cannot be persisted', async () => {
  const service = fixture({
    role: 'admin',
    repository: repository({
      async upsertBillingAccountSubscription() {
        throw new Error('billing_period_rollover_has_active_reservations')
      },
    }),
  })
  await assert.rejects(service.verify({
    actorUserId: 'admin_1', workspaceId: 'workspace_1', kind: 'paid_plan', sessionId: 'cs_test_workspace',
  }), /billing_period_rollover_has_active_reservations/)
})

function fixture(args: {
  provider?: BillingProvider
  repository?: BillingRepository
  role: 'owner' | 'admin' | 'member' | 'guest'
  usageTopUpBy?: 'members' | 'admins'
  kind?: 'organization' | 'personal'
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
    workspaces: {
      resolveActiveWorkspace: async () => access(args.role as 'member', args.kind),
      getSharingPolicy: async () => ({ usageTopUpBy: args.usageTopUpBy ?? 'admins' }) as never,
    },
  })
}

function repository(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    async ensureWorkspaceBillingAccount() { return account() },
    async getWorkspaceBillingAccountByWorkspaceIdByServer() { return account() },
    async getBillingAccountEntitlementsByServer() { return null },
    async getBillingAccountSubscriptionByServer() { return null },
    async getEntitlementsByServer() { return null },
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

function access(role: 'owner' | 'admin' | 'member', kind: 'organization' | 'personal' = 'organization'): WorkspaceAccess {
  return {
    workspace: { id: 'workspace_1', kind, status: 'active' },
    membership: { role, status: 'active' },
    principal: { id: 'principal_1', type: 'human' },
  } as WorkspaceAccess
}
