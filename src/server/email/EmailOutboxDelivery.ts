import 'server-only'

import type { AuditService } from '@/server/admin'
import type { OutboxEvent, OutboxPublisher } from '@/server/jobs'
import type { OverlayRuntimeConfig } from '@/shared/config'
import { renderLifecycleEmail, type EmailProvider, type LifecycleEmailEvent } from '@/shared/email'
import type { EmailRecipientRepository } from './EmailRecipientRepository'
import type { EmailSuppressionRepository } from './EmailSuppressionRepository'

export const LIFECYCLE_EMAIL_OUTBOX_TOPIC = 'email.lifecycle.v1'

export class EmailOutboxDelivery {
  constructor(private readonly deps: {
    audit: AuditService
    config: OverlayRuntimeConfig
    provider: EmailProvider
    recipients: EmailRecipientRepository
    suppressions: EmailSuppressionRepository
  }) {}

  publisher(): OutboxPublisher {
    return async (event) => await this.deliver(event)
  }

  async deliver(outbox: OutboxEvent): Promise<void> {
    if (outbox.topic !== LIFECYCLE_EMAIL_OUTBOX_TOPIC) {
      throw new Error(`Unsupported outbox topic: ${outbox.topic}`)
    }
    const event = parseLifecycleEmailEvent(outbox.payload)
    // Workspace invitations are addressed to a not-yet-member email, not to
    // the inviter identified by event.userId. Account suppressions therefore
    // apply only to account-owned lifecycle mail.
    const invitationRecipient = event.name === 'workspace.invitation_sent'
      ? optionalEmail(event.attributes.invitedEmail)
      : null
    const suppressed = invitationRecipient
      ? null
      : await this.deps.suppressions.get(event.userId)
    if (suppressed) {
      await this.recordAudit(outbox, event, 'email.delivery.suppressed', 'denied', {
        reason: suppressed.reason,
        source: suppressed.source,
      })
      return
    }
    const recipient = invitationRecipient ?? await this.deps.recipients.getEmail(event.userId)
    if (!recipient) throw new Error('Transactional email recipient is unavailable')
    const content = renderLifecycleEmail(event, this.deps.config.app.baseUrl)
    const from = this.deps.config.email?.from
    if (!from) throw new Error('Transactional email sender is unavailable')

    try {
      const result = await this.deps.provider.send({
        from,
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
        replyTo: this.deps.config.email?.replyTo,
        idempotencyKey: event.idempotencyKey,
      })
      await this.recordAudit(
        outbox,
        event,
        result.status === 'sent' ? 'email.delivery.sent' : 'email.delivery.skipped',
        'success',
        {
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          template: event.name,
        },
      )
    } catch (error) {
      if (!invitationRecipient && isProviderSuppression(error)) {
        await this.deps.suppressions.suppress({
          reason: 'provider_suppression',
          source: 'provider',
          suppressedAt: Date.now(),
          userId: event.userId,
        })
      }
      await this.recordAudit(outbox, event, 'email.delivery.failed', 'failure', {
        provider: this.deps.provider.name,
        template: event.name,
      })
      throw error
    }
  }

  private async recordAudit(
    outbox: OutboxEvent,
    event: LifecycleEmailEvent,
    action: string,
    outcome: 'success' | 'denied' | 'failure',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({
      action,
      actorType: 'system',
      actorUserId: event.userId,
      metadata: { ...metadata, outboxAttempt: outbox.attempts },
      outcome,
      resourceId: outbox.id,
      resourceType: 'transactional_email',
    })
  }
}

function parseLifecycleEmailEvent(value: Record<string, unknown>): LifecycleEmailEvent {
  const name = value.name
  if (![
    'user.created',
    'subscription.changed',
    'topup.succeeded',
    'automation.failed',
    'api_key.changed',
    'workspace.invitation_sent',
    'workspace.mention',
    'workspace.dm_received',
  ].includes(String(name))) {
    throw new Error('Unsupported lifecycle email event')
  }
  const userId = requiredString(value.userId, 'userId')
  const idempotencyKey = requiredString(value.idempotencyKey, 'idempotencyKey')
  return {
    attributes: recordValue(value.attributes),
    idempotencyKey,
    name: name as LifecycleEmailEvent['name'],
    resource: recordValue(value.resource),
    userId,
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function optionalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function isProviderSuppression(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /suppression list|suppressed destination|bounce|complaint/i.test(message)
}
