import { randomUUID } from 'node:crypto'
import { createOverlayPostgresPool } from '../src/server/database/postgres/client'
import { assertAppDataSchemaCompatible } from '../src/server/database/postgres/schema-compatibility'

async function main(): Promise<void> {
  const mode = valueArg('mode')
  if (mode !== 'prepare' && mode !== 'verify') {
    throw new Error('Use --mode=prepare before the snapshot and --mode=verify against the restored database')
  }
  const connectionString = required('OVERLAY_DATABASE_URL')
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 2,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })

  try {
    await assertAppDataSchemaCompatible(pool)
    if (mode === 'prepare') {
      const drillId = process.env.P5_BACKUP_DRILL_ID?.trim() || randomUUID()
      await pool.query(
        `
        INSERT INTO overlay_app_data_metadata (key, value)
        VALUES
          ('p5_backup_drill_id', $1),
          ('p5_backup_drill_created_at', $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `,
        [drillId, new Date().toISOString()],
      )
      console.log(JSON.stringify({ ok: true, mode, drillId, ...(await databaseEvidence(pool)) }, null, 2))
    } else {
      const expected = required('P5_BACKUP_DRILL_ID')
      const marker = await pool.query<{ value: string }>(
        `SELECT value FROM overlay_app_data_metadata WHERE key = 'p5_backup_drill_id'`,
      )
      if (marker.rows[0]?.value !== expected) {
        throw new Error(`Restored database does not contain backup marker ${expected}`)
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode,
            drillId: expected,
            ...(await databaseEvidence(pool)),
          },
          null,
          2,
        ),
      )
    }
  } finally {
    await pool.end()
  }
}

async function databaseEvidence(pool: ReturnType<typeof createOverlayPostgresPool>) {
  const result = await pool.query<{
    database_name: string
    database_size_bytes: string
    user_count: number
  }>(`
    SELECT
      current_database() AS database_name,
      pg_database_size(current_database())::text AS database_size_bytes,
      (SELECT count(*)::int FROM users) AS user_count
  `)
  const row = result.rows[0]
  return {
    databaseName: row?.database_name,
    databaseSizeBytes: Number(row?.database_size_bytes ?? 0),
    userCount: Number(row?.user_count ?? 0),
  }
}

function valueArg(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
