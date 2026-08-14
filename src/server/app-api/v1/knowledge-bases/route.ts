import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getAuthorizedResourceUserId, getGrantedResources, type AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { knowledgeBaseErrorResponse } from './errors'

export async function GET(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const server = getOverlayServerContext()
    const service = server.knowledgeBaseService
    if (context.workspace.workspace.kind === 'personal') {
      // Only run the legacy workspace binding migration once per user.
      // Subsequent requests skip the migration entirely.
      const migrationKey = 'kb_personal_workspace_binding'
      const migrationScope = context.auth.userId
      const alreadyMigrated = await convex.query<boolean>(
        'platform/migrations:isComplete',
        {
          serverSecret: getInternalApiSecret(),
          key: migrationKey,
          scope: migrationScope,
        },
        { throwOnError: false, timeoutMs: 5_000, suppressNetworkConsoleError: true },
      ).catch((_error) => false)

      if (!alreadyMigrated) {
        const legacyPersonalBases = await service.listPersonalKnowledgeBases(context.auth.userId)
        await server.workspaceService.bindUnscopedResourcesToPersonalWorkspace({
          actorUserId: context.auth.userId,
          workspaceId: context.workspace.workspace.id,
          resourceType: 'knowledge_base',
          resourceIds: legacyPersonalBases.map(({ id }) => id),
        })
        // Mark the migration as complete so it doesn't run again.
        await convex.mutation(
          'platform/migrations:markComplete',
          {
            serverSecret: getInternalApiSecret(),
            key: migrationKey,
            scope: migrationScope,
            now: Date.now(),
          },
          { throwOnError: false, timeoutMs: 5_000, suppressNetworkConsoleError: true },
        ).catch((_error) => undefined)
      }
    }
    const workspaceResourceIds = new Set(
      await server.workspaceService.listResourceIdsByWorkspace({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        resourceType: 'knowledge_base',
      }),
    )
    const owned = await service.listKnowledgeBases(
      context.auth.userId,
      workspaceResourceIds,
    )
    const granted = await Promise.all(getGrantedResources(context).map(({ ownerUserId, resourceId }) => (
      service.getKnowledgeBase({ knowledgeBaseId: resourceId, userId: ownerUserId })
    )))
    const values = new Map([...owned, ...granted].map((base) => [base.id, base]))
    return NextResponse.json({ knowledgeBases: [...values.values()] })
  } catch (error) {
    return knowledgeBaseErrorResponse('list', error)
  }
}

export async function POST(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as {
      title: string
      description?: string
      kind?: 'personal' | 'organization'
    }
    const server = getOverlayServerContext()
    const knowledgeBase = await server.knowledgeBaseService.createKnowledgeBase({
      ...body,
      userId: context.auth.userId,
    })
    await server.workspaceService.bindResource({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      resourceType: 'knowledge_base',
      resourceId: knowledgeBase.id,
    })
    return NextResponse.json({ knowledgeBase }, { status: 201 })
  } catch (error) {
    return knowledgeBaseErrorResponse('create', error)
  }
}

export async function PATCH(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as {
      knowledgeBaseId: string
      title?: string
      description?: string
      kind?: 'personal' | 'organization'
    }
    const knowledgeBase = await getOverlayServerContext().knowledgeBaseService.updateKnowledgeBase({
      ...body,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ knowledgeBase })
  } catch (error) {
    return knowledgeBaseErrorResponse('update', error)
  }
}

export async function DELETE(_request: NextRequest, context: AppApiRouteContext) {
  try {
    const { knowledgeBaseId } = context.parsedJson as { knowledgeBaseId: string }
    await getOverlayServerContext().knowledgeBaseService.deleteKnowledgeBase({
      knowledgeBaseId,
      userId: getAuthorizedResourceUserId(context),
    })
    return NextResponse.json({ deleted: true, knowledgeBaseId })
  } catch (error) {
    return knowledgeBaseErrorResponse('delete', error)
  }
}
