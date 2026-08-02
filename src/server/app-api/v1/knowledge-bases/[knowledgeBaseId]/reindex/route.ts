import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse, requiredKnowledgeBaseId } from '../../errors'

/** Lists sources whose index is no longer trustworthy. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const stale = await getOverlayServerContext().knowledgeSourceIngestionService.listStaleSources({
      knowledgeBaseId,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ stale })
  } catch (error) {
    return knowledgeBaseErrorResponse('list stale sources for', error)
  }
}

/**
 * Re-embeds one source, or the whole base. `onlyStale` is the normal path for an
 * embedding-model migration: it skips sources already indexed under the current
 * identity so a large corpus is not needlessly re-embedded.
 */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBaseId = await requiredKnowledgeBaseId(context)
    const body = context.parsedJson as { sourceId?: string; onlyStale?: boolean } | undefined
    const server = getOverlayServerContext()
    if (body?.sourceId) {
      // Confirms the source really belongs to this base before re-embedding.
      const sources = await server.knowledgeBaseService.listSources({
        knowledgeBaseId,
        userId: getAuthorizedResourceUserId(context),
      })
      if (!sources.some(({ source }) => source.id === body.sourceId)) {
        return NextResponse.json({ error: 'Knowledge source not found' }, { status: 404 })
      }
      const result = await server.knowledgeSourceIngestionService.reindexSource({
        sourceId: body.sourceId,
        userId: getAuthorizedResourceUserId(context),
      })
      return NextResponse.json({ success: true, queued: [{ sourceId: body.sourceId, ...result }] })
    }
    const result = await server.knowledgeSourceIngestionService.reindexKnowledgeBase({
      knowledgeBaseId,
      onlyStale: body?.onlyStale ?? false,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return knowledgeBaseErrorResponse('reindex', error)
  }
}
