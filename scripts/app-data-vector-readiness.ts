import { sql } from 'drizzle-orm'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to check pgvector readiness')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)

  try {
    const database = await db.execute(sql`
      SELECT current_database() AS database_name, version() AS postgres_version
    `)
    const extension = await db.execute(sql`
      SELECT name, default_version, installed_version
      FROM pg_available_extensions
      WHERE name = 'vector'
      LIMIT 1
    `)

    const row = extension.rows[0]
    if (!row) {
      throw new Error(
        'pgvector extension is not available in this Postgres deployment. Postgres-native knowledge search requires a provider that exposes the vector extension.',
      )
    }

    console.log(JSON.stringify({
      ok: true,
      provider: 'pgvector',
      databaseName: database.rows[0]?.database_name,
      postgresVersion: database.rows[0]?.postgres_version,
      extensionAvailable: true,
      extensionInstalled: row.installed_version != null,
      defaultVersion: row.default_version,
      installedVersion: row.installed_version,
      note: row.installed_version
        ? 'pgvector is installed. Configure vectorSearch.provider=pgvector, select an embeddings provider, and run the worker.'
        : 'pgvector is available but not installed. Run the app-data migration before enabling vector search.',
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
