import 'server-only'

import { Resend } from 'resend'

import { logger } from '@/server/observability/logger'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type EmailProvider = 'resend' | 'ses'

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string | string[]
  from?: string
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  provider: EmailProvider
  error?: string
}

interface EmailProviderAdapter {
  send(input: SendEmailInput): Promise<SendEmailResult>
}

// ─────────────────────────────────────────────────────────────────
// Env helpers
// ─────────────────────────────────────────────────────────────────

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function getProvider(): EmailProvider {
  const raw = readEnv('OVERLAY_EMAIL_PROVIDER').toLowerCase()
  if (raw === 'resend') return 'resend'
  if (raw === 'ses') return 'ses'
  // Default to resend if RESEND_API_KEY is present, otherwise ses
  if (readEnv('RESEND_API_KEY')) return 'resend'
  return 'ses'
}

function getDefaultFrom(): string {
  return readEnv('OVERLAY_EMAIL_FROM') || 'noreply@getoverlay.io'
}

function getDefaultReplyTo(): string | undefined {
  const replyTo = readEnv('OVERLAY_EMAIL_REPLY_TO')
  return replyTo || undefined
}

// ─────────────────────────────────────────────────────────────────
// Resend adapter
// ─────────────────────────────────────────────────────────────────

let resendClient: Resend | null = null

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = readEnv('RESEND_API_KEY')
    if (!apiKey) throw new Error('RESEND_API_KEY is not set')
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

const resendAdapter: EmailProviderAdapter = {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const client = getResendClient()
      const from = input.from || getDefaultFrom()
      const replyTo = input.replyTo || getDefaultReplyTo()

      // Build payload — only include html/text when present so the
      // RequireAtLeastOne<EmailRenderOptions> union resolves correctly.
      const payload: Record<string, unknown> = {
        from,
        to: input.to,
        subject: input.subject,
      }
      if (input.html) payload.html = input.html
      if (input.text) payload.text = input.text
      if (replyTo) payload.replyTo = replyTo
      if (input.headers) payload.headers = input.headers
      if (input.tags) payload.tags = input.tags

      const { data, error } = await client.emails.send(
        payload as unknown as Parameters<typeof client.emails.send>[0],
      )

      if (error) {
        logger.error('[Email:Resend] Send failed:', error)
        return { success: false, provider: 'resend', error: error.message }
      }

      return { success: true, provider: 'resend', messageId: data?.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[Email:Resend] Exception:', message)
      return { success: false, provider: 'resend', error: message }
    }
  },
}

// ─────────────────────────────────────────────────────────────────
// SES adapter (uses AWS SDK v3 via @aws-sdk/client-sesv2, lazy-loaded)
// ─────────────────────────────────────────────────────────────────

let sesClient: import('@aws-sdk/client-sesv2').SESv2Client | null = null

async function getSesClient(): Promise<import('@aws-sdk/client-sesv2').SESv2Client> {
  if (!sesClient) {
    const { SESv2Client } = await import('@aws-sdk/client-sesv2')
    const region = readEnv('OVERLAY_EMAIL_SES_REGION') || 'us-east-1'
    const accessKeyId = readEnv('OVERLAY_EMAIL_SES_ACCESS_KEY_ID')
    const secretAccessKey = readEnv('OVERLAY_EMAIL_SES_SECRET_ACCESS_KEY')

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('SES credentials are not configured (OVERLAY_EMAIL_SES_ACCESS_KEY_ID / OVERLAY_EMAIL_SES_SECRET_ACCESS_KEY)')
    }

    sesClient = new SESv2Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return sesClient
}

const sesAdapter: EmailProviderAdapter = {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const { SendEmailCommand } = await import('@aws-sdk/client-sesv2')
      const client = await getSesClient()
      const from = input.from || getDefaultFrom()
      const replyTo = input.replyTo || getDefaultReplyTo()

      const command = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: {
          ToAddresses: Array.isArray(input.to) ? input.to : [input.to],
        },
        Content: {
          Simple: {
            Subject: { Data: input.subject },
            Body: {
              ...(input.html ? { Html: { Data: input.html } } : {}),
              ...(input.text ? { Text: { Data: input.text } } : {}),
            },
          },
        },
        ReplyToAddresses: replyTo
          ? Array.isArray(replyTo) ? replyTo : [replyTo]
          : undefined,
      })

      const response = await client.send(command)
      return { success: true, provider: 'ses', messageId: response.MessageId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[Email:SES] Send failed:', message)
      return { success: false, provider: 'ses', error: message }
    }
  },
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

function getAdapter(): EmailProviderAdapter {
  const provider = getProvider()
  return provider === 'resend' ? resendAdapter : sesAdapter
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return getAdapter().send(input)
}

export function getEmailProvider(): EmailProvider {
  return getProvider()
}

export function isEmailConfigured(): boolean {
  const provider = getProvider()
  if (provider === 'resend') return Boolean(readEnv('RESEND_API_KEY'))
  return Boolean(readEnv('OVERLAY_EMAIL_SES_ACCESS_KEY_ID') && readEnv('OVERLAY_EMAIL_SES_SECRET_ACCESS_KEY'))
}
