import 'server-only'

import { randomUUID } from 'node:crypto'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { OutboxEvent, OutboxRepository } from './OutboxRepository'

export class ConvexOutboxRepository implements OutboxRepository {
  async append(args: {
    availableAt?: number
    dedupeKey?: string
    id?: string
    maxAttempts?: number
    payload?: Record<string, unknown>
    topic: string
  }): Promise<string> {
    const { convex } = await import('@/server/database/convex')
    const result = await convex.mutation<string>('email/outbox:appendByServer', {
      serverSecret: getInternalApiSecret(),
      availableAt: args.availableAt,
      dedupeKey: args.dedupeKey,
      eventId: args.id ?? randomUUID(),
      maxAttempts: args.maxAttempts,
      payloadJson: JSON.stringify(args.payload ?? {}),
      topic: args.topic,
    }, { throwOnError: true })
    if (result === null) throw new Error('Convex outbox append returned no result')
    return result
  }

  async claim(args: { leaseMs: number; now?: number; workerId: string }): Promise<OutboxEvent | null> {
    const { convex } = await import('@/server/database/convex')
    const result = await convex.mutation<{
      attempts: number
      eventId: string
      maxAttempts: number
      payloadJson: string
      topic: string
    } | null>('email/outbox:claimByServer', {
      serverSecret: getInternalApiSecret(),
      leaseMs: args.leaseMs,
      now: args.now,
      workerId: args.workerId,
    }, { throwOnError: true })
    return result
      ? {
          attempts: result.attempts,
          id: result.eventId,
          maxAttempts: result.maxAttempts,
          payload: parsePayload(result.payloadJson),
          topic: result.topic,
        }
      : null
  }

  async markPublished(args: { eventId: string; workerId: string }): Promise<boolean> {
    const { convex } = await import('@/server/database/convex')
    return (await convex.mutation<boolean>('email/outbox:markPublishedByServer', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })) ?? false
  }

  async markFailed(args: {
    error: string
    eventId: string
    now?: number
    retryDelayMs: number
    workerId: string
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'> {
    const { convex } = await import('@/server/database/convex')
    const result = await convex.mutation<'retry' | 'dead_letter' | 'lost_lease'>('email/outbox:markFailedByServer', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
    if (result === null) throw new Error('Convex outbox failure update returned no result')
    return result
  }

  async renewLease(args: {
    eventId: string
    leaseMs: number
    now?: number
    workerId: string
  }): Promise<boolean> {
    const { convex } = await import('@/server/database/convex')
    return (await convex.mutation<boolean>('email/outbox:renewLeaseByServer', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })) ?? false
  }

  async recoverExpiredLeases(args: {
    limit?: number
    now?: number
  } = {}): Promise<{ deadLettered: number; requeued: number }> {
    const { convex } = await import('@/server/database/convex')
    const result = await convex.mutation<{ deadLettered: number; requeued: number }>(
      'email/outbox:recoverExpiredLeasesByServer',
      { ...args, serverSecret: getInternalApiSecret() },
      { throwOnError: true },
    )
    if (result === null) throw new Error('Convex outbox recovery returned no result')
    return result
  }
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Outbox payload must be an object')
  }
  return parsed as Record<string, unknown>
}
