import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'
import { reduceThreadPullRequests } from '../../src/shared/agents/thread-pull-requests'
import { validateServerSecret } from './auth'

export const threadPullRequestValidator = v.object({
  owner: v.string(),
  repo: v.string(),
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.union(v.literal('draft'), v.literal('open'), v.literal('merged'), v.literal('closed')),
  observedAt: v.number(),
  updatedAt: v.optional(v.number()),
})

export async function projectAgentThreadPullRequests(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    conversationId: Id<'conversations'>
    workspaceId: string
    serverSecret?: string
  },
  previousParts: unknown,
  nextParts: unknown,
): Promise<void> {
  if (!validateServerSecret(args.serverSecret)) return
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation || conversation.deletedAt !== undefined
    || conversation.workspaceId !== args.workspaceId || !conversation.agentId) return

  const pullRequests = reduceThreadPullRequests(
    conversation.pullRequests as WorkspaceThreadPullRequest[] | undefined,
    previousParts,
    nextParts,
    Date.now(),
  )
  if (pullRequests === conversation.pullRequests) return
  await ctx.db.patch(conversation._id, { pullRequests })
}
