import 'server-only'

import { NextResponse } from 'next/server'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { runSyncOutbound } from '@/server/sync/outbound-worker'

/**
 * POST /api/v1/sync/outbound — internal. Convex calls this after a member's
 * change is queued in a linked channel and from the minute sweep; it sends due
 * outbox rows to Slack or Teams with each author's own account.
 */
export async function POST(request: Request) {
  if (!matchesInternalApiSecret(request.headers.get('x-internal-api-secret')?.trim(), getInternalApiSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runSyncOutbound(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('[sync/outbound] worker failed', error)
    return NextResponse.json({ error: 'Sync outbound failed' }, { status: 500 })
  }
}
