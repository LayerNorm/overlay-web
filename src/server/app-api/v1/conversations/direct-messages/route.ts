import { NextResponse } from 'next/server'
import type { DirectMessageCreateInput } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

export async function POST(_request: Request, context: AppApiRouteContext) {
  const input = context.parsedJson as Partial<DirectMessageCreateInput>
  const principalIds = Array.isArray(input.principalIds)
    ? input.principalIds.filter((value): value is string => typeof value === 'string')
    : []
  if (principalIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one person' }, { status: 400 })
  }
  try {
    const server = getOverlayServerContext()
    await server.workspaceService.assertDirectMessageParticipantsAllowed({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      principalIds,
    })
    const directMessage = await server.appData.repositories
      .conversationCollaboration.createDirectMessage({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        principalIds,
        title: typeof input.title === 'string' ? input.title : undefined,
        sourceConversationId: typeof input.sourceConversationId === 'string'
          ? input.sourceConversationId
          : undefined,
      })

    // Publish workspace.dm_received lifecycle events for each non-actor human participant.
    // Only fire when the DM is newly created — existing DMs don't warrant a new email.
    if (directMessage.created) {
      const actorPrincipalId = context.workspace.principal.id
      const actorDisplayName = context.workspace.principal.displayName
      const workspaceId = context.workspace.workspace.id
      const workspaceName = context.workspace.workspace.name
      for (const participant of directMessage.participants) {
        if (participant.principalId === actorPrincipalId) continue
        if (participant.principalType !== 'human') continue
        try {
          const principal = await server.workspaceService.resolvePrincipal(participant.principalId)
          if (!principal?.userId) continue
          await server.lifecycleEvents.publish({
            attributes: {
              workspaceId,
              workspaceName,
              conversationId: directMessage.conversationId,
              fromPrincipalId: actorPrincipalId,
              fromDisplayName: actorDisplayName,
            },
            idempotencyKey: `workspace.dm_received:${directMessage.conversationId}:${participant.principalId}`,
            name: 'workspace.dm_received',
            resource: { id: directMessage.conversationId, type: 'workspace_dm' },
            userId: principal.userId,
          })
        } catch (error) {
          logger.warn('[direct-messages] Failed to publish dm_received lifecycle event', { error })
        }
      }
    }

    return NextResponse.json({ directMessage }, { status: directMessage.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof WorkspaceServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.statusCode,
      })
    }
    const message = error instanceof Error ? error.message : 'Could not create the direct message'
    return NextResponse.json({ error: message }, {
      status: message.includes('ACCESS_DENIED') ? 404 : 400,
    })
  }
}
