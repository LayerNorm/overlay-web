import 'server-only'

import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { conversationEvents } from '@/server/database/postgres/schema'
import type { ConversationEventRow } from './ActConversationRepository'
import { CONVERSATION_EVENT_NOTIFY_CHANNEL } from './PostgresConversationEventNotifier'

export async function emitPostgresConversationEvent(
  db: Pick<OverlayPostgresDb, 'execute' | 'insert'>,
  event: {
    conversationId: string
    messageId?: string
    payload?: Record<string, unknown>
    type: ConversationEventRow['type']
    userId: string
  },
): Promise<void> {
  await db.insert(conversationEvents).values({
    userId: event.userId,
    conversationId: event.conversationId,
    type: event.type,
    messageId: event.messageId,
    payload: event.payload,
  })
  await db.execute(sql`SELECT pg_notify(${CONVERSATION_EVENT_NOTIFY_CHANNEL}, ${event.userId})`)
}
