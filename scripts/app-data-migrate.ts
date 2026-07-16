import { migrate } from 'drizzle-orm/node-postgres/migrator'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import {
  APP_DATA_MIGRATION_LOCK_ID,
  APP_DATA_MINIMUM_SCHEMA_VERSION,
  APP_DATA_SCHEMA_VERSION,
  assertAppDataSchemaCompatible,
} from '../src/server/database/postgres/schema-compatibility'

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to migrate the Overlay app-data database')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const lockClient = await pool.connect()

  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [APP_DATA_MIGRATION_LOCK_ID])
    await migrate(db, {
      migrationsFolder: 'migrations/app-data',
    })
    await pool.query(`
      INSERT INTO overlay_app_data_metadata (key, value)
      VALUES
        ('schema_version', $1),
        ('schema_min_compatible_version', $2)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now()
    `, [String(APP_DATA_SCHEMA_VERSION), String(APP_DATA_MINIMUM_SCHEMA_VERSION)])
    await assertAppDataSchemaCompatible(pool)
    console.log(JSON.stringify({
      ok: true,
      schemaVersion: APP_DATA_SCHEMA_VERSION,
      message: 'Overlay app-data Postgres migrations are up to date.',
    }, null, 2))
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [APP_DATA_MIGRATION_LOCK_ID]).catch(() => {})
    lockClient.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
