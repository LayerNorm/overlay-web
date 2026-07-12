import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  durableJobs,
  webhookDeliveries,
  webhookSubscriptions,
} from '@/server/database/postgres/schema'
import type { WebhookEventType } from '@/shared/schemas/webhooks'
import { WEBHOOK_DELIVERY_JOB } from './PostgresWebhookDeliveryService'
import type { WebhookRepository, WebhookSubscriptionRecord } from './WebhookRepository'

export class PostgresWebhookRepository implements WebhookRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async list(args: { userId: string }): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.userId, args.userId))
      .orderBy(desc(webhookSubscriptions.updatedAt))
    return rows.map((row) => ({
      _id: row.id,
      createdAt: row.createdAt.getTime(),
      description: row.description ?? undefined,
      enabled: row.enabled,
      events: row.events as WebhookEventType[],
      updatedAt: row.updatedAt.getTime(),
      url: row.url,
    }))
  }

  async create(args: Parameters<WebhookRepository['create']>[0]) {
    const now = new Date()
    const id = `webhook_subscription_${randomUUID()}`
    const secret = randomBytes(32).toString('hex')
    await this.db.insert(webhookSubscriptions).values({
      createdAt: now,
      description: normalizeOptional(args.description),
      enabled: args.enabled ?? true,
      events: args.events,
      id,
      secret,
      updatedAt: now,
      url: args.url.trim(),
      userId: args.userId,
    })
    return { id, secret }
  }

  async update(args: Parameters<WebhookRepository['update']>[0]): Promise<boolean> {
    const rows = await this.db
      .update(webhookSubscriptions)
      .set({
        ...(args.description !== undefined ? { description: normalizeOptional(args.description) } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.events !== undefined ? { events: args.events } : {}),
        ...(args.url !== undefined ? { url: args.url.trim() } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(webhookSubscriptions.id, args.subscriptionId),
        eq(webhookSubscriptions.userId, args.userId),
      ))
      .returning({ id: webhookSubscriptions.id })
    return rows.length > 0
  }

  async remove(args: Parameters<WebhookRepository['remove']>[0]): Promise<boolean> {
    const rows = await this.db
      .delete(webhookSubscriptions)
      .where(and(
        eq(webhookSubscriptions.id, args.subscriptionId),
        eq(webhookSubscriptions.userId, args.userId),
      ))
      .returning({ id: webhookSubscriptions.id })
    return rows.length > 0
  }

  async dispatch(args: Parameters<WebhookRepository['dispatch']>[0]): Promise<{ enqueued: number }> {
    return await this.db.transaction(async (tx) => {
      const subscriptions = await tx
        .select({ id: webhookSubscriptions.id, events: webhookSubscriptions.events })
        .from(webhookSubscriptions)
        .where(and(
          eq(webhookSubscriptions.userId, args.userId),
          eq(webhookSubscriptions.enabled, true),
        ))
      let enqueued = 0
      for (const subscription of subscriptions) {
        if (!subscription.events.includes(args.event.type)) continue
        const deliveryId = `webhook_delivery_${randomUUID()}`
        const jobId = randomUUID()
        const inserted = await tx
          .insert(webhookDeliveries)
          .values({
            eventId: args.event.id,
            eventType: args.event.type,
            id: deliveryId,
            payloadJson: JSON.stringify(args.event),
            subscriptionId: subscription.id,
            userId: args.userId,
          })
          .onConflictDoNothing()
          .returning({ id: webhookDeliveries.id })
        if (inserted.length === 0) continue
        await tx.insert(durableJobs).values({
          dedupeKey: `webhook-delivery:${deliveryId}`,
          id: jobId,
          maxAttempts: 5,
          payload: { deliveryId },
          priority: 5,
          type: WEBHOOK_DELIVERY_JOB,
        })
        enqueued += 1
      }
      return { enqueued }
    })
  }
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}
