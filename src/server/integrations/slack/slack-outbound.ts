import { getDescriptiveToolLabel } from '@overlay/chat-core/tool-labels'
import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { renderSlackReply } from './render'
import { postToSlackThread } from './slack-bot'
import { slackThreadUrl, startSlackDelivery } from './slack-inbound'
import type { SlackReplyInput } from '@/server/workflows/slack-reply'

/**
 * A member's reply in the web app to a thread that started in Slack (internal/develop/slack-integration.md). It is
 * posted into the Slack thread by the Overlay bot under the member's name, and Overlay's answer follows it there.
 * Only the thread's own asker, still linked to Slack, is mirrored.
 */

const call = { throwOnError: true } as const

type Origin = {
  origin: { teamId: string; channelId: string; threadTs: string; kind: 'channel' | 'dm' }
  workspaceId: string
  agentId: string
  userId: string
}

export type SlackMirrorDependencies = {
  origin?: (conversationId: string) => Promise<Origin | null>
  link?: (args: { workspaceId: string; userId: string }) => Promise<{ teamId: string; slackUserId: string } | null>
  post?: typeof postToSlackThread
  startDelivery?: (input: SlackReplyInput) => Promise<void>
}

export async function mirrorWebMessageToSlack(args: {
  conversationId: string
  workspaceId: string
  userId: string
  authorName: string
  content: string
  /** The agents this message started; `harness: 'mcp'` marks an outside agent, which gets no Overlay run. */
  agentTurns: ReadonlyArray<{ turnId: string; harness?: string }>
}, dependencies: SlackMirrorDependencies = {}): Promise<boolean> {
  // Delivery waits for the turn's run, so only turns Overlay runs itself are followed into Slack.
  const turnIds = args.agentTurns.filter((turn) => turn.harness !== 'mcp').map((turn) => turn.turnId)
  if (turnIds.length === 0) return false
  const serverQuery = <T,>(name: string, input: Record<string, unknown>) =>
    convex.query<T>('integrations/slack:' + name, { serverSecret: getInternalApiSecret(), ...input }, call)
  const found = await (dependencies.origin ?? ((conversationId) => serverQuery<Origin | null>('originByServer', { conversationId })))(args.conversationId)
  if (!found || found.workspaceId !== args.workspaceId || found.userId !== args.userId) return false
  const link = await (dependencies.link ?? ((input) => serverQuery<{ teamId: string; slackUserId: string } | null>('linkForUserByServer', input)))({
    workspaceId: args.workspaceId, userId: args.userId,
  })
  if (!link || link.teamId !== found.origin.teamId) return false
  const threadUrl = slackThreadUrl(args.workspaceId, args.conversationId, found.agentId)
  const { teamId, channelId, threadTs, kind } = found.origin
  await (dependencies.post ?? postToSlackThread)({
    teamId, channelId, threadTs,
    messages: renderSlackReply('**' + args.authorName.replace(/[*_~]/g, '') + ' replied in Overlay**\n\n' + args.content, { threadUrl }),
  })
  for (const turnId of turnIds) {
    await (dependencies.startDelivery ?? startSlackDelivery)({
      teamId, channelId, threadTs, kind, slackUserId: link.slackUserId, workspaceId: args.workspaceId, userId: args.userId,
      conversationId: args.conversationId, turnId, threadUrl,
    })
  }
  return true
}

/** The approval card's body: what Overlay wants to do, in the words the web app uses for each tool. */
export function slackApprovalDetail(tools: readonly string[]): string {
  const steps = tools.map((tool) => {
    const label = getDescriptiveToolLabel(tool)
    return label.charAt(0).toLowerCase() + label.slice(1)
  })
  return (steps.length ? 'Overlay wants your OK for: ' + steps.join('; ') + '. ' : '') + 'Only the person who asked can answer.'
}
