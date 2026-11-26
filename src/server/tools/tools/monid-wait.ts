import 'server-only'

import { MONID_TERMINAL_STATUSES, MonidApiError, type MonidClient, type MonidRun } from '@/server/integrations/monid/client'
import { logger } from '@/server/observability/logger'
import type { MonidToolDeps } from './monid-deps'

const POLL_START_MS = 2_000
const POLL_MAX_MS = 10_000

export type RunWait =
  | { ended: true; run: MonidRun }
  | { ended: false; run: MonidRun; reason: 'cancelled' | 'timed_out' | 'status_unreadable'; error?: unknown }

/**
 * Waits for a run Monid accepted. The run goes on without us, so every way out either sees it end (to be settled) or
 * asks Monid to stop it. Failed status checks are retried until the deadline; only an error that cannot clear (an
 * account or not-found error) gives up early.
 */
export async function waitForRun(
  client: MonidClient,
  accepted: MonidRun,
  options: { waitMs: number; abortSignal?: AbortSignal },
  deps: Pick<MonidToolDeps, 'sleep' | 'now'>,
): Promise<RunWait> {
  let run = accepted
  const deadline = deps.now() + options.waitMs
  let interval = POLL_START_MS
  while (!MONID_TERMINAL_STATUSES.has(run.status)) {
    const cancelled = options.abortSignal?.aborted === true
    if (cancelled || deps.now() >= deadline) {
      run = await stopRun(client, run)
      if (MONID_TERMINAL_STATUSES.has(run.status)) break
      return { ended: false, run, reason: cancelled ? 'cancelled' : 'timed_out' }
    }
    try {
      await deps.sleep(Math.min(interval, Math.max(0, deadline - deps.now())), options.abortSignal)
    } catch (_error) {
      continue // Aborted while waiting: the check above stops the run.
    }
    interval = Math.min(POLL_MAX_MS, Math.round(interval * 1.5))
    try {
      run = await client.getRun(run.runId)
    } catch (error) {
      if (isTransientMonidError(error)) {
        logger.warn('[monid] status check failed; retrying', { runId: run.runId, error: error instanceof Error ? error.message : String(error) })
        continue
      }
      run = await stopRun(client, run)
      if (MONID_TERMINAL_STATUSES.has(run.status)) break
      return { ended: false, run, reason: 'status_unreadable', error }
    }
  }
  return { ended: true, run }
}

/** Network failures, timeouts, rate limits and Monid server errors: worth asking again. */
export function isTransientMonidError(error: unknown): boolean {
  if (!(error instanceof MonidApiError)) return true
  return error.status >= 500 || error.status === 408 || error.status === 429
}

export async function stopRun(client: MonidClient, run: MonidRun): Promise<MonidRun> {
  try {
    await client.stopRun(run.runId)
  } catch (error) {
    logger.warn('[monid] stop request failed', { runId: run.runId, error: error instanceof Error ? error.message : String(error) })
  }
  return await client.getRun(run.runId).catch((_error) => run)
}
