import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as {
      query: string
      limit?: number
      additionalKnowledgeBaseIds?: string[]
    }
    // The path base always leads, so searching "inside one KB" stays the default
    // and callers opt into a cross-base search explicitly.
    const knowledgeBaseIds = [knowledgeBaseId, ...(body.additionalKnowledgeBaseIds ?? [])]
    return NextResponse.json(await getOverlayServerContext().knowledgeBaseRetrievalService.search({
      accessToken: context.auth.accessToken,
      knowledgeBaseIds,
      limit: body.limit,
      query: body.query,
      userId: getAuthorizedResourceUserId(context),
    }))
  } catch (error) {
    return knowledgeBaseErrorResponse('search', error)
  }
}
