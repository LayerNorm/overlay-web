import 'server-only'

export type OutboxEvent = {
  attempts: number
  id: string
  maxAttempts: number
  payload: Record<string, unknown>
  topic: string
}

export interface OutboxRepository {
  append(args: {
    availableAt?: number
    dedupeKey?: string
    id?: string
    maxAttempts?: number
    payload?: Record<string, unknown>
    topic: string
  }): Promise<string>
  claim(args: { leaseMs: number; now?: number; workerId: string }): Promise<OutboxEvent | null>
  markPublished(args: { eventId: string; workerId: string }): Promise<boolean>
  markFailed(args: {
    error: string
    eventId: string
    now?: number
    retryDelayMs: number
    workerId: string
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'>
  renewLease(args: { eventId: string; leaseMs: number; now?: number; workerId: string }): Promise<boolean>
  recoverExpiredLeases(args?: { limit?: number; now?: number }): Promise<{ deadLettered: number; requeued: number }>
}

export type OutboxPublisher = (event: OutboxEvent) => Promise<void>
