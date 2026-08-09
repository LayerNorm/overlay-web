import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { knowledgeBaseErrorResponse } from '../errors'

/** The caller's own personal knowledge bases. Shared bases are excluded. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    if (context.workspace.workspace.kind !== 'personal') {
      return NextResponse.json({ knowledgeBases: [] })
    }
    const server = getOverlayServerContext()
    const knowledgeBases = await server.knowledgeBaseService.listPersonalKnowledgeBases(context.auth.userId)
    await server.workspaceService.bindUnscopedResourcesToPersonalWorkspace({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: 'knowledge_base',
      resourceIds: knowledgeBases.map(({ id }) => id),
    })
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
    if (context.workspace.workspace.kind !== 'personal') {
      return NextResponse.json({ error: 'Personal knowledge is only available in the Personal workspace' }, { status: 409 })
    }
    const body = context.parsedJson as { title?: string } | undefined
    const server = getOverlayServerContext()
    const knowledgeBase = await server.knowledgeBaseService
      .ensureDefaultPersonalKnowledgeBase({
        title: body?.title,
        userId: context.auth.userId,
      })
    await server.workspaceService.bindUnscopedResourcesToPersonalWorkspace({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: 'knowledge_base',
      resourceIds: [knowledgeBase.id],
    })
    return NextResponse.json({ knowledgeBase })
  } catch (error) {
    return knowledgeBaseErrorResponse('create personal', error)
  }
}
