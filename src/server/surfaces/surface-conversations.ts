import 'server-only'

import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { surfaceConversationTitle } from '@/shared/surfaces/surface-prompts'
import { getOverlayServerContext } from '@/server/bootstrap'
import { AutomationTurnError } from '@/server/automations/automation-turn-runner'
import type { SurfaceAgentTurnInput } from '@/server/workflows/surface-agent-turn'

/**
 * Resolve the Overlay conversation backing a surface thread, creating it on
 * first contact. The (binding, thread) pair is the identity — the repository
 * makes the find-or-create atomic on both backends.
 */
export async function ensureSurfaceConversation(
  input: SurfaceAgentTurnInput,
): Promise<{ conversationId: string; workspaceId: string }> {
  const repositories = getOverlayServerContext().appData.repositories
  const surface = input.surface
  const modelId = input.modelId || DEFAULT_MODEL_ID
  const conversationId = await repositories.conversations.ensureSurfaceConversation({
    userId: input.userId,
    workspaceId: input.workspaceId,
    title: surfaceConversationTitle({
      platform: surface.platform,
      channelName: surface.channelName,
      channelId: surface.channelId,
    }),
    askModelIds: [modelId],
    actModelId: modelId,
    lastMode: 'act',
    conversationType: 'channel',
    createdByPrincipalId: surface.creatorPrincipalId,
    externalPlatform: surface.platform,
    externalChannelId: surface.channelId,
    externalThreadId: surface.threadId,
    surfaceBindingId: surface.bindingId,
  })
  if (!conversationId) {
    throw new AutomationTurnError('Failed to ensure surface conversation')
  }
  return {
    conversationId: String(conversationId),
    workspaceId: input.workspaceId,
  }
}
