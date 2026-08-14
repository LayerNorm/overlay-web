import { createOverlayPostgresPool } from '../src/server/database/postgres/client'
import {
  APP_DATA_MIGRATION_LOCK_ID,
  APP_DATA_MINIMUM_SCHEMA_VERSION,
  APP_DATA_SCHEMA_VERSION,
  evaluateAppDataSchemaCompatibility,
  readAppDataSchemaCompatibility,
} from '../src/server/database/postgres/schema-compatibility'

async function main(): Promise<void> {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 3,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })

  try {
    const current = await readAppDataSchemaCompatibility(pool)
    if (!current.compatible) throw new Error('Current runtime is not compatible with the database')
    const previousMaximum = numberValue(process.env.P5_PREVIOUS_RUNTIME_MAX_SCHEMA, APP_DATA_SCHEMA_VERSION - 1)
    const previousMinimum = numberValue(process.env.P5_PREVIOUS_RUNTIME_MIN_SCHEMA, APP_DATA_MINIMUM_SCHEMA_VERSION - 1)
    const previousRuntime = evaluateAppDataSchemaCompatibility({
      databaseMinimumRuntimeVersion: current.databaseMinimumRuntimeVersion,
      databaseSchemaVersion: current.databaseSchemaVersion,
      runtimeMaximumSchemaVersion: previousMaximum,
      runtimeMinimumSchemaVersion: previousMinimum,
    })
    const expectPreviousRuntimeCompatibility = process.env.P5_EXPECT_ROLLBACK_COMPATIBLE === undefined
      ? previousMaximum >= APP_DATA_MINIMUM_SCHEMA_VERSION
      : process.env.P5_EXPECT_ROLLBACK_COMPATIBLE === '1'
    if (previousRuntime.compatible !== expectPreviousRuntimeCompatibility) {
      throw new Error(
        `Previous runtime compatibility was ${previousRuntime.compatible}, expected ` +
          `${expectPreviousRuntimeCompatibility}, for database ${current.databaseSchemaVersion} ` +
          `(minimum runtime ${current.databaseMinimumRuntimeVersion})`,
      )
    }

    const first = await pool.connect()
    const second = await pool.connect()
    try {
      await first.query('SELECT pg_advisory_lock($1)', [APP_DATA_MIGRATION_LOCK_ID])
      const competing = await second.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
        APP_DATA_MIGRATION_LOCK_ID,
      ])
      if (competing.rows[0]?.locked !== false)
        throw new Error('Migration advisory lock did not exclude a competing migrator')
    } finally {
      await first.query('SELECT pg_advisory_unlock($1)', [APP_DATA_MIGRATION_LOCK_ID]).catch(() => {})
      first.release()
      second.release()
    }

    console.log(JSON.stringify({
      ok: true,
      current,
      previousRuntime,
      expectPreviousRuntimeCompatibility,
      migrationLockExclusive: true,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

function numberValue(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
