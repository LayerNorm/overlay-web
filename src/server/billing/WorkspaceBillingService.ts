import 'server-only'

import { canManageWorkspace, type WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import type { BillingProvider } from '@overlay/app-core'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import { centsToBillingCredits } from '@/shared/billing/billing-account'
import {
  clampPaidPlanAmountCents,
  clampTopUpAmountCents,
  isValidTopUpAmount,
  quantityToPlanAmountCents,
} from '@/shared/billing/billing-pricing'
import type { BillingRepository } from './BillingRepository'
import type { UsageRepository } from '@/server/usage/UsageRepository'
import type { WorkspaceBillingRolloutDecision } from '@/shared/billing/workspace-billing-rollout'
import { BillingServiceError } from './BillingCustomerService'

type Deps = {
  baseUrl: () => string
  billingProvider: () => BillingProvider
  repository: BillingRepository
  rollout: (workspaceId: string) => WorkspaceBillingRolloutDecision
  usage: UsageRepository
  workspaces: Pick<WorkspaceService, 'resolveActiveWorkspace'>
}

export class WorkspaceBillingService {
  constructor(private readonly deps: Deps) {}

  async initialize(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.requireManager(args)
    this.requireRollout(access.workspace.id)
    await this.deps.repository.ensureWorkspaceBillingAccount({
      primaryBillingContactUserId: args.actorUserId,
      workspaceId: access.workspace.id,
    })
    return await this.summary(args)
  }

  async summary(args: { actorUserId: string; workspaceId: string }): Promise<WorkspaceBillingSummaryResponse> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (access.workspace.kind !== 'organization') this.fail('Organization workspace required.', 400)
    const account = await this.deps.repository.getWorkspaceBillingAccountByWorkspaceIdByServer({
      workspaceId: access.workspace.id,
    })
    const rollout = this.deps.rollout(access.workspace.id)
    const canManage = canManageWorkspace(access.membership.role)
    if (!account) return emptySummary(access.workspace.id, canManage, rollout)
    const [entitlements, subscription] = await Promise.all([
      this.deps.repository.getBillingAccountEntitlementsByServer({ billingAccountId: account.billingAccountId }),
      this.deps.repository.getBillingAccountSubscriptionByServer({ billingAccountId: account.billingAccountId }),
    ])
    const totalCents = entitlements?.budgetTotalCents ?? 0
    const usedCents = entitlements?.budgetUsedCents ?? 0
    const remainingCents = entitlements?.budgetRemainingCents ?? 0
    const periodStart = subscription?.currentPeriodStart ?? Date.now() - 30 * 24 * 60 * 60_000
    const observability = canManage
      ? await this.deps.usage.getBillingAccountOperationalReport({
          billingAccountId: account.billingAccountId,
          periodStart,
          reconciliationSlaMs: 15 * 60_000,
        })
      : undefined
    return {
      workspaceId: access.workspace.id,
      canManage,
      initialized: true,
      pricingVersion: account.pricingVersion,
      rollout,
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
      ...(observability ? { observability: {
        actualProviderCostCents: observability.actualProviderCostCents,
        costCoveragePercent: observability.costCoveragePercent,
        meteredReservations: observability.meteredReservations,
        oldestReconciliationAgeMs: observability.oldestReconciliationAgeMs,
        periodEnd: observability.periodEnd,
        periodStart: observability.periodStart,
        realizedMarginPercent: observability.realizedMarginPercent,
        reconciliationReservations: observability.reconciliationReservations,
        retailCredits: observability.retailCredits,
        staleReconciliationReservations: observability.staleReconciliationReservations,
      } } : {}),
    }
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
    const { account, workspaceId } = await this.requireEligibleAccountManager(args)
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
    const { account, workspaceId } = await this.requireEligibleAccountManager(args)
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
    const { account, workspaceId } = await this.requireAccountManager(args)
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
    if (access.workspace.kind !== 'organization' || !canManageWorkspace(access.membership.role)) {
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

  private async requireEligibleAccountManager(args: { actorUserId: string; workspaceId: string }) {
    const result = await this.requireAccountManager(args)
    this.requireRollout(result.workspaceId)
    return result
  }

  private requireRollout(workspaceId: string): WorkspaceBillingRolloutDecision {
    const rollout = this.deps.rollout(workspaceId)
    if (!rollout.eligible || !rollout.checkoutEnabled) {
      this.fail('Workspace billing is not enabled for this workspace yet.', 403)
    }
    return rollout
  }

  private fail(message: string, statusCode: number): never {
    throw new BillingServiceError({ error: message }, statusCode)
  }
}

function emptySummary(
  workspaceId: string,
  canManage: boolean,
  rollout: WorkspaceBillingRolloutDecision,
): WorkspaceBillingSummaryResponse {
  return {
    workspaceId,
    canManage,
    initialized: false,
    pricingVersion: 'markup_25_v1',
    rollout,
    credits: {
      total: 0,
      used: 0,
      remaining: 0,
      allowancePercentUsed: 0,
      topUpBalance: 0,
    },
    subscription: { planKind: 'free', planAmountCents: 0 },
  }
}
