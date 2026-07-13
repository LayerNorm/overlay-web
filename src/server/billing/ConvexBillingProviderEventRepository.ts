import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  BillingProviderEventRepository,
  BillingProviderEventReservation,
} from './BillingProviderEventRepository'

export class ConvexBillingProviderEventRepository implements BillingProviderEventRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async reserve(args: {
    eventId: string
    eventType: string
    payloadHash: string
    provider: string
  }): Promise<BillingProviderEventReservation> {
    const result = await convex.mutation<BillingProviderEventReservation>(
      'billing/subscriptions:reserveProviderEventByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!result) throw new Error('Failed to reserve billing provider event')
    return result
  }

  async markProcessed(args: { eventId: string; provider: string }): Promise<void> {
    await convex.mutation('billing/subscriptions:markProviderEventProcessedByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async markFailed(args: { error: string; eventId: string; provider: string }): Promise<void> {
    await convex.mutation('billing/subscriptions:markProviderEventFailedByServer', {
      ...args,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }
}
