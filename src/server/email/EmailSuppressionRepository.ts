import 'server-only'

export type EmailSuppression = {
  reason: 'bounce' | 'complaint' | 'manual' | 'provider_suppression'
  source: 'admin' | 'provider'
  suppressedAt: number
  userId: string
}

export interface EmailSuppressionRepository {
  clear(userId: string): Promise<boolean>
  get(userId: string): Promise<EmailSuppression | null>
  suppress(suppression: EmailSuppression): Promise<void>
}
