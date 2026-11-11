import 'server-only'
import { randomUUID } from 'node:crypto'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { SlackIdentityState } from './slack-identity-oauth'

export async function beginSlackIdentity(state: SlackIdentityState) {
  const { returnTo: _returnTo, ...scope } = state
  void _returnTo
  await lazyConvex.mutation('surfaces/slackIdentity:begin', { ...scope, serverSecret: getInternalApiSecret() }, { throwOnError: true })
}

export async function completeSlackIdentity(state: SlackIdentityState, slackUserId: string, displayName?: string) {
  const { returnTo: _returnTo, ...scope } = state
  void _returnTo
  return await lazyConvex.mutation<{ status: 'linked' | 'conflict' }>('surfaces/slackIdentity:complete', {
    ...scope, slackUserId, ...(displayName ? { displayName } : {}), id: randomUUID(), serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
}

export async function unlinkSlackIdentity(args: { actorUserId: string; workspaceId: string; linkId: string }) {
  await lazyConvex.mutation('surfaces/slackIdentity:unlink', { ...args, serverSecret: getInternalApiSecret() }, { throwOnError: true })
}
