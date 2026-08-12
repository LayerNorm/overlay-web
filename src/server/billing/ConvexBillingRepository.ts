import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type {
  BillingBalanceParityReport,
  BillingSubscriptionVerificationRow,
} from '@/shared/billing/billing-account-migration'
import type {
  BillingAccountSpendLimitRecord,
  BillingSpendSubject,
} from '@/shared/billing/billing-payer'
import type {
  BillingEntitlementsRecord,
  BillingAccountEntitlementsRecord,
  BillingRepository,
  BillingSubscriptionRecord,
  BudgetTopUpRecord,
  AdministrativeUsageRecord,
  PersonalBillingBackfillResult,
} from './BillingRepository'
import type { BillingWebhookRepository } from './BillingProviderEventRepository'

export class ConvexBillingRepository implements BillingRepository, BillingWebhookRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async backfillPersonalBillingAccountByServer(args: {
    userId: string
  }): Promise<PersonalBillingBackfillResult> {
    const result = await convex.mutation<PersonalBillingBackfillResult>(
      'billing/accountMigration:backfillPersonalByUserByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!result) throw new Error('Failed to backfill personal billing account')
    return result
  }

  async ensurePersonalBillingAccount(args: { userId: string }): Promise<BillingAccountRecord> {
    const account = await convex.mutation<BillingAccountRecord>(
      'billing/accounts:ensurePersonalByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!account) throw new Error('Failed to ensure personal billing account')
    return account
  }

  async ensureWorkspaceBillingAccount(args: {
    primaryBillingContactUserId: string
    workspaceId: string
  }): Promise<BillingAccountRecord> {
    const account = await convex.mutation<BillingAccountRecord>(
      'billing/accounts:ensureWorkspaceByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!account) throw new Error('Failed to ensure workspace billing account')
    return account
  }

  async getBillingAccountByIdByServer(args: {
    billingAccountId: string
  }): Promise<BillingAccountRecord | null> {
    return await convex.query<BillingAccountRecord | null>(
      'billing/accounts:getByIdByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async getPersonalBillingAccountByUserIdByServer(args: {
    userId: string
  }): Promise<BillingAccountRecord | null> {
    return await convex.query<BillingAccountRecord | null>(
      'billing/accounts:getPersonalByUserIdByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async getWorkspaceBillingAccountByWorkspaceIdByServer(args: {
    workspaceId: string
  }): Promise<BillingAccountRecord | null> {
    return await convex.query<BillingAccountRecord | null>(
      'billing/accounts:getWorkspaceByWorkspaceIdByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async getBillingAccountEntitlementsByServer(args: {
    billingAccountId: string
  }): Promise<BillingAccountEntitlementsRecord | null> {
    return await convex.query<BillingAccountEntitlementsRecord | null>(
      'billing/accountSubscriptions:getEntitlementsByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async getBillingAccountSubscriptionByServer(args: {
    billingAccountId: string
  }): Promise<BillingSubscriptionRecord | null> {
    return await convex.query<BillingSubscriptionRecord | null>(
      'billing/accountSubscriptions:getByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async getPersonalBillingBalanceParityByServer(args: {
    userId: string
  }): Promise<BillingBalanceParityReport | null> {
    return await convex.query<BillingBalanceParityReport | null>(
      'billing/accountMigration:getPersonalBalanceParityByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async listSubscriptionVerificationRowsByServer(args: {
    limit?: number
  } = {}): Promise<BillingSubscriptionVerificationRow[]> {
    return await convex.query<BillingSubscriptionVerificationRow[]>(
      'billing/accountMigration:listSubscriptionVerificationRowsByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    ) ?? []
  }

  async getBillingAccountSpendLimitByServer(args: {
    billingAccountId: string
    subject: BillingSpendSubject
  }): Promise<BillingAccountSpendLimitRecord | null> {
    return await convex.query<BillingAccountSpendLimitRecord | null>(
      'billing/spendLimits:getByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async upsertBillingAccountSpendLimit(args: {
    billingAccountId: string
    limitCents: number
    periodEnd: number
    periodStart: number
    subject: BillingSpendSubject
  }): Promise<BillingAccountSpendLimitRecord> {
    const limit = await convex.mutation<BillingAccountSpendLimitRecord>(
      'billing/spendLimits:upsertByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!limit) throw new Error('Failed to update billing account spend limit')
    return limit
  }

  async listAdministrativeUsage(args: {
    limit?: number
    userId?: string
  } = {}): Promise<AdministrativeUsageRecord[]> {
    return await convex.query<AdministrativeUsageRecord[]>(
      'platform/usage:listAdministrativeUsageByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    ) ?? []
  }

  async adjustAdministrativeBudget(args: {
    amountCents: number
    userId: string
  }): Promise<AdministrativeUsageRecord> {
    const record = await convex.mutation<AdministrativeUsageRecord>(
      'platform/usage:adjustAdministrativeBudgetByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!record) throw new Error('Failed to adjust administrative budget')
    return record
  }

  async getEntitlementsByServer(args: {
    userId: string
  }): Promise<BillingEntitlementsRecord | null> {
    return await convex.query<BillingEntitlementsRecord | null>(
      'platform/usage:getEntitlementsByServer',
      {
        ...args,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
  }

  async getSubscriptionByUserIdByServer(args: {
    userId: string
  }): Promise<BillingSubscriptionRecord | null> {
    return await convex.query<BillingSubscriptionRecord | null>(
      'billing/subscriptions:getByUserIdByServer',
      {
        ...args,
        serverSecret: this.serverSecret,
      },
    )
  }

  async getSubscriptionByUserId(args: {
    accessToken: string
    userId: string
  }): Promise<BillingSubscriptionRecord | null> {
    return await convex.query<BillingSubscriptionRecord | null>('billing/subscriptions:getByUserId', args)
  }

  async updateBillingPreferences(args: {
    autoTopUpEnabled: boolean
    grantOffSessionConsent: boolean
    topUpAmountCents: number
    userId: string
  }): Promise<{ success: boolean; error?: string } | null> {
    return await convex.mutation<{ success: boolean; error?: string } | null>(
      'billing/subscriptions:updateBillingPreferencesByServer',
      {
        ...args,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    )
  }

  async upsertSubscription(args: Record<string, unknown> & {
    userId: string
  }): Promise<unknown> {
    return await convex.mutation('billing/subscriptions:upsertSubscription', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async upsertBillingAccountSubscription(args: Record<string, unknown> & {
    billingAccountId: string
  }): Promise<unknown> {
    return await convex.mutation('billing/accountSubscriptions:upsertByServer', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async listBudgetTopUpsByServer(args: {
    userId: string
  }): Promise<BudgetTopUpRecord[]> {
    return await convex.query<BudgetTopUpRecord[]>(
      'billing/subscriptions:listBudgetTopUpsByServer',
      {
        ...args,
        serverSecret: this.serverSecret,
      },
      { throwOnError: true },
    ) ?? []
  }

  async recordBudgetTopUp(args: {
    amountCents: number
    source: 'manual' | 'auto'
    status: 'pending' | 'succeeded' | 'failed' | 'canceled'
    stripeCheckoutSessionId?: string
    stripeCustomerId?: string
    stripePaymentIntentId?: string
    userId: string
  }): Promise<unknown> {
    return await convex.mutation('billing/subscriptions:recordBudgetTopUpByServer', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async recordBillingAccountTopUp(args: {
    actorUserId: string
    amountCents: number
    billingAccountId: string
    source: 'manual' | 'auto'
    status: 'pending' | 'succeeded' | 'failed' | 'canceled'
    stripeCheckoutSessionId?: string
    stripeCustomerId?: string
    stripePaymentIntentId?: string
    errorMessage?: string
  }): Promise<unknown> {
    return await convex.mutation('billing/accountSubscriptions:recordTopUpByServer', {
      ...args,
      serverSecret: this.serverSecret,
    })
  }

  async reverseTopUp(args: {
    userId: string
    billingAccountId?: string
    stripePaymentIntentId: string
    refundAmountCents: number
    reason: string
  }): Promise<{ reversed: boolean }> {
    if (args.billingAccountId) {
      return await convex.mutation<{ reversed: boolean }>(
        'billing/accountSubscriptions:reverseTopUpByServer',
        {
          billingAccountId: args.billingAccountId,
          refundAmountCents: args.refundAmountCents,
          reason: args.reason,
          serverSecret: this.serverSecret,
          stripePaymentIntentId: args.stripePaymentIntentId,
        },
        { throwOnError: true },
      ) ?? { reversed: false }
    }
    return await convex.mutation<{ reversed: boolean }>(
      'billing/subscriptions:reverseTopUpByServer',
      {
        refundAmountCents: args.refundAmountCents,
        reason: args.reason,
        serverSecret: this.serverSecret,
        stripePaymentIntentId: args.stripePaymentIntentId,
        userId: args.userId,
      },
      { throwOnError: true },
    ) ?? { reversed: false }
  }

  async resolveBillingAccountIdByProviderReference(args: {
    provider: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<string | null> {
    return await convex.query<string | null>(
      'billing/accountSubscriptions:resolveAccountIdByProviderReferenceByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }

  async resolveUserIdByProviderReference(args: {
    provider: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<string | null> {
    return await convex.query<string | null>(
      'billing/subscriptions:resolveUserIdByProviderReferenceByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
  }
}
