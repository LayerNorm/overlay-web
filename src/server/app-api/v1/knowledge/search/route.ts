import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { HybridSearchChunk } from '../../../../../../convex/knowledge/knowledge'

export const maxDuration = 60
const MAX_QUERY_CHARS = 500

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = (await request.json()) as {
      query?: string
      projectId?: string
      sourceKind?: 'file' | 'memory'
      kVec?: number
      kLex?: number
      m?: number
      accessToken?: string
      userId?: string
    }

    const { auth } = context
    const userId = auth?.userId ?? null
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }


    const query = body.query?.trim()
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 })
    }
    if (query.length > MAX_QUERY_CHARS) {
      return NextResponse.json({ error: `query cannot exceed ${MAX_QUERY_CHARS} characters` }, { status: 400 })
    }

    const serverSecret = getInternalApiSecret()
    const result = await convex.action<{ chunks: HybridSearchChunk[] }>('knowledge/knowledge:hybridSearch', {
      accessToken: auth?.accessToken,
      userId,
      serverSecret,
      query,
      projectId: body.projectId,
      sourceKind: body.sourceKind,
      kVec: body.kVec,
      kLex: body.kLex,
      m: body.m,
    })

    if (!result) {
      return NextResponse.json({ error: 'Search failed' }, { status: 502 })
    }

    return NextResponse.json(result)
  } catch (e) {
    logger.error('[knowledge/search]', e)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
