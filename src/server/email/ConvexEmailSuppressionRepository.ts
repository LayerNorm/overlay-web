import 'server-only'

import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { EmailSuppression, EmailSuppressionRepository } from './EmailSuppressionRepository'

export class ConvexEmailSuppressionRepository implements EmailSuppressionRepository {
  async clear(userId: string): Promise<boolean> {
    const { convex } = await import('@/server/database/convex')
    return (await convex.mutation<boolean>('email/outbox:clearSuppressionByServer', {
      serverSecret: getInternalApiSecret(),
      userId,
    }, { throwOnError: true })) ?? false
  }

  async get(userId: string): Promise<EmailSuppression | null> {
    const { convex } = await import('@/server/database/convex')
    const row = await convex.mutation<EmailSuppression | null>('email/outbox:getSuppressionByServer', {
      serverSecret: getInternalApiSecret(),
      userId,
    }, { throwOnError: true })
    return row
      ? {
          reason: row.reason,
          source: row.source,
          suppressedAt: row.suppressedAt,
          userId: row.userId,
        }
      : null
  }

  async suppress(suppression: EmailSuppression): Promise<void> {
    const { convex } = await import('@/server/database/convex')
    await convex.mutation('email/outbox:suppressByServer', {
      ...suppression,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
  }
}
