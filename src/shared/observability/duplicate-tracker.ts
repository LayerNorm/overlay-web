/**
 * Windowed duplicate-request tracker for the browser.
 *
 * Records request keys and detects duplicates within 1s, 5s, and 15s windows.
 * Emits a `trackDuplicateRequest` metric when a key is seen more than once
 * within a window.
 *
 * Isomorphic: no-ops on the server (no `window`).
 */

import { trackDuplicateRequest } from './client-metrics'

const WINDOWS = [1_000, 5_000, 15_000] as const

type Timestamp = number

const requestLog = new Map<string, Timestamp[]>()

/** Maximum timestamps kept per key to bound memory. */
const MAX_SAMPLES_PER_KEY = 50

/**
 * Records a request with the given deduplication key.  When the same key is
 * seen more than once within any of the configured windows, a
 * `trackDuplicateRequest` metric is emitted.
 */
export function recordRequest(key: string): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const existing = requestLog.get(key) ?? []
  existing.push(now)

  // Trim old samples
  if (existing.length > MAX_SAMPLES_PER_KEY) {
    const cutoff = now - 15_000
    while (existing.length > 0 && existing[0]! < cutoff) existing.shift()
  }
  requestLog.set(key, existing)

  // Check each window for duplicates
  for (const windowMs of WINDOWS) {
    const threshold = now - windowMs
    const withinWindow = existing.filter((ts) => ts >= threshold)
    if (withinWindow.length > 1) {
      trackDuplicateRequest({
        key,
        count: withinWindow.length,
        windowMs,
        spanMs: now - withinWindow[0]!,
      })
      // Only emit for the smallest window that has duplicates to avoid noise
      break
    }
  }
}

/** Clears the request log (useful for testing or session reset). */
export function clearDuplicateTracker(): void {
  requestLog.clear()
}
