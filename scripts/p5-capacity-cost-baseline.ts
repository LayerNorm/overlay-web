import { createOverlayPostgresPool } from '../src/server/database/postgres/client'

async function main(): Promise<void> {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 2,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })

  try {
    const [database, tables, queue] = await Promise.all([
      pool.query<{
        active_connections: number
        database_size_bytes: string
        max_connections: string
      }>(`
      SELECT
        pg_database_size(current_database())::text AS database_size_bytes,
        current_setting('max_connections') AS max_connections,
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS active_connections
    `),
      pool.query<{ name: string; total_bytes: string }>(`
      SELECT relname AS name, pg_total_relation_size(relid)::text AS total_bytes
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 15
    `),
      pool.query<{
        dead_letter_count: number
        queued_count: number
        running_count: number
      }>(`
      SELECT
        count(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        count(*) FILTER (WHERE status = 'running')::int AS running_count,
        count(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count
      FROM durable_jobs
    `),
    ])
    const costCategories = ['ecs', 'rds', 'redis', 'alb', 'nat', 's3', 'cloudwatch', 'backup', 'data_transfer']
    const costs = Object.fromEntries(
      costCategories.map((category) => {
        const raw = process.env[`P5_MONTHLY_COST_${category.toUpperCase()}_USD`]
        const parsed = Number(raw)
        return [category, Number.isFinite(parsed) && parsed >= 0 ? parsed : null]
      }),
    )
    const missingCostCategories = Object.entries(costs)
      .filter(([, value]) => value === null)
      .map(([key]) => key)
    if (process.env.P5_REQUIRE_COMPLETE_COST_BASELINE === 'true' && missingCostCategories.length > 0) {
      throw new Error(`Missing monthly cost inputs: ${missingCostCategories.join(', ')}`)
    }
    const totalMonthlyCostUsd = Object.values(costs).reduce<number>(
      (sum, value) => sum + (typeof value === 'number' ? value : 0),
      0,
    )
    const db = database.rows[0]
    const jobQueue = queue.rows[0]
    console.log(
      JSON.stringify(
        {
          ok: true,
          capturedAt: new Date().toISOString(),
          capacity: {
            activeConnections: Number(db?.active_connections ?? 0),
            databaseSizeBytes: Number(db?.database_size_bytes ?? 0),
            maxConnections: Number(db?.max_connections ?? 0),
            largestTables: tables.rows.map((row) => ({
              name: row.name,
              totalBytes: Number(row.total_bytes),
            })),
            jobQueue: {
              deadLetterCount: Number(jobQueue?.dead_letter_count ?? 0),
              queuedCount: Number(jobQueue?.queued_count ?? 0),
              runningCount: Number(jobQueue?.running_count ?? 0),
            },
          },
          cost: {
            categories: costs,
            missingCostCategories,
            totalMonthlyCostUsd,
          },
        },
        null,
        2,
      ),
    )
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
