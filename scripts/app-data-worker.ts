import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { assertAppDataSchemaCompatible } from '../src/server/database/postgres/schema-compatibility'
import { createPostgresRuntime } from '../src/server/jobs/postgres-runtime'
import { createObjectStoreForRuntime } from '../src/server/bootstrap'
import { getOverlayRuntimeConfigSync } from '../src/server/config'

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
  const runtime = createPostgresRuntime({
    db,
    leaseMs,
    objectStore: lazyObjectStore(),
    workerId,
  })
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
    let consecutiveFailures = 0
    do {
      try {
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
        consecutiveFailures = 0
        if (!once && workerResult === 'idle') await sleep(pollMs)
      } catch (error) {
        if (once) throw error
        consecutiveFailures += 1
        console.error(JSON.stringify({
          consecutiveFailures,
          event: 'runtime_error',
          message: errorMessage(error),
          workerId,
        }))
        await sleep(retryDelayMs(consecutiveFailures, pollMs))
      }
    } while (!once && !shuttingDown)
  } finally {
    await pool.end()
  }
}

function lazyObjectStore() {
  let store: ReturnType<typeof createObjectStoreForRuntime> | null = null
  const resolve = () => {
    store ??= createObjectStoreForRuntime(getOverlayRuntimeConfigSync())
    return store
  }
  return {
    deleteObject: async (key: string) => await resolve().deleteObject(key),
    listObjects: async (prefix: string) => await resolve().listObjects(prefix),
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

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors.map(errorMessage).filter(Boolean)
    return messages.join('; ').slice(0, 2_000) || 'Multiple database operations failed'
  }
  if (error instanceof Error) return (error.message || error.name).slice(0, 2_000)
  return String(error || 'Unknown runtime error').slice(0, 2_000)
}

function retryDelayMs(consecutiveFailures: number, pollMs: number): number {
  const baseMs = Math.max(pollMs, 1_000)
  return Math.min(30_000, baseMs * 2 ** Math.min(Math.max(consecutiveFailures - 1, 0), 5))
}
