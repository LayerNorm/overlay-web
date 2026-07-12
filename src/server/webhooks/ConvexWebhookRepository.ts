import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { Id } from '../../../convex/_generated/dataModel'
import type {
  WebhookDeliveryRecord,
  WebhookRepository,
  WebhookSubscriptionRecord,
} from './WebhookRepository'

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

  async rotateSecret(args: Parameters<WebhookRepository['rotateSecret']>[0]): Promise<string | null> {
    const result = await convex.mutation<{ secret: string | null }>('webhooks/subscriptions:rotateSecretByServer', {
      ...args,
      subscriptionId: args.subscriptionId as Id<'webhookSubscriptions'>,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
    return result?.secret ?? null
  }

  async remove(args: Parameters<WebhookRepository['remove']>[0]): Promise<boolean> {
    const result = await convex.mutation<{ removed: boolean }>('webhooks/subscriptions:remove', {
      ...args,
      subscriptionId: args.subscriptionId as Id<'webhookSubscriptions'>,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
    return result?.removed ?? false
  }

  async listDeliveries(
    args: Parameters<WebhookRepository['listDeliveries']>[0],
  ): Promise<WebhookDeliveryRecord[]> {
    return await convex.query<WebhookDeliveryRecord[]>('webhooks/deliveries:listByServer', {
      ...args,
      subscriptionId: args.subscriptionId as Id<'webhookSubscriptions'> | undefined,
      serverSecret: getInternalApiSecret(),
    }) ?? []
  }

  async redriveDelivery(
    args: Parameters<WebhookRepository['redriveDelivery']>[0],
  ): Promise<string | null> {
    const result = await convex.mutation<{ deliveryId: Id<'webhookDeliveries'> | null }>(
      'webhooks/deliveries:redriveByServer',
      {
        ...args,
        deliveryId: args.deliveryId as Id<'webhookDeliveries'>,
        serverSecret: getInternalApiSecret(),
      },
      { throwOnError: true },
    )
    return result?.deliveryId ?? null
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
