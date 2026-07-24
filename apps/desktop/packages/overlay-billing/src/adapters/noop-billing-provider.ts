import { createFreeEntitlements } from '../entitlements'
import type {
  BillingProvider,
  CheckoutArgs,
  CheckoutResult,
  CheckoutSessionVerificationArgs,
  CheckoutSessionVerificationResult,
  Entitlements,
  PortalSessionArgs,
  PortalResult,
  UsageArgs,
} from '../types'

export class NoOpBillingProvider implements BillingProvider {
  async getEntitlements(userId: string): Promise<Entitlements> {
    void userId
    return createFreeEntitlements()
  }

  async createCheckoutSession(args: CheckoutArgs): Promise<CheckoutResult> {
    void args
    throw new Error('Billing provider is disabled; checkout sessions are unavailable.')
  }

  async createPortalSession(userId: string): Promise<PortalResult> {
    void userId
    throw new Error('Billing provider is disabled; customer portal sessions are unavailable.')
  }

  async createCustomerPortalSession(args: PortalSessionArgs): Promise<PortalResult> {
    void args
    throw new Error('Billing provider is disabled; customer portal sessions are unavailable.')
  }

  async verifyCheckoutSession(
    args: CheckoutSessionVerificationArgs,
  ): Promise<CheckoutSessionVerificationResult> {
    void args
    throw new Error('Billing provider is disabled; checkout verification is unavailable.')
  }

  async recordUsage(args: UsageArgs): Promise<void> {
    void args
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    void subscriptionId
  }
}
