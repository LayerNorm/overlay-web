import 'server-only'

import { NextResponse } from 'next/server'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { runTeamsMaintenance } from '@/server/sync/teams/inbound'

/**
 * POST /api/v1/sync/teams/maintain — the Convex 'teams sync maintenance' cron
 * calls this with x-internal-api-secret, because the Microsoft credentials
 * live on the web server. Renews and creates Graph subscriptions, polls
 * private and shared channels and retries links paused for a missing app.
 */
export async function POST(request: Request) {
  if (!matchesInternalApiSecret(request.headers.get('x-internal-api-secret')?.trim(), getInternalApiSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await runTeamsMaintenance()) })
  } catch (error) {
    logger.error('[sync/teams] maintenance failed', error)
    return NextResponse.json({ error: 'Teams maintenance failed' }, { status: 500 })
  }
}
