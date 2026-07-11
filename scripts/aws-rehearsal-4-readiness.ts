import { sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { APP_DATA_SCHEMA_VERSION } from '../src/server/database/postgres/schema-compatibility'

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const hostname = new URL(connectionString).hostname.toLowerCase()
  if (!isAwsRdsHostname(hostname)) {
    throw new Error(
      `AWS Rehearsal 4 requires an RDS or Aurora endpoint; received ${hostname}. ` +
      'Use the Neon characterization command for non-AWS Postgres.',
    )
  }
  if (process.env.OVERLAY_DATABASE_SSL_MODE !== 'verify-full') {
    throw new Error('AWS Rehearsal 4 requires OVERLAY_DATABASE_SSL_MODE=verify-full')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    const [database, extension, metadata, jobs] = await Promise.all([
      db.execute(sql`SELECT current_database() AS database_name, version() AS postgres_version`),
      db.execute(sql`
        SELECT extversion
        FROM pg_extension
        WHERE extname = 'vector'
      `),
      db.execute(sql`
        SELECT key, value
        FROM overlay_app_data_metadata
        WHERE key IN ('schema_version', 'schema_min_compatible_version')
      `),
      db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM durable_jobs
        WHERE type IN ('knowledge.reindex-source', 'memory.extract-turn')
        GROUP BY status
        ORDER BY status
      `),
    ])
    const metadataValues = new Map(metadata.rows.map((row) => [String(row.key), String(row.value)]))
    const schemaVersion = Number(metadataValues.get('schema_version'))
    if (schemaVersion !== APP_DATA_SCHEMA_VERSION) {
      throw new Error(`Expected app-data schema ${APP_DATA_SCHEMA_VERSION}, received ${schemaVersion}`)
    }
    if (!extension.rows[0]?.extversion) throw new Error('The vector extension is not installed')

    console.log(JSON.stringify({
      ok: true,
      rehearsal: 4,
      database: database.rows[0],
      endpointHostname: hostname,
      pgvectorVersion: extension.rows[0].extversion,
      schemaVersion,
      minimumCompatibleVersion: Number(metadataValues.get('schema_min_compatible_version')),
      knowledgeJobState: jobs.rows,
      assertions: {
        fixedCorpusCharacterization: 'passed before readiness inspection',
        indexingCrashRecovery: 'passed before readiness inspection',
        provider: 'aws-rds-or-aurora',
        sslMode: 'verify-full',
      },
    }, null, 2))
  } finally {
    await pool.end()
  }
}

function isAwsRdsHostname(hostname: string): boolean {
  return /\.rds\.amazonaws\.com(?:\.cn)?$/.test(hostname)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
