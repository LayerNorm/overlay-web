import 'server-only'

import { eq } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { userSettings } from '@/server/database/postgres/schema'
import type {
  ChatSuggestionRepository,
  ChatSuggestionSnapshot,
} from './ChatSuggestionRepository'

export class PostgresChatSuggestionRepository implements ChatSuggestionRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async getByUserId(userId: string): Promise<ChatSuggestionSnapshot | null> {
    const [row] = await this.db
      .select({
        day: userSettings.chatSuggestionDay,
        prompts: userSettings.chatSuggestions,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1)
    if (!row?.day || !row.prompts || row.prompts.length === 0) return null
    return { day: row.day, prompts: row.prompts }
  }

  async setForUser(args: ChatSuggestionSnapshot & { userId: string }): Promise<boolean> {
    const now = new Date()
    await this.db
      .insert(userSettings)
      .values({
        chatSuggestionDay: args.day,
        chatSuggestions: args.prompts,
        createdAt: now,
        updatedAt: now,
        userId: args.userId,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          chatSuggestionDay: args.day,
          chatSuggestions: args.prompts,
          updatedAt: now,
        },
      })
    return true
  }
}
