export type EmailProviderName = 'ses' | 'smtp' | 'none'

export type TransactionalEmail = {
  from: string
  to: string
  subject: string
  text: string
  html: string
  replyTo?: string
  idempotencyKey: string
}

export type EmailProviderResult = {
  provider: EmailProviderName
  providerMessageId?: string
  status: 'sent' | 'skipped'
}

export interface EmailProvider {
  readonly name: EmailProviderName
  send(message: TransactionalEmail): Promise<EmailProviderResult>
}
