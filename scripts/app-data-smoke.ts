import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { users } from '../src/server/database/postgres/schema'
import { PostgresActConversationRepository } from '../src/server/conversations/PostgresActConversationRepository'
import { UnlimitedUsagePolicy } from '../src/server/conversations/ActUsagePolicy'
import { PostgresUserRepository } from '../src/server/users'

const REQUIRED_TABLES = [
  'auth_identities',
  'conversation_context_summaries',
  'conversation_message_deltas',
  'conversation_messages',
  'conversations',
  'files',
  'notes',
  'onboarding_state',
  'overlay_app_data_metadata',
  'projects',
  'r2_upload_intents',
  'user_settings',
  'users',
] as const

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to smoke-test the Overlay app-data database')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)

  try {
    const metadata = await db.execute(sql`
      SELECT value
      FROM overlay_app_data_metadata
      WHERE key = 'schema_kind'
      LIMIT 1
    `)
    const schemaKind = metadata.rows[0]?.value
    if (schemaKind !== 'overlay-app-data') {
      throw new Error('Overlay app-data metadata marker is missing. Run npm run app-db:migrate first.')
    }

    const tables = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN (${sql.join(REQUIRED_TABLES.map((tableName) => sql`${tableName}`), sql`, `)})
      ORDER BY table_name
    `)
    const tableNames = new Set(tables.rows.map((row) => String(row.table_name)))
    const missingTables = REQUIRED_TABLES.filter((tableName) => !tableNames.has(tableName))
    if (missingTables.length > 0) {
      throw new Error(`Overlay app-data schema is missing tables: ${missingTables.join(', ')}`)
    }

    const version = await db.execute(sql`SELECT current_database() AS database_name, version() AS postgres_version`)
    const verticalSlice = await smokeChatVerticalSlice(db)

    console.log(JSON.stringify({
      ok: true,
      databaseName: version.rows[0]?.database_name,
      schemaKind,
      tableCount: tableNames.size,
      verticalSlice,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

async function smokeChatVerticalSlice(db: ReturnType<typeof createOverlayPostgresDb>) {
  const userId = `smoke_user_${randomUUID()}`
  const email = `${userId}@example.com`
  const usersRepository = new PostgresUserRepository(db)
  const conversationsRepository = new PostgresActConversationRepository(db)
  const usagePolicy = new UnlimitedUsagePolicy()

  try {
    await usersRepository.upsertFromIdentity({
      identity: {
        provider: 'better-auth',
        subject: userId,
        email,
      },
      now: new Date(),
      user: {
        id: userId,
        email,
        firstName: 'Smoke',
        lastName: 'User',
        emailVerified: true,
      },
    })

    const entitlements = await usagePolicy.getEntitlements({ userId })
    if (entitlements.planKind !== 'paid') {
      throw new Error('UnlimitedUsagePolicy did not return paid entitlements')
    }

    const conversationId = await conversationsRepository.createConversation({
      userId,
      title: 'Postgres smoke chat',
      askModelIds: ['openrouter/free'],
      actModelId: 'openrouter/free',
      lastMode: 'act',
      clientId: `smoke_${randomUUID()}`,
    })
    await conversationsRepository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_1',
      role: 'user',
      mode: 'act',
      content: 'hello',
      contentType: 'text',
      parts: [{ type: 'text', text: 'hello' }],
      modelId: 'openrouter/free',
    })
    const assistantMessageId = await conversationsRepository.startGeneratingMessage({
      conversationId,
      userId,
      turnId: 'turn_1',
      mode: 'act',
      modelId: 'openrouter/free',
    })
    if (!assistantMessageId) {
      throw new Error('Failed to create generating assistant message')
    }
    await conversationsRepository.finalizeGeneratingMessage({
      messageId: assistantMessageId,
      content: 'hello back',
      parts: [{ type: 'text', text: 'hello back' }],
      tokens: { input: 1, output: 2 },
    })
    const messages = await conversationsRepository.getConversationMessages({
      conversationId,
      userId,
    })
    if (messages.length !== 2 || messages[1]?.content !== 'hello back') {
      throw new Error(`Unexpected Postgres chat messages after smoke write: ${messages.length}`)
    }

    return {
      ok: true,
      conversationId,
      messageCount: messages.length,
      usagePolicy: 'unlimited',
    }
  } finally {
    await db.delete(users).where(eq(users.id, userId))
  }
}
