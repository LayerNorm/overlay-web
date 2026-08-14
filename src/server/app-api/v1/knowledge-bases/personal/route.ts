import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { knowledgeBaseErrorResponse } from '../errors'

const MIGRATION_KEY = 'kb_personal_workspace_binding'

/** The caller's own personal knowledge bases. Shared bases are excluded. */
export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    if (context.workspace.workspace.kind !== 'personal') {
      return NextResponse.json({ knowledgeBases: [] })
    }
    const server = getOverlayServerContext()
    const knowledgeBases = await server.knowledgeBaseService.listPersonalKnowledgeBases(context.auth.userId)

    // Only run the legacy binding migration once per user.
    const alreadyMigrated = await convex.query<boolean>(
      'platform/migrations:isComplete',
      { serverSecret: getInternalApiSecret(), key: MIGRATION_KEY, scope: context.auth.userId },
      { throwOnError: false, timeoutMs: 5_000, suppressNetworkConsoleError: true },
    ).catch((_error) => false)

    if (!alreadyMigrated) {
      await server.workspaceService.bindUnscopedResourcesToPersonalWorkspace({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        resourceType: 'knowledge_base',
        resourceIds: knowledgeBases.map(({ id }) => id),
      })
      await convex.mutation(
        'platform/migrations:markComplete',
        { serverSecret: getInternalApiSecret(), key: MIGRATION_KEY, scope: context.auth.userId, now: Date.now() },
        { throwOnError: false, timeoutMs: 5_000, suppressNetworkConsoleError: true },
      ).catch((_error) => undefined)
    }

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
    // For new KBs, binding is always needed (it's not a migration, it's a new resource).
    await server.workspaceService.bindResource({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: 'knowledge_base',
      resourceId: knowledgeBase.id,
    })
    return NextResponse.json({ knowledgeBase })
  } catch (error) {
    return knowledgeBaseErrorResponse('create personal', error)
  }
}
