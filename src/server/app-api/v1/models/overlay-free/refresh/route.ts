import { NextResponse } from 'next/server'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { refreshOverlayFreeCatalog } from '@/server/ai/gateway/overlay-free-refresh'
import { logger } from '@/server/observability/logger'

export async function POST(request: Request) {
  let authorized = false
  try {
    authorized = matchesInternalApiSecret(
      request.headers.get('x-internal-api-secret'),
      getInternalApiSecret(),
    )
  } catch (_error) {
    authorized = false
  }
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  try {
    return NextResponse.json(await refreshOverlayFreeCatalog(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    logger.error('[overlay-free] refresh failed', {
      type: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json({ error: 'Refresh failed' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
