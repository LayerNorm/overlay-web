import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type { UsageTotal } from '@/shared/billing/usage-resources'
import type {
  BillingAccountSpendLimitRecord,
  BillingSpendSubject,
} from '@/shared/billing/billing-payer'
import type {
  BillingEntitlementsRecord,
  BillingAccountEntitlementsRecord,
  BillingRepository,
  BillingSubscriptionRecord,
} from './BillingRepository'

export class ConvexBillingRepository implements BillingRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
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

  async getBillingAccountUsageTotalsByServer(args: {
    billingAccountId: string
    periodStart: number
  }): Promise<{ totals: UsageTotal[]; truncated: boolean }> {
    return await convex.query<{ totals: UsageTotal[]; truncated: boolean }>(
      'billing/usageTotals:usageTotalsByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    ) ?? { totals: [], truncated: false }
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

  async upsertBillingAccountSubscription(args: Record<string, unknown> & {
    billingAccountId: string
  }): Promise<unknown> {
    return await convex.mutation('billing/accountSubscriptions:upsertByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
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
    }, { throwOnError: true })
  }

}
