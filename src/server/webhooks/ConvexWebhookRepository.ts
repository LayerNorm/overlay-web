import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Id } from '../../../convex/_generated/dataModel'
import type { WebhookRepository, WebhookSubscriptionRecord } from './WebhookRepository'

export class ConvexWebhookRepository implements WebhookRepository {
  async list(args: { userId: string }): Promise<WebhookSubscriptionRecord[]> {
    return await convex.query<WebhookSubscriptionRecord[]>('webhooks/subscriptions:list', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }) ?? []
  }

  async create(args: Parameters<WebhookRepository['create']>[0]) {
    return await convex.mutation<{ id: Id<'webhookSubscriptions'>; secret: string }>(
      'webhooks/subscriptions:create',
      { ...args, serverSecret: getInternalApiSecret() },
      { throwOnError: true },
    ) as { id: string; secret: string }
  }

  async update(args: Parameters<WebhookRepository['update']>[0]): Promise<boolean> {
    const result = await convex.mutation<{ updated: boolean }>('webhooks/subscriptions:update', {
      ...args,
      subscriptionId: args.subscriptionId as Id<'webhookSubscriptions'>,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
    return result?.updated ?? false
  }

  async remove(args: Parameters<WebhookRepository['remove']>[0]): Promise<boolean> {
    const result = await convex.mutation<{ removed: boolean }>('webhooks/subscriptions:remove', {
      ...args,
      subscriptionId: args.subscriptionId as Id<'webhookSubscriptions'>,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
    return result?.removed ?? false
  }

  async dispatch(args: Parameters<WebhookRepository['dispatch']>[0]): Promise<{ enqueued: number }> {
    const result = await convex.mutation<{ enqueued: number }>('webhooks/deliveries:enqueueByServer', {
      serverSecret: getInternalApiSecret(),
      userId: args.userId,
      eventId: args.event.id,
      eventType: args.event.type,
      payloadJson: JSON.stringify(args.event),
    }, { throwOnError: true, timeoutMs: 10_000, suppressNetworkConsoleError: true })
    return { enqueued: result?.enqueued ?? 0 }
  }
}
