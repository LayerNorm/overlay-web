import 'server-only'

import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'

export interface EmailRecipientRepository {
  getEmail(userId: string): Promise<string | null>
}

export class PostgresEmailRecipientRepository implements EmailRecipientRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getEmail(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    return row?.email?.trim().toLowerCase() ?? null
  }
}
