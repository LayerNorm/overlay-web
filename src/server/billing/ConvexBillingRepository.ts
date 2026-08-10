import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type {
  BillingBalanceParityReport,
  BillingSubscriptionVerificationRow,
} from '@/shared/billing/billing-account-migration'
import type {
  BillingEntitlementsRecord,
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
