import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse } from '../errors'

/** The caller's own personal knowledge bases. Shared bases are excluded. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const knowledgeBases = await getOverlayServerContext().knowledgeBaseService
      .listPersonalKnowledgeBases(context.auth.userId)
    return NextResponse.json({ knowledgeBases })
  } catch (error) {
    return knowledgeBaseErrorResponse('list personal', error)
  }
}

/**
 * Returns the caller's default personal knowledge base, creating it on first use.
 * Creation is explicit; nothing is indexed into it automatically.
 */
export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as { title?: string } | undefined
    const knowledgeBase = await getOverlayServerContext().knowledgeBaseService
      .ensureDefaultPersonalKnowledgeBase({
        title: body?.title,
        userId: context.auth.userId,
      })
    return NextResponse.json({ knowledgeBase })
  } catch (error) {
    return knowledgeBaseErrorResponse('create personal', error)
  }
}
