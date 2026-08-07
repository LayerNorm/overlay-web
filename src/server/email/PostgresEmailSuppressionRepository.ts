import 'server-only'

import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { emailSuppressions } from '@/server/database/postgres/schema'
import type { EmailSuppression, EmailSuppressionRepository } from './EmailSuppressionRepository'

export class PostgresEmailSuppressionRepository implements EmailSuppressionRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async clear(userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(emailSuppressions)
      .where(eq(emailSuppressions.userId, requiredUserId(userId)))
      .returning({ userId: emailSuppressions.userId })
    return deleted.length > 0
  }

  async get(userId: string): Promise<EmailSuppression | null> {
    const [row] = await this.db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.userId, requiredUserId(userId)))
      .limit(1)
    return row
      ? {
          reason: row.reason,
          source: row.source,
          suppressedAt: row.suppressedAt.getTime(),
          userId: row.userId,
        }
      : null
  }

  async suppress(suppression: EmailSuppression): Promise<void> {
    const suppressedAt = new Date(suppression.suppressedAt)
    await this.db
      .insert(emailSuppressions)
      .values({
        reason: suppression.reason,
        source: suppression.source,
        suppressedAt,
        updatedAt: suppressedAt,
        userId: requiredUserId(suppression.userId),
      })
      .onConflictDoUpdate({
        target: emailSuppressions.userId,
        set: {
          reason: suppression.reason,
          source: suppression.source,
          suppressedAt,
          updatedAt: suppressedAt,
        },
      })
  }
}

function requiredUserId(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('userId is required')
  return normalized
}
