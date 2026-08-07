'use node'

import { createEmailClient } from '@opencoredev/email-sdk'
import { ses } from '@opencoredev/email-sdk/ses'
import { smtp } from '@opencoredev/email-sdk/smtp'
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { internalAction, type ActionCtx } from '../_generated/server'
import type { EmailProvider, LifecycleEmailEvent } from '../../src/shared/email'
import { renderLifecycleEmail } from '../../src/shared/email'

const WORKER_ID = 'convex-email-runner-v1'

export const runMinuteTick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (emailProviderName() === 'none') return null
    const ids = await ctx.runMutation(internal.email.outbox.claimDueInternal, {
      limit: 25,
      now: Date.now(),
      workerId: WORKER_ID,
    })
    for (const outboxId of ids) {
      await ctx.scheduler.runAfter(0, internal.email.deliveryRunner.deliverOne, { outboxId })
    }
    return null
  },
})

export const deliverOne = internalAction({
  args: { outboxId: v.id('emailOutbox') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.email.outbox.getDeliveryInternal, args)
    if (!job) return null
    const event = parseEvent(job.payloadJson)
    if (job.suppression) {
      await ctx.runMutation(internal.email.outbox.markDeliveryPublishedInternal, {
        action: 'email.delivery.suppressed',
        outboxId: job.outboxId,
        outcome: 'denied',
        provider: emailProviderName(),
        template: event.name,
        userId: event.userId,
      })
      return null
    }

    if (typeof job.recipient !== 'string' || !job.recipient.trim()) {
      await markFailed(ctx, job.outboxId, event, new Error('Transactional email recipient is unavailable'))
      return null
    }

    try {
      const provider = createProvider()
      const content = renderLifecycleEmail(
        event,
        process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://getoverlay.io',
      )
      const from = requiredEnv('OVERLAY_EMAIL_FROM')
      const result = await provider.send({
        from,
        to: job.recipient.trim().toLowerCase(),
        subject: content.subject,
        text: content.text,
        html: content.html,
        replyTo: process.env.OVERLAY_EMAIL_REPLY_TO?.trim() || undefined,
        idempotencyKey: event.idempotencyKey,
      })
      await ctx.runMutation(internal.email.outbox.markDeliveryPublishedInternal, {
        action: 'email.delivery.sent',
        outboxId: job.outboxId,
        outcome: 'success',
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        template: event.name,
        userId: event.userId,
      })
    } catch (error) {
      await markFailed(ctx, job.outboxId, event, error)
    }
    return null
  },
})

async function markFailed(
  ctx: ActionCtx,
  outboxId: Id<'emailOutbox'>,
  event: LifecycleEmailEvent,
  error: unknown,
): Promise<void> {
  await ctx.runMutation(internal.email.outbox.markDeliveryFailedInternal, {
    error: summarizeError(error),
    outboxId,
    provider: emailProviderName(),
    suppress: isProviderSuppression(error),
    template: event.name,
    userId: event.userId,
  })
}

function createProvider(): EmailProvider {
  const name = emailProviderName()
  if (name === 'ses') {
    const client = createEmailClient({
      adapters: [ses({
        accessKeyId: requiredEnv('OVERLAY_EMAIL_SES_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnv('OVERLAY_EMAIL_SES_SECRET_ACCESS_KEY'),
        sessionToken: process.env.OVERLAY_EMAIL_SES_SESSION_TOKEN?.trim() || undefined,
        region: requiredEnv('OVERLAY_EMAIL_SES_REGION'),
        configurationSetName: process.env.OVERLAY_EMAIL_SES_CONFIGURATION_SET?.trim() || undefined,
      })],
      defaultAdapter: 'ses',
      retry: { maxAttempts: 1 },
      telemetry: false,
    })
    return {
      name,
      send: async (message) => {
        const result = await client.send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo: message.replyTo,
        }, { idempotencyKey: message.idempotencyKey })
        return { provider: name, providerMessageId: result.id, status: 'sent' }
      },
    }
  }
  if (name === 'smtp') {
    const username = process.env.OVERLAY_EMAIL_SMTP_USERNAME?.trim()
    const password = process.env.OVERLAY_EMAIL_SMTP_PASSWORD?.trim()
    const client = createEmailClient({
      adapters: [smtp({
        host: requiredEnv('OVERLAY_EMAIL_SMTP_HOST'),
        port: numberEnv('OVERLAY_EMAIL_SMTP_PORT', 465),
        secure: booleanEnv('OVERLAY_EMAIL_SMTP_SECURE', true),
        requireTLS: true,
        allowInsecureAuth: false,
        auth: username && password ? { user: username, pass: password } : undefined,
      })],
      defaultAdapter: 'smtp',
      retry: { maxAttempts: 1 },
      telemetry: false,
    })
    return {
      name,
      send: async (message) => {
        const result = await client.send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo: message.replyTo,
        }, { idempotencyKey: message.idempotencyKey })
        return { provider: name, providerMessageId: result.id, status: 'sent' }
      },
    }
  }
  throw new Error('Transactional email provider is disabled')
}

function emailProviderName(): 'ses' | 'smtp' | 'none' {
  const value = process.env.OVERLAY_EMAIL_PROVIDER?.trim().toLowerCase() || 'none'
  if (value === 'ses' || value === 'smtp' || value === 'none') return value
  throw new Error('OVERLAY_EMAIL_PROVIDER must be ses, smtp, or none')
}

function parseEvent(payloadJson: string): LifecycleEmailEvent {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  const allowed = [
    'user.created',
    'subscription.changed',
    'topup.succeeded',
    'automation.failed',
    'api_key.changed',
  ]
  if (!allowed.includes(String(value.name))) throw new Error('Unsupported lifecycle email event')
  return {
    attributes: recordValue(value.attributes),
    idempotencyKey: requiredString(value.idempotencyKey, 'idempotencyKey'),
    name: value.name as LifecycleEmailEvent['name'],
    resource: recordValue(value.resource),
    userId: requiredString(value.userId, 'userId'),
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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function summarizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_096)
}

function isProviderSuppression(error: unknown): boolean {
  return /suppression list|suppressed destination|bounce|complaint/i.test(summarizeError(error))
}
