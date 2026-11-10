import 'server-only'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export async function resolveSurfaceRequester(input: {
  workspaceId: string; connectionId: string; teamId: string; slackUserId: string; channelId: string; threadId: string
  linkId?: string; userId?: string
}): Promise<{ userId: string; principalId: string; linkId: string } | null> {
  if (!input.slackUserId) return null
  return await lazyConvex.query('surfaces/slackIdentity:requester', { ...input, serverSecret: getInternalApiSecret() }, { throwOnError: true })
}
