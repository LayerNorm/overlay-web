import 'server-only'

import { NextResponse } from 'next/server'
import { logSecurityEvent } from '@/server/observability/security-events'

/**
 * In-memory per-user concurrent request tracker.
 *
 * Tracks the number of in-flight requests per user to prevent resource
 * exhaustion from concurrent long-running operations. Increments on start,
 * decrements on completion. A stale-entry sweeper guards against leaks when
 * a request crashes without reaching its finally block.
 *
 * Limitation: This is per-process. On serverless platforms with multiple
 * instances (e.g. Vercel), each instance tracks independently. The budget
 * reservation system provides cross-instance cost protection; this limiter
 * adds per-instance concurrency protection as defense-in-depth.
 */

const MAX_CONCURRENT_ACT_REQUESTS_PER_USER = 3
const STALE_SWEEP_INTERVAL_MS = 60_000
const MAX_REQUEST_DURATION_MS = 900_000 // 15 minutes (covers maxDuration=800s + buffer)

type ActiveRequest = {
  startedAt: number
  maxDurationMs: number
}

const activeRequestsByUser = new Map<string, Set<ActiveRequest>>()
let lastSweepAt = 0

function sweepStaleEntries(now: number): void {
  if (now - lastSweepAt < STALE_SWEEP_INTERVAL_MS) return
  lastSweepAt = now
  for (const [userId, requests] of activeRequestsByUser) {
    for (const req of requests) {
      if (now - req.startedAt > req.maxDurationMs) {
        requests.delete(req)
      }
    }
    if (requests.size === 0) {
      activeRequestsByUser.delete(userId)
    }
  }
}

/**
 * Attempts to acquire a concurrent request slot for the given user.
 * Returns `null` if the slot was acquired (caller must call `release` when done),
 * or a 429 NextResponse if the concurrency limit is exceeded.
 */
export function acquireConcurrentRequestSlot(
  userId: string,
  options: { bucket: string; maxConcurrent?: number; maxDurationMs?: number } = { bucket: 'act' },
): { release: () => void } | null {
  const now = Date.now()
  sweepStaleEntries(now)

  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_ACT_REQUESTS_PER_USER
  const maxDurationMs = options.maxDurationMs ?? MAX_REQUEST_DURATION_MS
  const bucket = options.bucket

  let active = activeRequestsByUser.get(userId)
  if (!active) {
    active = new Set()
    activeRequestsByUser.set(userId, active)
  }

  if (active.size >= maxConcurrent) {
    logSecurityEvent('concurrent_request_limit_exceeded', {
      bucket,
      userId,
      activeCount: active.size,
      limit: maxConcurrent,
    })
    return null
  }

  const entry: ActiveRequest = { startedAt: now, maxDurationMs }
  active.add(entry)

  let released = false
  return {
    release: () => {
      if (released) return
      released = true
      active?.delete(entry)
      if (active && active.size === 0) {
        activeRequestsByUser.delete(userId)
      }
    },
  }
}

export function concurrentRequestLimitResponse(bucket: string): NextResponse {
  return NextResponse.json(
    {
      error: 'concurrent_request_limit',
      message: 'Too many concurrent requests. Please wait for your current request to finish.',
    },
    {
      status: 429,
      headers: {
        'Retry-After': '15',
        'Cache-Control': 'no-store',
      },
    },
  )
}
