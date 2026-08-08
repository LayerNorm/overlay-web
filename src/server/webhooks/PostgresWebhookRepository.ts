import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  durableJobs,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookSubscriptions,
} from '@/server/database/postgres/schema'
import type { WebhookEventType } from '@/shared/schemas/webhooks'
import { WEBHOOK_DELIVERY_JOB } from './PostgresWebhookDeliveryService'
import type {
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookRepository,
  WebhookSubscriptionRecord,
} from './WebhookRepository'

export class PostgresWebhookRepository implements WebhookRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async list(args: { userId: string; workspaceId?: string }): Promise<WebhookSubscriptionRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(and(
        eq(webhookSubscriptions.userId, args.userId),
        args.workspaceId ? eq(webhookSubscriptions.workspaceId, args.workspaceId) : undefined,
      ))
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
      workspaceId: args.workspaceId,
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
        args.workspaceId ? eq(webhookSubscriptions.workspaceId, args.workspaceId) : undefined,
      ))
      .returning({ id: webhookSubscriptions.id })
    return rows.length > 0
  }

  async rotateSecret(args: Parameters<WebhookRepository['rotateSecret']>[0]): Promise<string | null> {
    const secret = randomBytes(32).toString('hex')
    const rows = await this.db
      .update(webhookSubscriptions)
      .set({ secret, updatedAt: new Date() })
      .where(and(
        eq(webhookSubscriptions.id, args.subscriptionId),
        eq(webhookSubscriptions.userId, args.userId),
      ))
      .returning({ id: webhookSubscriptions.id })
    return rows.length > 0 ? secret : null
  }

  async remove(args: Parameters<WebhookRepository['remove']>[0]): Promise<boolean> {
    const rows = await this.db
      .delete(webhookSubscriptions)
      .where(and(
        eq(webhookSubscriptions.id, args.subscriptionId),
        eq(webhookSubscriptions.userId, args.userId),
        args.workspaceId ? eq(webhookSubscriptions.workspaceId, args.workspaceId) : undefined,
      ))
      .returning({ id: webhookSubscriptions.id })
    return rows.length > 0
  }

  async listDeliveries(
    args: Parameters<WebhookRepository['listDeliveries']>[0],
  ): Promise<WebhookDeliveryRecord[]> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 250)
    const conditions = [eq(webhookDeliveries.userId, args.userId)]
    if (args.subscriptionId) {
      conditions.push(eq(webhookDeliveries.subscriptionId, args.subscriptionId))
    }
    const deliveries = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
    const deliveryIds = deliveries.map((delivery) => delivery.id)
    const attempts = deliveryIds.length > 0
      ? await this.db
          .select()
          .from(webhookDeliveryAttempts)
          .where(inArray(webhookDeliveryAttempts.deliveryId, deliveryIds))
          .orderBy(asc(webhookDeliveryAttempts.attemptNumber))
      : []
    return deliveries.map((delivery) => ({
      _id: delivery.id,
      attemptCount: delivery.attemptCount,
      attempts: attempts
        .filter((attempt) => attempt.deliveryId === delivery.id)
        .map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          ...(attempt.completedAt ? { completedAt: attempt.completedAt.getTime() } : {}),
          ...(attempt.error ? { error: attempt.error } : {}),
          startedAt: attempt.startedAt.getTime(),
          status: attempt.status,
          ...(attempt.statusCode !== null ? { statusCode: attempt.statusCode } : {}),
        })),
      createdAt: delivery.createdAt.getTime(),
      ...(delivery.deliveredAt ? { deliveredAt: delivery.deliveredAt.getTime() } : {}),
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      ...(delivery.lastError ? { lastError: delivery.lastError } : {}),
      ...(delivery.lastStatusCode !== null ? { lastStatusCode: delivery.lastStatusCode } : {}),
      status: delivery.status as WebhookDeliveryStatus,
      subscriptionId: delivery.subscriptionId,
      updatedAt: delivery.updatedAt.getTime(),
    }))
  }

  async redriveDelivery(
    args: Parameters<WebhookRepository['redriveDelivery']>[0],
  ): Promise<string | null> {
    return await this.db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(webhookDeliveries)
        .where(and(
          eq(webhookDeliveries.id, args.deliveryId),
          eq(webhookDeliveries.userId, args.userId),
          eq(webhookDeliveries.status, 'dead_letter'),
        ))
        .limit(1)
      if (!source) return null
      const deliveryId = `webhook_delivery_${randomUUID()}`
      const jobId = randomUUID()
      await tx.insert(webhookDeliveries).values({
        eventId: `${source.eventId}:redrive:${randomUUID()}`,
        eventType: source.eventType,
        id: deliveryId,
        payloadJson: source.payloadJson,
        subscriptionId: source.subscriptionId,
        userId: args.userId,
      })
      await tx.insert(durableJobs).values({
        dedupeKey: `webhook-delivery:${deliveryId}`,
        id: jobId,
        maxAttempts: 5,
        payload: { deliveryId },
        priority: 10,
        type: WEBHOOK_DELIVERY_JOB,
      })
      return deliveryId
    })
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
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
