import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as { query: string; limit?: number }
    return NextResponse.json(await getOverlayServerContext().knowledgeBaseRetrievalService.search({
      accessToken: context.auth.accessToken,
      knowledgeBaseId,
      limit: body.limit,
      query: body.query,
      userId: context.auth.userId,
    }))
  } catch (error) {
    return knowledgeBaseErrorResponse('search', error)
  }
}
