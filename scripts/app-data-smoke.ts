import { sql } from 'drizzle-orm'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'

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

    const version = await db.execute(sql`SELECT current_database() AS database_name, version() AS postgres_version`)

    console.log(JSON.stringify({
      ok: true,
      databaseName: version.rows[0]?.database_name,
      schemaKind,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
