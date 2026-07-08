import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  BillingEntitlementsRecord,
  BillingRepository,
  BillingSubscriptionRecord,
  BudgetTopUpRecord,
} from './BillingRepository'

export class ConvexBillingRepository implements BillingRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
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
}
