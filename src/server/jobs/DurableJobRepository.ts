import 'server-only'

export type DurableJobStatus = 'queued' | 'running' | 'succeeded' | 'dead_letter'

export type DurableJob = {
  attempts: number
  availableAt: number
  dedupeKey?: string
  id: string
  lastError?: string
  leaseExpiresAt?: number
  leaseOwner?: string
  maxAttempts: number
  payload: Record<string, unknown>
  priority: number
  status: DurableJobStatus
  type: string
}

export interface DurableJobRepository {
  enqueue(args: {
    availableAt?: number
    dedupeKey?: string
    id?: string
    maxAttempts?: number
    payload?: Record<string, unknown>
    priority?: number
    type: string
  }): Promise<string>
  claim(args: {
    leaseMs: number
    now?: number
    supportedTypes?: readonly string[]
    workerId: string
  }): Promise<DurableJob | null>
  complete(args: { jobId: string; result?: unknown; workerId: string }): Promise<boolean>
  fail(args: {
    error: string
    jobId: string
    now?: number
    retryDelayMs: number
    workerId: string
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'>
  renewLease(args: { jobId: string; leaseMs: number; now?: number; workerId: string }): Promise<boolean>
  recoverExpiredLeases(args?: { limit?: number; now?: number }): Promise<{ deadLettered: number; requeued: number }>
}

export type DurableJobHandler = (
  job: DurableJob,
  context: { heartbeat: () => Promise<boolean> },
) => Promise<unknown>
