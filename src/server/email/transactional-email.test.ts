import assert from 'node:assert/strict'
import test from 'node:test'
import { AuditService, type AuditEventRecord, type AuditRepository } from '@/server/admin'
import type { OutboxRepository } from '@/server/jobs'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from '@/shared/config/defaultOverlayRuntimeConfig'
import { parseOverlayRuntimeConfig } from '@/shared/config'
import type { EmailProvider } from '@/shared/email'
import { createEmailLifecycleSink } from './createEmailLifecycleSink'
import { EmailOutboxDelivery, LIFECYCLE_EMAIL_OUTBOX_TOPIC } from './EmailOutboxDelivery'
import type { EmailSuppression, EmailSuppressionRepository } from './EmailSuppressionRepository'

test('lifecycle sink persists metadata-only email with a stable dedupe key', async () => {
  const appended: Parameters<OutboxRepository['append']>[0][] = []
  const outbox = { append: async (args: Parameters<OutboxRepository['append']>[0]) => {
    appended.push(args)
    return args.id ?? 'generated'
  } } as OutboxRepository
  const sink = createEmailLifecycleSink(outbox)
  await sink.deliver({
    attributes: { provider: 'stripe', source: 'manual' },
    classification: 'operational',
    destinations: ['email'],
    eventId: 'lifecycle_1',
    idempotencyKey: 'topup.succeeded:stripe:evt_1',
    name: 'topup.succeeded',
    occurredAt: 1,
    resource: { id: 'cs_1', type: 'billing_topup' },
    schemaVersion: 1,
    userId: 'user_1',
  })

  assert.equal(appended.length, 1)
  assert.equal(appended[0]?.dedupeKey, 'transactional-email:topup.succeeded:stripe:evt_1')
  assert.equal(appended[0]?.topic, LIFECYCLE_EMAIL_OUTBOX_TOPIC)
  assert.equal(JSON.stringify(appended[0]?.payload).includes('@'), false)
})

test('delivery resolves the recipient at send time and audits the provider id without storing email', async () => {
  const audit = new CapturingAuditRepository()
  const sent: Array<{ idempotencyKey: string; to: string }> = []
  const provider: EmailProvider = {
    name: 'ses',
    send: async (message) => {
      sent.push({ idempotencyKey: message.idempotencyKey, to: message.to })
      return { provider: 'ses', providerMessageId: 'ses_1', status: 'sent' }
    },
  }
  const delivery = new EmailOutboxDelivery({
    audit: new AuditService(audit),
    config: emailConfig(),
    provider,
    recipients: { getEmail: async () => 'person@example.com' },
    suppressions: new MemorySuppressions(),
  })

  await delivery.deliver(outboxEvent())

  assert.deepEqual(sent, [{
    idempotencyKey: 'user.created:workos:user_1',
    to: 'person@example.com',
  }])
  assert.equal(audit.events[0]?.action, 'email.delivery.sent')
  assert.equal(audit.events[0]?.metadata.providerMessageId, 'ses_1')
  assert.equal(JSON.stringify(audit.events).includes('person@example.com'), false)
})

test('suppressed users are audited and never sent', async () => {
  const audit = new CapturingAuditRepository()
  let sends = 0
  const suppressions = new MemorySuppressions()
  await suppressions.suppress({
    reason: 'complaint',
    source: 'provider',
    suppressedAt: 1,
    userId: 'user_1',
  })
  const delivery = new EmailOutboxDelivery({
    audit: new AuditService(audit),
    config: emailConfig(),
    provider: {
      name: 'ses',
      send: async () => {
        sends += 1
        return { provider: 'ses', status: 'sent' }
      },
    },
    recipients: { getEmail: async () => 'person@example.com' },
    suppressions,
  })

  await delivery.deliver(outboxEvent())

  assert.equal(sends, 0)
  assert.equal(audit.events[0]?.action, 'email.delivery.suppressed')
  assert.equal(audit.events[0]?.outcome, 'denied')
})

function emailConfig() {
  return parseOverlayRuntimeConfig({
    ...DEFAULT_OVERLAY_RUNTIME_CONFIG,
    app: {
      ...DEFAULT_OVERLAY_RUNTIME_CONFIG.app,
      baseUrl: 'http://localhost:3000',
      deploymentEnvironment: 'test',
    },
    providers: {
      ...DEFAULT_OVERLAY_RUNTIME_CONFIG.providers,
      email: { provider: 'ses' },
    },
    email: {
      provider: 'ses',
      from: 'Overlay <hello@getoverlay.io>',
      ses: {
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        region: 'us-east-1',
      },
      smtp: {},
    },
  })
}

function outboxEvent() {
  return {
    attempts: 1,
    id: 'email_lifecycle_1',
    maxAttempts: 8,
    payload: {
      attributes: { authProvider: 'workos' },
      idempotencyKey: 'user.created:workos:user_1',
      name: 'user.created',
      resource: { id: 'user_1', type: 'user' },
      userId: 'user_1',
    },
    topic: LIFECYCLE_EMAIL_OUTBOX_TOPIC,
  }
}

class CapturingAuditRepository implements AuditRepository {
  readonly events: AuditEventRecord[] = []

  async append(args: Parameters<AuditRepository['append']>[0]): Promise<AuditEventRecord> {
    const event = { ...args, createdAt: args.createdAt ?? Date.now(), id: args.id ?? 'audit_1' }
    this.events.push(event)
    return event
  }

  async list(): Promise<AuditEventRecord[]> {
    return [...this.events]
  }
}

class MemorySuppressions implements EmailSuppressionRepository {
  private readonly values = new Map<string, EmailSuppression>()

  async clear(userId: string): Promise<boolean> {
    return this.values.delete(userId)
  }

  async get(userId: string): Promise<EmailSuppression | null> {
    return this.values.get(userId) ?? null
  }

  async suppress(value: EmailSuppression): Promise<void> {
    this.values.set(value.userId, value)
  }
}
