import 'server-only'

import type {
  DurableJobHandler,
  DurableJobRepository,
} from './DurableJobRepository'

export class PostgresJobWorker {
  constructor(private readonly options: {
    handlers: Readonly<Record<string, DurableJobHandler>>
    leaseMs: number
    repository: DurableJobRepository
    workerId: string
  }) {}

  async runOnce(now = Date.now()): Promise<'idle' | 'succeeded' | 'retry' | 'dead_letter' | 'lost_lease'> {
    await this.options.repository.recoverExpiredLeases({ now })
    const job = await this.options.repository.claim({
      leaseMs: this.options.leaseMs,
      now,
      workerId: this.options.workerId,
    })
    if (!job) return 'idle'

    const handler = this.options.handlers[job.type]
    if (!handler) {
      return await this.options.repository.fail({
        error: `No durable job handler is registered for ${job.type}`,
        jobId: job.id,
        now,
        retryDelayMs: 0,
        workerId: this.options.workerId,
      })
    }

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    const heartbeat = async () => await this.options.repository.renewLease({
      jobId: job.id,
      leaseMs: this.options.leaseMs,
      workerId: this.options.workerId,
    })
    try {
      heartbeatTimer = setInterval(() => {
        void heartbeat()
      }, Math.max(1_000, Math.floor(this.options.leaseMs / 3)))
      heartbeatTimer.unref?.()
      const result = await handler(job, { heartbeat })
      const completed = await this.options.repository.complete({
        jobId: job.id,
        result,
        workerId: this.options.workerId,
      })
      return completed ? 'succeeded' : 'lost_lease'
    } catch (error) {
      return await this.options.repository.fail({
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        jobId: job.id,
        retryDelayMs: retryDelayMs(job.attempts),
        workerId: this.options.workerId,
      })
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    }
  }
}

function retryDelayMs(attempts: number): number {
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1))
}
