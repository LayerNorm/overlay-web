import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { KnowledgeSearchServiceError } from '@/server/knowledge'

export const maxDuration = 60

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json() as {
      kLex?: number
      kVec?: number
      m?: number
      minVecScore?: number
      projectId?: string
      query?: string
      sourceKind?: 'file' | 'memory'
    }
    const result = await getOverlayServerContext().knowledgeSearchService.hybridSearch({
      accessToken: context.auth.accessToken,
      billing: {
        idempotencyKey: context.requestIdempotencyKey!,
        operationId: 'knowledge.hybrid-search',
        requestFingerprint: context.requestFingerprint,
      },
      kLex: body.kLex,
      kVec: body.kVec,
      m: body.m,
      minVecScore: body.minVecScore,
      projectId: body.projectId,
      query: body.query ?? '',
      sourceKind: body.sourceKind,
      userId: context.auth.userId,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('[knowledge/search]', error)
    if (error instanceof KnowledgeSearchServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
