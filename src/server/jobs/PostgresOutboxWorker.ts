import 'server-only'

import type { OutboxPublisher, OutboxRepository } from './OutboxRepository'

export class PostgresOutboxWorker {
  constructor(private readonly options: {
    leaseMs: number
    publisher: OutboxPublisher
    repository: OutboxRepository
    workerId: string
  }) {}

  async runOnce(now = Date.now()): Promise<'idle' | 'published' | 'retry' | 'dead_letter' | 'lost_lease'> {
    await this.options.repository.recoverExpiredLeases({ now })
    const event = await this.options.repository.claim({
      leaseMs: this.options.leaseMs,
      now,
      workerId: this.options.workerId,
    })
    if (!event) return 'idle'
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    try {
      heartbeatTimer = setInterval(() => {
        void this.options.repository.renewLease({
          eventId: event.id,
          leaseMs: this.options.leaseMs,
          workerId: this.options.workerId,
        }).catch((_error) => false)
      }, Math.max(1_000, Math.floor(this.options.leaseMs / 3)))
      heartbeatTimer.unref?.()
      await this.options.publisher(event)
      const published = await this.options.repository.markPublished({
        eventId: event.id,
        workerId: this.options.workerId,
      })
      return published ? 'published' : 'lost_lease'
    } catch (error) {
      return await this.options.repository.markFailed({
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        eventId: event.id,
        retryDelayMs: retryDelayMs(event.attempts),
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
