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
