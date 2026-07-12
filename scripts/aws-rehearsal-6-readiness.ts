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
  if (!/\.rds\.amazonaws\.com(?:\.cn)?$/.test(hostname)) {
    throw new Error(`AWS Rehearsal 6 requires an RDS or Aurora endpoint; received ${hostname}`)
  }
  if (process.env.OVERLAY_DATABASE_SSL_MODE !== 'verify-full') {
    throw new Error('AWS Rehearsal 6 requires OVERLAY_DATABASE_SSL_MODE=verify-full')
  }
  if (process.env.OVERLAY_BACKGROUND_RUNTIME_ENABLED !== 'true') {
    throw new Error('AWS Rehearsal 6 requires OVERLAY_BACKGROUND_RUNTIME_ENABLED=true')
  }
  if (!process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()) {
    throw new Error('AWS Rehearsal 6 requires INTERNAL_SERVICE_AUTH_SECRET')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    const [metadata, schedules, jobs, deliveries, attempts] = await Promise.all([
      db.execute(sql`
        SELECT key, value
        FROM overlay_app_data_metadata
        WHERE key IN ('schema_version', 'schema_min_compatible_version')
      `),
      db.execute(sql`
        SELECT id, enabled, last_enqueued_at, next_run_at
        FROM scheduled_tasks
        WHERE id IN ('automation-schedule-due', 'daytona-reconciliation')
        ORDER BY id
      `),
      db.execute(sql`
        SELECT type, status, count(*)::int AS count,
          min(available_at) AS oldest_available_at
        FROM durable_jobs
        WHERE type IN ('automation.execute', 'automation.schedule-due', 'webhook.deliver', 'daytona.reconcile')
        GROUP BY type, status
        ORDER BY type, status
      `),
      db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM webhook_deliveries
        GROUP BY status
        ORDER BY status
      `),
      db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM automation_run_attempts
        GROUP BY status
        ORDER BY status
      `),
    ])
    const values = new Map(metadata.rows.map((row) => [String(row.key), String(row.value)]))
    const schemaVersion = Number(values.get('schema_version'))
    if (schemaVersion !== APP_DATA_SCHEMA_VERSION) {
      throw new Error(`Expected app-data schema ${APP_DATA_SCHEMA_VERSION}, received ${schemaVersion}`)
    }
    const scheduleIds = new Set(schedules.rows.map((row) => String(row.id)))
    for (const required of ['automation-schedule-due', 'daytona-reconciliation']) {
      if (!scheduleIds.has(required)) throw new Error(`Required scheduler registration is missing: ${required}`)
    }

    console.log(JSON.stringify({
      assertions: {
        backgroundRuntimeDeclared: true,
        provider: 'aws-rds-or-aurora',
        serviceAuthConfigured: true,
        sslMode: 'verify-full',
      },
      automationAttemptState: attempts.rows,
      endpointHostname: hostname,
      jobState: jobs.rows,
      minimumCompatibleVersion: Number(values.get('schema_min_compatible_version')),
      ok: true,
      rehearsal: 6,
      scheduledTasks: schedules.rows,
      schemaVersion,
      webhookDeliveryState: deliveries.rows,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
