import { sql } from 'drizzle-orm'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'

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

    console.log(JSON.stringify({
      ok: true,
      databaseName: version.rows[0]?.database_name,
      schemaKind,
      tableCount: tableNames.size,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
