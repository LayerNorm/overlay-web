import { sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '../src/server/database/postgres/client'
import { APP_DATA_SCHEMA_VERSION } from '../src/server/database/postgres/schema-compatibility'
import { TcpRedisRateLimitStore } from '../src/server/shared/providers/redis-rate-limiter'

type Profile = 'institution' | 'stripe'

async function main() {
  const profile = required('P7_REHEARSAL_PROFILE') as Profile
  if (profile !== 'institution' && profile !== 'stripe') {
    throw new Error('P7_REHEARSAL_PROFILE must be institution or stripe')
  }
  const connectionString = required('OVERLAY_DATABASE_URL')
  const hostname = new URL(connectionString).hostname.toLowerCase()
  if (!/\.rds\.amazonaws\.com(?:\.cn)?$/.test(hostname)) {
    throw new Error(`AWS Rehearsal 7 requires RDS or Aurora; received ${hostname}`)
  }
  assertEqual('OVERLAY_DATABASE_SSL_MODE', 'verify-full')
  assertEqual('OVERLAY_PROVIDER_DATABASE', 'postgres')
  assertEqual('OVERLAY_PROVIDER_RATE_LIMIT', 'redis')
  assertEqual('OVERLAY_REDIS_FAILURE_MODE', 'deny')
  assertEqual('OVERLAY_BACKGROUND_RUNTIME_ENABLED', 'true')
  assertMinimum('P7_REHEARSAL_WEB_TASK_COUNT', 2)
  assertMinimum('P7_REHEARSAL_WORKER_TASK_COUNT', 2)
  required('INTERNAL_SERVICE_AUTH_SECRET')

  const redisUrl = required('OVERLAY_REDIS_URL')
  const redisHost = new URL(redisUrl).hostname.toLowerCase()
  if (!redisHost.includes('.cache.amazonaws.com')) {
    throw new Error(`AWS Rehearsal 7 requires ElastiCache; received ${redisHost}`)
  }
  const redis = new TcpRedisRateLimitStore(redisUrl, `overlay:p7-rehearsal:${Date.now()}:`)
  try {
    const probe = await redis.take('readiness', 60_000)
    if (probe.count !== 1 || probe.ttlMs <= 0) throw new Error('ElastiCache atomic rate-limit probe failed')
  } finally {
    await redis.close()
  }

  if (profile === 'stripe') {
    assertEqual('BILLING_PROVIDER', 'stripe')
    const key = process.env.DEV_STRIPE_SECRET_KEY?.trim() || required('STRIPE_SECRET_KEY')
    if (!key.startsWith('sk_test_')) throw new Error('Stripe rehearsal must use an sk_test_ key')
    const webhook = process.env.DEV_STRIPE_WEBHOOK_SECRET?.trim() || required('STRIPE_WEBHOOK_SECRET')
    if (!webhook.startsWith('whsec_')) throw new Error('Stripe webhook secret must start with whsec_')
  } else {
    assertEqual('BILLING_PROVIDER', 'none')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    max: 4,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    const [metadata, usage, reservations, providerEvents, apiKeys, audits, administrators] = await Promise.all([
      db.execute(sql`SELECT key, value FROM overlay_app_data_metadata WHERE key IN ('schema_version', 'schema_min_compatible_version')`),
      db.execute(sql`SELECT mode, count(*)::int AS count, sum(included_micros + granted_micros)::text AS total_micros, sum(used_micros)::text AS used_micros, sum(reserved_micros)::text AS reserved_micros FROM usage_budget_accounts GROUP BY mode ORDER BY mode`),
      db.execute(sql`SELECT status, count(*)::int AS count FROM usage_reservations GROUP BY status ORDER BY status`),
      db.execute(sql`SELECT status, count(*)::int AS count, max(attempts)::int AS max_attempts FROM billing_provider_events GROUP BY status ORDER BY status`),
      db.execute(sql`SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now())::int AS active, count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM api_keys`),
      db.execute(sql`SELECT outcome, count(*)::int AS count FROM audit_events GROUP BY outcome ORDER BY outcome`),
      db.execute(sql`SELECT role, count(*)::int AS count FROM administrative_principals WHERE revoked_at IS NULL GROUP BY role ORDER BY role`),
    ])
    const values = new Map(metadata.rows.map((row) => [String(row.key), String(row.value)]))
    const schemaVersion = Number(values.get('schema_version'))
    if (schemaVersion !== APP_DATA_SCHEMA_VERSION) {
      throw new Error(`Expected app-data schema ${APP_DATA_SCHEMA_VERSION}, received ${schemaVersion}`)
    }
    if (administrators.rows.length === 0) throw new Error('At least one active administrative principal is required')

    let institutionBudget: unknown = undefined
    if (profile === 'institution') {
      const institutionUserId = required('P7_INSTITUTION_BUDGET_USER_ID')
      const result = await db.execute(sql`
        SELECT user_id, mode, included_micros, granted_micros, used_micros, reserved_micros
        FROM usage_budget_accounts WHERE user_id = ${institutionUserId}
      `)
      const row = result.rows[0]
      if (!row || row.mode !== 'budgeted' || Number(row.included_micros) + Number(row.granted_micros) <= 0) {
        throw new Error('Institution profile requires a positive managed budget account')
      }
      institutionBudget = row
    }

    console.log(JSON.stringify({
      administrativePrincipals: administrators.rows,
      apiKeyState: apiKeys.rows[0],
      assertions: {
        backgroundRuntime: true,
        failClosedRedis: true,
        stripeTestMode: profile === 'stripe',
        webTasks: Number(process.env.P7_REHEARSAL_WEB_TASK_COUNT),
        workerTasks: Number(process.env.P7_REHEARSAL_WORKER_TASK_COUNT),
      },
      auditState: audits.rows,
      billingProviderEventState: providerEvents.rows,
      endpointHostname: hostname,
      institutionBudget,
      minimumCompatibleVersion: Number(values.get('schema_min_compatible_version')),
      ok: true,
      profile,
      redisHost,
      rehearsal: 7,
      reservationState: reservations.rows,
      schemaVersion,
      usageState: usage.rows,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function assertEqual(name: string, expected: string): void {
  const actual = required(name)
  if (actual !== expected) throw new Error(`${name} must be ${expected}; received ${actual}`)
}

function assertMinimum(name: string, minimum: number): void {
  const actual = Number(required(name))
  if (!Number.isInteger(actual) || actual < minimum) throw new Error(`${name} must be at least ${minimum}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
