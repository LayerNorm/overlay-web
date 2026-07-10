import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { assertAppDataSchemaCompatible } from '../src/server/database/postgres/schema-compatibility'
import { createPostgresRuntime } from '../src/server/jobs/postgres-runtime'

void main()

async function main(): Promise<void> {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required for the app-data worker')

  const mode = valueArg('mode') ?? process.env.OVERLAY_WORKER_MODE?.trim() ?? 'all'
  if (!['all', 'scheduler', 'worker'].includes(mode)) {
    throw new Error('Worker mode must be all, scheduler, or worker')
  }

  const once = process.argv.includes('--once') || process.env.OVERLAY_WORKER_ONCE === 'true'
  const leaseMs = numberValue(process.env.OVERLAY_WORKER_LEASE_MS, 60_000, 5_000, 60 * 60_000)
  const pollMs = numberValue(process.env.OVERLAY_WORKER_POLL_MS, 1_000, 100, 60_000)
  const schedulerPollMs = numberValue(process.env.OVERLAY_SCHEDULER_POLL_MS, 5_000, 1_000, 60_000)
  const workerId = process.env.OVERLAY_WORKER_ID?.trim() || `${hostname()}:${process.pid}:${randomUUID()}`
  const pool = createOverlayPostgresPool({
    connectionString,
    max: numberValue(process.env.OVERLAY_WORKER_DB_POOL_SIZE, 5, 1, 50),
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const runtime = createPostgresRuntime({ db, leaseMs, workerId })
  let shuttingDown = false

  process.once('SIGINT', () => { shuttingDown = true })
  process.once('SIGTERM', () => { shuttingDown = true })

  try {
    await assertAppDataSchemaCompatible(pool)
    if (mode !== 'worker') await runtime.scheduler.registerDefaults()
    if (process.argv.includes('--healthcheck')) {
      await runtime.jobs.enqueue({
        dedupeKey: `runtime-healthcheck:${workerId}:${Date.now()}`,
        payload: { requestedBy: workerId },
        priority: 100,
        type: 'runtime.healthcheck',
      })
    }

    console.log(JSON.stringify({ leaseMs, mode, once, pollMs, schedulerPollMs, workerId }))
    let lastSchedulerTick = 0
    do {
      const now = Date.now()
      if (mode !== 'worker' && now - lastSchedulerTick >= schedulerPollMs) {
        const result = await runtime.scheduler.tick({ now })
        if (result.enqueued > 0) console.log(JSON.stringify({ event: 'scheduler_tick', ...result }))
        lastSchedulerTick = now
      }

      let workerResult: string = 'idle'
      if (mode !== 'scheduler') {
        workerResult = await runtime.worker.runOnce(now)
        if (workerResult !== 'idle') console.log(JSON.stringify({ event: 'job_result', result: workerResult }))
      }
      if (!once && workerResult === 'idle') await sleep(pollMs)
    } while (!once && !shuttingDown)
  } finally {
    await pool.end()
  }
}

function valueArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function numberValue(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
