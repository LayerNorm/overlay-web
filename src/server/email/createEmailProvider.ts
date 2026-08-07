import 'server-only'

import type { OverlayRuntimeConfig } from '@/shared/config'
import type {
  EmailProvider,
  EmailProviderResult,
  TransactionalEmail,
} from '@/shared/email'
import { loadEmailSdk } from './email-sdk-loader.cjs'

export async function createEmailProvider(config: OverlayRuntimeConfig): Promise<EmailProvider> {
  const selected = config.providers.email?.provider ?? config.email?.provider ?? 'none'
  if (selected === 'none') return new NoOpEmailProvider()
  if (!config.email) throw new Error('Email configuration is required')
  const { createEmailClient, ses, smtp } = await loadEmailSdk()

  if (selected === 'ses') {
    const options = config.email.ses
    if (!options.accessKeyId || !options.secretAccessKey || !options.region) {
      throw new Error('SES email credentials and region are required')
    }
    return new EmailSdkProvider('ses', createEmailClient({
      adapters: [ses({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
        region: options.region,
        configurationSetName: options.configurationSetName,
      })],
      defaultAdapter: 'ses',
      retry: { maxAttempts: 1 },
      telemetry: false,
    }))
  }

  const options = config.email.smtp
  if (!options.host) throw new Error('SMTP host is required')
  return new EmailSdkProvider('smtp', createEmailClient({
    adapters: [smtp({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: true,
      allowInsecureAuth: false,
      auth: options.username && options.password
        ? { user: options.username, pass: options.password }
        : undefined,
    })],
    defaultAdapter: 'smtp',
    retry: { maxAttempts: 1 },
    telemetry: false,
  }))
}

type SdkClient = {
  send(message: {
    from: string
    to: string
    subject: string
    text: string
    html: string
    replyTo?: string
  }, options: { idempotencyKey: string }): Promise<{ id?: string }>
}

class EmailSdkProvider implements EmailProvider {
  constructor(
    readonly name: 'ses' | 'smtp',
    private readonly client: SdkClient,
  ) {}

  async send(message: TransactionalEmail): Promise<EmailProviderResult> {
    const result = await this.client.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
    }, { idempotencyKey: message.idempotencyKey })
    return {
      provider: this.name,
      providerMessageId: result.id,
      status: 'sent',
    }
  }
}

class NoOpEmailProvider implements EmailProvider {
  readonly name = 'none' as const

  async send(_message: TransactionalEmail): Promise<EmailProviderResult> {
    return { provider: this.name, status: 'skipped' }
  }
}
