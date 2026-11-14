import 'server-only'

import { NextResponse } from 'next/server'
import { logger } from '@/server/observability/logger'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { runSyncHistoryTick } from '@/server/sync/history-worker'

/** POST /api/v1/sync/history/process — one bounded history and repair tick, called by the Convex cron. */
export async function POST(request: Request) {
  const supplied = request.headers.get('x-internal-api-secret')?.trim()
  if (!matchesInternalApiSecret(supplied, getInternalApiSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runSyncHistoryTick(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('[sync/history] tick failed', error)
    return NextResponse.json({ error: 'Sync history tick failed' }, { status: 500 })
  }
}
