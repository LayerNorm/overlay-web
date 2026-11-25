import { FatalError, sleep } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { renderSlackReply } from '@/server/integrations/slack/render'

/**
 * Posts the reply to a Slack request back into its Slack thread (internal/develop/slack-integration.md). The turn
 * itself runs like any web turn; this workflow only waits for it to settle, checks the asker may still use Overlay
 * from Slack, asks for approvals in Slack, and posts the rendered reply.
 */

export type SlackReplyInput = {
  teamId: string
  channelId: string
  threadTs: string
  kind?: 'channel' | 'dm'
  slackUserId: string
  workspaceId: string
  userId: string
  conversationId: string
  /** The Overlay agent's turn, not the asker's message turn. */
  turnId: string
  threadUrl: string
  /** Offer the asker, once, to continue privately with their personal chief. */
  offerPrivate?: boolean
}

type ReplyState =
  | { status: 'running' }
  | { status: 'approval'; agentRunId: string; token: string; title: string; tools: string[] }
  | { status: 'input' }
  | { status: 'completed'; text: string }
  | { status: 'failed' | 'cancelled' }
  | { status: 'revoked' }

const INPUT_STATUSES = new Set(['waiting_for_input', 'waiting_for_authorization'])
const MAX_WAIT_MS = 24 * 60 * 60_000

/** How long once-per-thread markers in Slack state live (the private offer, a started private handoff). */
export const SLACK_MARKER_TTL_MS = 30 * 24 * 60 * 60_000

async function readSlackReplyStep(input: SlackReplyInput): Promise<ReplyState> {
  'use step'
  const requester = await convex.query<{ workspaceId: string; userId: string | null; allowed: boolean } | null>(
    'integrations/slack:resolveRequesterByServer',
    { serverSecret: getInternalApiSecret(), teamId: input.teamId, slackUserId: input.slackUserId },
    { throwOnError: true },
  )
  if (!requester || requester.workspaceId !== input.workspaceId || requester.userId !== input.userId) return { status: 'revoked' }
  // Blocking a member stops replies already under way, like unlinking does.
  if (!requester.allowed) return { status: 'revoked' }
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const run = await conversations.getLatestAgentRun({
    conversationId: input.conversationId as never, userId: input.userId, turnId: input.turnId,
  })
  if (!run || run.turnId !== input.turnId) throw new Error('The Slack turn has no run yet.')
  if (run.status === 'failed' || run.status === 'cancelled') return { status: run.status }
  if (run.status === 'waiting_for_approval' && run.approval) {
    return {
      status: 'approval', agentRunId: run.id, token: run.approval.token,
      title: run.approval.title ?? 'Overlay needs your approval',
      tools: [...new Set(run.approval.requests.map((request) => request.toolName))],
    }
  }
  if (INPUT_STATUSES.has(run.status)) return { status: 'input' }
  if (run.status !== 'completed') return { status: 'running' }
  const messages = await conversations.getConversationMessages({ conversationId: input.conversationId as never, userId: input.userId })
  return { status: 'completed', text: slackTurnText(messages, run.turnId) }
}

/** All of the turn's assistant text, in order, as the web shows the turn. */
export function slackTurnText(messages: ReadonlyArray<{ role: string; turnId?: string | null; content?: string | null }>, turnId: string): string {
  return messages
    .filter((message) => message.role === 'assistant' && message.turnId === turnId)
    .map((message) => message.content?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

async function renderSlackReplyStep(input: SlackReplyInput, markdown: string): Promise<string[]> {
  'use step'
  return renderSlackReply(markdown, { threadUrl: input.threadUrl }).map((message) => message.markdown)
}

async function postSlackMessageStep(input: SlackReplyInput, markdown: string): Promise<void> {
  'use step'
  const { postToSlackThread } = await import(/* workflow-vm-exclusion */ '@/server/integrations/slack/slack-bot')
  await postToSlackThread({ teamId: input.teamId, channelId: input.channelId, threadTs: input.threadTs, messages: [{ markdown }] })
}

/**
 * One step per Slack message: a step that fails and retries re-posts only its own message, never the ones before
 * it, because finished steps replay from the workflow log.
 */
async function postSlackReply(input: SlackReplyInput, markdown: string): Promise<void> {
  const messages = await renderSlackReplyStep(input, markdown)
  for (const message of messages) await postSlackMessageStep(input, message)
}

async function postSlackApprovalStep(input: SlackReplyInput, approval: { agentRunId: string; title: string; tools: string[] }): Promise<void> {
  'use step'
  const { postSlackApprovalCard } = await import(/* workflow-vm-exclusion */ '@/server/integrations/slack/slack-bot')
  const { slackApprovalDetail } = await import(/* workflow-vm-exclusion */ '@/server/integrations/slack/slack-outbound')
  await postSlackApprovalCard({
    teamId: input.teamId, channelId: input.channelId, threadTs: input.threadTs,
    title: approval.title,
    detail: slackApprovalDetail(approval.tools),
    conversationId: input.conversationId, agentRunId: approval.agentRunId, threadUrl: input.threadUrl,
  })
}

async function offerPrivateStep(input: SlackReplyInput): Promise<void> {
  'use step'
  const chief = await convex.query<{ name: string | null } | null>('integrations/slack:personalChiefByServer', {
    serverSecret: getInternalApiSecret(), workspaceId: input.workspaceId, userId: input.userId,
  }, { throwOnError: true })
  if (!chief) return
  const claimed = await convex.mutation<boolean>('integrations/slack:stateSetIfNotExists', {
    serverSecret: getInternalApiSecret(), key: 'private-offer:' + input.conversationId, value: 'true', ttlMs: SLACK_MARKER_TTL_MS,
  }, { throwOnError: true })
  if (!claimed) return
  const { postSlackPrivateOffer } = await import(/* workflow-vm-exclusion */ '@/server/integrations/slack/slack-bot')
  await postSlackPrivateOffer({
    teamId: input.teamId, channelId: input.channelId, threadTs: input.threadTs, slackUserId: input.slackUserId,
    conversationId: input.conversationId, chiefName: chief.name,
  })
}

export async function slackReplyWorkflow(input: SlackReplyInput): Promise<{ status: string }> {
  'use workflow'
  if (!input.turnId || !input.conversationId) throw new FatalError('A Slack reply needs its turn.')
  let waited = 0
  let askedApproval: string | null = null
  let toldInput = false
  while (waited < MAX_WAIT_MS) {
    const state = await readSlackReplyStep(input)
    if (state.status === 'revoked') return { status: 'revoked' }
    if (state.status === 'completed') {
      await postSlackReply(input, state.text || '_Overlay finished without a reply._ [Open in Overlay](' + input.threadUrl + ')')
      if (input.offerPrivate) await offerPrivateStep(input)
      return { status: 'completed' }
    }
    if (state.status === 'failed' || state.status === 'cancelled') {
      await postSlackReply(input, (state.status === 'failed' ? 'I couldn’t finish this.' : 'This request was stopped.')
        + ' [Open in Overlay](' + input.threadUrl + ')')
      return { status: state.status }
    }
    if (state.status === 'approval' && askedApproval !== state.token) {
      askedApproval = state.token
      await postSlackApprovalStep(input, state)
    }
    if (state.status === 'input' && !toldInput) {
      toldInput = true
      await postSlackReply(input, 'I need your answer to continue. [Open in Overlay](' + input.threadUrl + ')')
    }
    const delayMs = waited < 2 * 60_000 ? 3_000 : 30_000
    await sleep(delayMs)
    waited += delayMs
  }
  return { status: 'timed_out' }
}
