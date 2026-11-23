import { FatalError, sleep } from 'workflow'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { renderSlackReply } from '@/server/integrations/slack/render'

/**
 * Posts the Workspace Overlay's reply to a Slack request back into its Slack thread
 * (internal/develop/slack-integration.md). The turn itself runs like any web turn; this workflow only waits for it to
 * settle, checks the asker may still use Overlay from Slack, and posts the rendered reply.
 */

export type SlackReplyInput = {
  teamId: string
  channelId: string
  threadTs: string
  slackUserId: string
  workspaceId: string
  userId: string
  conversationId: string
  /** The Workspace Overlay's turn, not the asker's message turn. */
  turnId: string
  threadUrl: string
}

type ReplyState =
  | { status: 'pending'; waiting: boolean }
  | { status: 'completed'; text: string }
  | { status: 'failed' | 'cancelled' }
  | { status: 'revoked' }

const WAITING_STATUSES = new Set(['waiting_for_approval', 'waiting_for_input', 'waiting_for_authorization'])
const MAX_WAIT_MS = 24 * 60 * 60_000

async function readSlackReplyStep(input: SlackReplyInput): Promise<ReplyState> {
  'use step'
  const requester = await convex.query<{ workspaceId: string; userId: string | null } | null>(
    'integrations/slack:resolveRequesterByServer',
    { serverSecret: getInternalApiSecret(), teamId: input.teamId, slackUserId: input.slackUserId },
    { throwOnError: true },
  )
  if (!requester || requester.workspaceId !== input.workspaceId || requester.userId !== input.userId) return { status: 'revoked' }
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const run = await conversations.getLatestAgentRun({
    conversationId: input.conversationId as never, userId: input.userId, turnId: input.turnId,
  })
  if (!run || run.turnId !== input.turnId) throw new Error('The Slack turn has no run yet.')
  if (run.status === 'failed' || run.status === 'cancelled') return { status: run.status }
  if (run.status !== 'completed') return { status: 'pending', waiting: WAITING_STATUSES.has(run.status) }
  const messages = await conversations.getConversationMessages({ conversationId: input.conversationId as never, userId: input.userId })
  const text = messages.find(message => message.role === 'assistant' && message.turnId === run.turnId)?.content ?? ''
  return { status: 'completed', text }
}

async function postSlackReplyStep(input: SlackReplyInput, markdown: string): Promise<void> {
  'use step'
  const messages = renderSlackReply(markdown, { threadUrl: input.threadUrl })
  if (messages.length === 0) return
  const { postToSlackThread } = await import(/* workflow-vm-exclusion */ '@/server/integrations/slack/slack-bot')
  await postToSlackThread({ teamId: input.teamId, channelId: input.channelId, threadTs: input.threadTs, messages })
}

export async function slackReplyWorkflow(input: SlackReplyInput): Promise<{ status: string }> {
  'use workflow'
  if (!input.turnId || !input.conversationId) throw new FatalError('A Slack reply needs its turn.')
  let waited = 0
  let toldWaiting = false
  while (waited < MAX_WAIT_MS) {
    const state = await readSlackReplyStep(input)
    if (state.status === 'revoked') return { status: 'revoked' }
    if (state.status === 'completed') {
      await postSlackReplyStep(input, state.text || '_Overlay finished without a reply._ [Open in Overlay](' + input.threadUrl + ')')
      return { status: 'completed' }
    }
    if (state.status === 'failed' || state.status === 'cancelled') {
      await postSlackReplyStep(input, (state.status === 'failed' ? 'I couldn’t finish this.' : 'This request was stopped.')
        + ' [Open in Overlay](' + input.threadUrl + ')')
      return { status: state.status }
    }
    if (state.status === 'pending' && state.waiting && !toldWaiting) {
      toldWaiting = true
      await postSlackReplyStep(input, 'I need your answer to continue. [Open in Overlay](' + input.threadUrl + ')')
    }
    const delayMs = waited < 2 * 60_000 ? 3_000 : 30_000
    await sleep(delayMs)
    waited += delayMs
  }
  return { status: 'timed_out' }
}
