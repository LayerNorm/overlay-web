import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

/**
 * Per-source indexing health for a knowledge base: what is indexed, where it
 * came from, and whether the index is still trustworthy.
 */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const query = context.parsedQuery as { sourceId?: string; previewLimit?: number } | undefined
    const server = getOverlayServerContext()
    if (query?.sourceId) {
      const preview = await server.knowledgeBaseService.getExtractionPreview({
        knowledgeBaseId,
        limit: query.previewLimit,
        sourceId: query.sourceId,
        userId: getAuthorizedResourceUserId(context),
      })
      return NextResponse.json({ preview })
    }
    const sources = await server.knowledgeBaseService.listSourceDiagnostics({
      knowledgeBaseId,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ sources })
  } catch (error) {
    return knowledgeBaseErrorResponse('read diagnostics for', error)
  }
}
