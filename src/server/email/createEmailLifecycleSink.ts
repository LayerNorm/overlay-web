import 'server-only'

import type { OutboxRepository } from '@/server/jobs'
import type { LifecycleEventSink } from '@/server/lifecycle-events'
import type { RateLimiter } from '@overlay/app-core'
import { LIFECYCLE_EMAIL_OUTBOX_TOPIC } from './EmailOutboxDelivery'

/**
 * Per-user email rate limits. Without these, a user can @-mention or DM-spam
 * a victim into hundreds of emails, or a failing automation can email every
 * 15 minutes indefinitely. These limits are intentionally per-recipient
 * (event.userId) so a single bad actor cannot exhaust a global pool.
 */
const EMAIL_RATE_LIMITS = [
  // General cap: 10 transactional emails per user per hour.
  { bucket: 'lifecycle-email:user', key: '', limit: 10, windowMs: 60 * 60 * 1000 },
]

// Stricter cap for automation failure notifications: 2 per hour.
const AUTOMATION_FAILED_RATE_LIMITS = [
  { bucket: 'lifecycle-email:automation-failed', key: '', limit: 2, windowMs: 60 * 60 * 1000 },
]

export function createEmailLifecycleSink(
  outbox: OutboxRepository,
  rateLimiter?: RateLimiter,
): LifecycleEventSink {
  return {
    destination: 'email',
    deliver: async (event) => {
      if (rateLimiter) {
        const limits = event.name === 'automation.failed'
          ? [...EMAIL_RATE_LIMITS, ...AUTOMATION_FAILED_RATE_LIMITS]
          : EMAIL_RATE_LIMITS
        // The rate-limit key is the recipient's userId; each spec's key is
        // overridden with the event's userId so the bucket is per-recipient.
        const specs = limits.map((spec) => ({ ...spec, key: event.userId }))
        const result = await rateLimiter.check('lifecycle-email', specs)
        if (!result.allowed) return
      }
      await outbox.append({
        dedupeKey: `transactional-email:${event.idempotencyKey}`,
        id: `email_${event.eventId}`,
        maxAttempts: 8,
        payload: {
          attributes: event.attributes,
          idempotencyKey: event.idempotencyKey,
          name: event.name,
          resource: event.resource,
          userId: event.userId,
        },
        topic: LIFECYCLE_EMAIL_OUTBOX_TOPIC,
      })
    },
  }
}
