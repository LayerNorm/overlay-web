import 'server-only'

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { DurableJob } from '@/server/jobs/DurableJobRepository'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
} from '@/server/database/postgres/schema'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'

export const WEBHOOK_DELIVERY_JOB = 'webhook.deliver'

type DeliveryTarget = {
  deliveryId: string
  eventId: string
  eventType: string
  payloadJson: string
  secret: string
  url: string
}

export class PostgresWebhookDeliveryService {
  constructor(
    private readonly db: OverlayPostgresDb,
    private readonly options: {
      fetch?: typeof fetch
      now?: () => number
      validateUrl?: (url: string) => Promise<void>
    } = {},
  ) {}

  async deliver(job: DurableJob): Promise<{ deliveryId: string; statusCode?: number }> {
    const deliveryId = stringPayload(job.payload.deliveryId)
    if (!deliveryId) throw new Error('Webhook delivery job requires deliveryId')
    const now = this.options.now?.() ?? Date.now()
    const target = await this.startAttempt({
      attemptNumber: job.attempts,
      deliveryId,
      jobId: job.id,
      now,
    })
    if (!target) return { deliveryId }

    try {
      await (this.options.validateUrl ?? validateDeliveryUrl)(target.url)
      const timestamp = this.options.now?.() ?? Date.now()
      const signature = signWebhookPayload(target.secret, target.payloadJson, timestamp)
      const response = await (this.options.fetch ?? fetch)(target.url, {
        body: target.payloadJson,
        headers: {
          'Content-Type': 'application/json',
          'X-Overlay-Delivery-Id': target.deliveryId,
          'X-Overlay-Event': target.eventType,
          'X-Overlay-Event-Id': target.eventId,
          'X-Overlay-Signature': `sha256=${signature}`,
          'X-Overlay-Timestamp': String(timestamp),
        },
        method: 'POST',
        redirect: 'error',
      })
      if (!response.ok) throw new WebhookDeliveryHttpError(response.status)
      await this.markDelivered({
        attemptNumber: job.attempts,
        deliveryId,
        now: this.options.now?.() ?? Date.now(),
        statusCode: response.status,
      })
      return { deliveryId, statusCode: response.status }
    } catch (error) {
      await this.markFailed({
        attemptNumber: job.attempts,
        deliveryId,
        error: summarizeError(error),
        now: this.options.now?.() ?? Date.now(),
        statusCode: error instanceof WebhookDeliveryHttpError ? error.statusCode : undefined,
        terminal: job.attempts >= job.maxAttempts,
      })
      throw error
    }
  }

  private async startAttempt(args: {
    attemptNumber: number
    deliveryId: string
    jobId: string
    now: number
  }): Promise<DeliveryTarget | null> {
    const now = new Date(args.now)
    return await this.db.transaction(async (tx) => {
      const result = await tx.execute<DeliveryTarget>(sql`
        SELECT
          delivery.id AS "deliveryId",
          delivery.event_id AS "eventId",
          delivery.event_type AS "eventType",
          delivery.payload_json AS "payloadJson",
          subscription.url,
          subscription.secret
        FROM webhook_deliveries delivery
        INNER JOIN webhook_subscriptions subscription ON subscription.id = delivery.subscription_id
        WHERE delivery.id = ${args.deliveryId}
          AND delivery.status IN ('pending', 'delivering')
          AND subscription.enabled = true
        FOR UPDATE OF delivery
      `)
      const target = result.rows[0]
      if (!target) return null
      await tx
        .update(webhookDeliveries)
        .set({ attemptCount: args.attemptNumber, status: 'delivering', updatedAt: now })
        .where(eq(webhookDeliveries.id, args.deliveryId))
      await tx
        .insert(webhookDeliveryAttempts)
        .values({
          attemptNumber: args.attemptNumber,
          deliveryId: args.deliveryId,
          id: `webhook_attempt_${randomUUID()}`,
          jobId: args.jobId,
          startedAt: now,
          status: 'delivering',
        })
        .onConflictDoUpdate({
          target: [webhookDeliveryAttempts.deliveryId, webhookDeliveryAttempts.attemptNumber],
          set: { jobId: args.jobId, startedAt: now, status: 'delivering' },
        })
      return target
    })
  }

  private async markDelivered(args: {
    attemptNumber: number
    deliveryId: string
    now: number
    statusCode: number
  }): Promise<void> {
    const now = new Date(args.now)
    await this.db.transaction(async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set({
          deliveredAt: now,
          lastError: null,
          lastStatusCode: args.statusCode,
          status: 'delivered',
          updatedAt: now,
        })
        .where(eq(webhookDeliveries.id, args.deliveryId))
      await tx
        .update(webhookDeliveryAttempts)
        .set({ completedAt: now, status: 'delivered', statusCode: args.statusCode })
        .where(and(
          eq(webhookDeliveryAttempts.deliveryId, args.deliveryId),
          eq(webhookDeliveryAttempts.attemptNumber, args.attemptNumber),
        ))
    })
  }

  private async markFailed(args: {
    attemptNumber: number
    deliveryId: string
    error: string
    now: number
    statusCode?: number
    terminal: boolean
  }): Promise<void> {
    const now = new Date(args.now)
    const error = args.error.slice(0, 1_000)
    await this.db.transaction(async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set({
          ...(args.terminal ? { deadLetteredAt: now } : {}),
          lastError: error,
          lastStatusCode: args.statusCode,
          nextAttemptAt: new Date(args.now + retryDelayMs(args.attemptNumber)),
          status: args.terminal ? 'dead_letter' : 'pending',
          updatedAt: now,
        })
        .where(eq(webhookDeliveries.id, args.deliveryId))
      await tx
        .update(webhookDeliveryAttempts)
        .set({ completedAt: now, error, status: 'failed', statusCode: args.statusCode })
        .where(and(
          eq(webhookDeliveryAttempts.deliveryId, args.deliveryId),
          eq(webhookDeliveryAttempts.attemptNumber, args.attemptNumber),
        ))
    })
  }
}

export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
}

export function verifyWebhookSignature(args: {
  payload: string
  secret: string
  signature: string
  timestamp: number
}): boolean {
  const actual = args.signature.replace(/^sha256=/, '')
  const expected = signWebhookPayload(args.secret, args.payload, args.timestamp)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

async function validateDeliveryUrl(url: string): Promise<void> {
  const result = await validatePublicNetworkUrl(url, {
    allowLocalDev: process.env.NODE_ENV !== 'production',
    requireHttps: true,
  })
  if (!result.ok) throw new Error(result.error)
}

function retryDelayMs(attemptNumber: number): number {
  return [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000][
    Math.min(Math.max(attemptNumber - 1, 0), 4)
  ]!
}

function stringPayload(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error || 'Unknown webhook delivery error')
}

class WebhookDeliveryHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`Webhook endpoint returned HTTP ${statusCode}`)
  }
}
