import 'server-only'

import {
  canManageWorkspace,
  type WorkspaceBillingAutoTopUpInput,
  type WorkspaceBillingSummaryResponse,
} from '@overlay/workspace-contracts'
import type { BillingProvider } from '@overlay/app-core'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import { centsToBillingCredits } from '@/shared/billing/billing-account'
import {
  clampPaidPlanAmountCents,
  clampTopUpAmountCents,
  isValidTopUpAmount,
  quantityToPlanAmountCents,
} from '@/shared/billing/billing-pricing'
import { autoTopUpFitsLimit, validateAutoTopUpInput } from '@/shared/billing/auto-top-up'
import { workspaceUsageSummary } from './workspace-usage-summary'
import type { BillingRepository, BillingSubscriptionRecord } from './BillingRepository'
import type { UsageRepository } from '@/server/usage/UsageRepository'
import { BillingServiceError } from './BillingCustomerService'

type Deps = {
  baseUrl: () => string
  billingProvider: () => BillingProvider
  repository: BillingRepository
  usage: UsageRepository
  workspaces: Pick<WorkspaceService, 'resolveActiveWorkspace' | 'getSharingPolicy'>
}

export class WorkspaceBillingService {
  constructor(private readonly deps: Deps) {}

  async initialize(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.requireManager(args)
    await this.deps.repository.ensureWorkspaceBillingAccount({
      primaryBillingContactUserId: args.actorUserId,
      workspaceId: access.workspace.id,
    })
    return await this.summary(args)
  }

  async summary(args: { actorUserId: string; workspaceId: string }): Promise<WorkspaceBillingSummaryResponse> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const [account, actorEntitlements] = await Promise.all([
      this.deps.repository.getWorkspaceBillingAccountByWorkspaceIdByServer({
        workspaceId: access.workspace.id,
      }),
      this.deps.repository.getEntitlementsByServer({ userId: args.actorUserId }),
    ])
    const canManage = canManageWorkspace(access.membership.role)
    const canTopUp = await this.memberMayTopUp(access, args.actorUserId)
    const storage = {
      usedBytes: actorEntitlements?.overlayStorageBytesUsed ?? 0,
      limitBytes: actorEntitlements?.overlayStorageBytesLimit ?? 0,
    }
    if (!account) return emptySummary(access.workspace.id, canManage, canTopUp, storage)
    const [entitlements, subscription] = await Promise.all([
      this.deps.repository.getBillingAccountEntitlementsByServer({ billingAccountId: account.billingAccountId }),
      this.deps.repository.getBillingAccountSubscriptionByServer({ billingAccountId: account.billingAccountId }),
    ])
    const totalCents = entitlements?.budgetTotalCents ?? 0
    const usedCents = entitlements?.budgetUsedCents ?? 0
    const remainingCents = entitlements?.budgetRemainingCents ?? 0
    return {
      workspaceId: access.workspace.id,
      canManage,
      canTopUp,
      initialized: true,
      pricingVersion: account.pricingVersion,
      credits: {
        total: centsToBillingCredits(totalCents),
        used: centsToBillingCredits(usedCents),
        remaining: centsToBillingCredits(remainingCents),
        allowancePercentUsed: entitlements?.allowancePercentUsed ?? 0,
        topUpBalance: centsToBillingCredits(entitlements?.topUpBalanceCents ?? 0),
      },
      subscription: {
        planKind: subscription?.planKind ?? 'free',
        planAmountCents: subscription?.planAmountCents ?? 0,
        ...(subscription?.status ? { status: subscription.status } : {}),
        ...(subscription?.currentPeriodEnd ? { currentPeriodEnd: subscription.currentPeriodEnd } : {}),
      },
      storage,
      ...(subscription?.planKind === 'paid'
        ? {
            autoTopUp: autoTopUpSummary(subscription),
            usage: workspaceUsageSummary(
              await this.deps.repository.getBillingAccountUsageTotalsByServer({
                billingAccountId: account.billingAccountId,
                periodStart: periodStartOf(subscription),
              }),
              subscription,
              periodStartOf(subscription),
              usedCents,
            ),
          }
        : {}),
    }
  }

  /**
   * Owners and admins choose what happens at $0: a hard stop, or automatic top-ups up to a monthly limit. Turning
   * top-ups on records consent to charge the workspace's saved card off-session.
   */
  async updateAutoTopUp(args: { actorUserId: string; workspaceId: string } & WorkspaceBillingAutoTopUpInput) {
    const { account } = await this.requireAccountManager(args)
    const plan = await this.deps.repository.getBillingAccountSubscriptionByServer({ billingAccountId: account.billingAccountId })
    if (plan?.planKind !== 'paid') this.fail('Add a plan before turning on automatic top-ups.', 409)
    const input = {
      enabled: Boolean(args.enabled),
      amountCents: Math.round(Number(args.amountCents)),
      monthlyLimitCents: Math.round(Number(args.monthlyLimitCents)),
    }
    const valid = validateAutoTopUpInput(input)
    if (!valid.ok) this.fail(valid.error, 400)
    await this.deps.repository.upsertBillingAccountSubscription({
      billingAccountId: account.billingAccountId,
      autoTopUpEnabled: input.enabled,
      ...(input.enabled
        ? {
            autoTopUpAmountCents: input.amountCents,
            autoTopUpMonthlyLimitCents: input.monthlyLimitCents,
            offSessionConsentAt: Date.now(),
          }
        : {}),
    })
    return await this.summary(args)
  }

  async createSubscriptionCheckout(args: {
    actorEmail?: string
    actorUserId: string
    autoTopUpEnabled?: boolean
    planAmountCents: number
    topUpAmountCents: number
    workspaceId: string
    legalMetadata?: Record<string, string>
  }): Promise<{ url: string | null }> {
    const { account, workspaceId } = await this.requireAccountManager(args)
    if (!Number.isSafeInteger(args.planAmountCents)
      || clampPaidPlanAmountCents(args.planAmountCents) !== args.planAmountCents) {
      this.fail('Unsupported subscription amount.', 400)
    }
    if (!isValidTopUpAmount(args.topUpAmountCents)) this.fail('Unsupported top-up amount.', 400)
    const result = await this.deps.billingProvider().createCheckoutSession({
      userId: args.actorUserId,
      billingAccountId: account.billingAccountId,
      workspaceId,
      email: args.actorEmail,
      kind: 'paid_plan',
      planAmountCents: args.planAmountCents,
      topUpAmountCents: args.topUpAmountCents,
      autoTopUpEnabled: Boolean(args.autoTopUpEnabled),
      metadata: args.legalMetadata,
      successUrl: `${this.deps.baseUrl()}/app/settings?section=workspace&workspace_tab=billing&workspace_billing_success=true&workspace_session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${this.deps.baseUrl()}/app/settings?section=workspace&workspace_tab=billing&workspace_billing_canceled=true`,
    })
    return { url: result.url }
  }

  async createTopUp(args: {
    actorEmail?: string
    actorUserId: string
    amountCents: number
    workspaceId: string
    legalMetadata?: Record<string, string>
  }): Promise<{ url: string | null }> {
    const { account, workspaceId } = await this.requireTopUpAccount(args)
    if (!isValidTopUpAmount(args.amountCents)) this.fail('Unsupported top-up amount.', 400)
    const result = await this.deps.billingProvider().createCheckoutSession({
      userId: args.actorUserId,
      billingAccountId: account.billingAccountId,
      workspaceId,
      email: args.actorEmail,
      kind: 'budget_topup',
      topUpAmountCents: clampTopUpAmountCents(args.amountCents),
      metadata: args.legalMetadata,
      successUrl: `${this.deps.baseUrl()}/app/settings?section=workspace&workspace_tab=billing&workspace_topup_success=true&workspace_session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${this.deps.baseUrl()}/app/settings?section=workspace&workspace_tab=billing&workspace_topup_canceled=true`,
    })
    return { url: result.url }
  }

  async createPortal(args: {
    actorEmail?: string
    actorUserId: string
    workspaceId: string
  }): Promise<{ url: string | null }> {
    const { account, workspaceId } = await this.requireAccountManager(args)
    const provider = this.deps.billingProvider()
    if (!provider.createCustomerPortalSession) this.fail('Billing portal is unavailable.', 501)
    const result = await provider.createCustomerPortalSession({
      userId: args.actorUserId,
      billingAccountId: account.billingAccountId,
      workspaceId,
      email: args.actorEmail,
      returnUrl: `${this.deps.baseUrl()}/app/settings?section=workspace&workspace_tab=billing`,
    })
    return { url: result.url }
  }

  async verify(args: {
    actorUserId: string
    kind: 'paid_plan' | 'budget_topup'
    sessionId: string
    workspaceId: string
  }): Promise<{ success: true; amountCents: number; kind: 'paid_plan' | 'budget_topup' }> {
    // Whoever may start a top-up may confirm it; a plan change stays with owners and admins.
    const { account, workspaceId } = args.kind === 'budget_topup'
      ? await this.requireTopUpAccount(args)
      : await this.requireAccountManager(args)
    const provider = this.deps.billingProvider()
    if (!provider.verifyCheckoutSession) this.fail('Checkout verification is unavailable.', 501)
    const verification = await provider.verifyCheckoutSession({
      sessionId: args.sessionId,
      userId: args.actorUserId,
      billingAccountId: account.billingAccountId,
      workspaceId,
      kind: args.kind,
    })
    if (args.kind === 'paid_plan') {
      if (!verification.providerSubscriptionId || !verification.providerPriceId) {
        this.fail('Subscription verification failed.', 400)
      }
      const quantity = verification.providerQuantity ?? 1
      const amountCents = verification.planAmountCents ?? quantityToPlanAmountCents(quantity)
      await this.deps.repository.upsertBillingAccountSubscription({
        billingAccountId: account.billingAccountId,
        provider: 'stripe',
        stripeCustomerId: verification.providerCustomerId,
        stripeSubscriptionId: verification.providerSubscriptionId,
        stripePriceId: verification.providerPriceId,
        stripeQuantity: quantity,
        planKind: 'paid',
        planAmountCents: amountCents,
        autoTopUpEnabled: Boolean(verification.autoTopUpEnabled),
        autoTopUpAmountCents: verification.topUpAmountCents ?? 0,
        offSessionConsentAt: verification.offSessionConsentAt,
        status: verification.status,
        currentPeriodStart: verification.currentPeriodStart,
        currentPeriodEnd: verification.currentPeriodEnd,
      })
      return { success: true, amountCents, kind: args.kind }
    }
    const amountCents = verification.amountTotalCents ?? verification.topUpAmountCents
    if (!amountCents) this.fail('Top-up verification failed.', 400)
    await this.deps.repository.recordBillingAccountTopUp({
      actorUserId: args.actorUserId,
      billingAccountId: account.billingAccountId,
      amountCents,
      source: 'manual',
      status: 'succeeded',
      stripeCustomerId: verification.providerCustomerId,
      stripeCheckoutSessionId: verification.providerSessionId,
      stripePaymentIntentId: verification.paymentIntentId,
    })
    return { success: true, amountCents, kind: args.kind }
  }

  private async requireManager(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (!canManageWorkspace(access.membership.role)) {
      this.fail('Workspace billing can only be managed by owners and admins.', 403)
    }
    return access
  }

  private async requireAccountManager(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.requireManager(args)
    const account = await this.deps.repository.getWorkspaceBillingAccountByWorkspaceIdByServer({
      workspaceId: access.workspace.id,
    })
    if (!account) this.fail('Workspace wallet is not initialized.', 404)
    if (account.status !== 'active') this.fail('Workspace billing account is inactive.', 409)
    return { account, workspaceId: access.workspace.id }
  }

  /** Owners and admins may always add usage; members only when the workspace's `usageTopUpBy` setting says so. */
  private async memberMayTopUp(access: Awaited<ReturnType<Deps['workspaces']['resolveActiveWorkspace']>>, actorUserId: string): Promise<boolean> {
    if (canManageWorkspace(access.membership.role)) return true
    if (access.membership.role !== 'member') return false
    const policy = await this.deps.workspaces.getSharingPolicy({ actorUserId, workspaceId: access.workspace.id })
    return policy.usageTopUpBy === 'members'
  }

  private async requireTopUpAccount(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (!(await this.memberMayTopUp(access, args.actorUserId))) {
      this.fail('Adding usage to this workspace is limited to its owners and admins.', 403)
    }
    const account = await this.deps.repository.getWorkspaceBillingAccountByWorkspaceIdByServer({
      workspaceId: access.workspace.id,
    })
    if (!account) this.fail('Workspace wallet is not initialized.', 404)
    if (account.status !== 'active') this.fail('Workspace billing account is inactive.', 409)
    return { account, workspaceId: access.workspace.id }
  }



  private fail(message: string, statusCode: number): never {
    throw new BillingServiceError({ error: message }, statusCode)
  }
}

/** The current billing period, or the last 30 days when the plan has no period yet. */
function periodStartOf(plan: BillingSubscriptionRecord): number {
  return plan.currentPeriodStart ?? Date.now() - 30 * 24 * 60 * 60 * 1000
}

function autoTopUpSummary(plan: BillingSubscriptionRecord): NonNullable<WorkspaceBillingSummaryResponse['autoTopUp']> {
  const enabled = Boolean(plan.autoTopUpEnabled)
  const amountCents = plan.autoTopUpAmountCents ?? 0
  const spentThisPeriodCents = plan.autoTopUpSpentThisPeriodCents ?? 0
  const monthlyLimitCents = plan.autoTopUpMonthlyLimitCents ?? null
  return {
    enabled,
    amountCents,
    monthlyLimitCents,
    spentThisPeriodCents,
    limitReached: enabled && !autoTopUpFitsLimit({ monthlyLimitCents: monthlyLimitCents ?? undefined, spentThisPeriodCents }, amountCents),
  }
}

function emptySummary(
  workspaceId: string,
  canManage: boolean,
  canTopUp: boolean,
  storage: { usedBytes: number; limitBytes: number },
): WorkspaceBillingSummaryResponse {
  return {
    workspaceId,
    canManage,
    canTopUp,
    initialized: false,
    pricingVersion: 'markup_25_v1',
    credits: {
      total: 0,
      used: 0,
      remaining: 0,
      allowancePercentUsed: 0,
      topUpBalance: 0,
    },
    subscription: { planKind: 'free', planAmountCents: 0 },
    storage,
  }
}
