import 'server-only'

import { logger } from '@/server/observability/logger'

export type PublicStreamMetric = {
  event: 'admission_accepted' | 'workflow_claimed' | 'preparation_complete' | 'model_dispatch'
  runId: string
  generation: number
  modelId?: string
  receiptId?: string
  durationMs?: number
}

export function recordPublicStreamMetric(metric: PublicStreamMetric): void {
  try {
    logger.info('[harness] unified public stream', metric)
  } catch (_error) {
    // Telemetry is best-effort and must not affect the workflow.
  }
}
