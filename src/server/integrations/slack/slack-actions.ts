import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { submitAgentRunApproval } from '@/server/agents/submit-agent-run-approval'
import { SLACK_ACTIONS, startSlackDmThread, type SlackBot } from './slack-bot'
import { startSlackRequest, type SlackRequester } from './slack-inbound'
import { SLACK_MARKER_TTL_MS } from '@/server/workflows/slack-reply'

/**
 * Buttons Overlay posts in Slack (internal/develop/slack-integration.md): approving or denying a step, and moving a
 * channel request to the asker's personal Overlay in a DM. Only the person who asked can use them; Slack shows the
 * approval card to the whole thread, so every click is checked against the thread's owner.
 */

const call = { throwOnError: true } as const

type SlackActionEvent = Parameters<Parameters<SlackBot['onAction']>[1]>[0]
type ThreadOwner = { origin: { teamId: string; kind: 'channel' | 'dm' }; workspaceId: string; agentId: string; userId: string }

export type SlackActionOutcome =
  | 'approved' | 'denied' | 'inactive' | 'not_owner' | 'not_allowed' | 'link_required' | 'private_started' | 'no_personal_overlay'

export type SlackActionDependencies = {
  resolveRequester?: (args: { teamId: string; slackUserId: string }) => Promise<SlackRequester | null>
  threadOwner?: (conversationId: string) => Promise<ThreadOwner | null>
  getLatestAgentRun?: Parameters<typeof submitAgentRunApproval>[1]['getLatestAgentRun']
  submitApproval?: typeof submitAgentRunApproval
  hasPersonalOverlay?: (args: { workspaceId: string; userId: string }) => Promise<boolean>
  latestQuestion?: (args: { conversationId: string; userId: string }) => Promise<string>
  openDm?: typeof startSlackDmThread
  startRequest?: typeof startSlackRequest
  /** Sets a Slack state key only if it is not set yet; true when this call set it. */
  claim?: (key: string) => Promise<boolean>
  release?: (key: string) => Promise<void>
}

const serverQuery = <T>(name: string, args: Record<string, unknown>) =>
  convex.query<T>('integrations/slack:' + name, { serverSecret: getInternalApiSecret(), ...args }, call)

function parseValue(value: string | undefined): { c?: string; r?: string } {
  try {
    return value ? JSON.parse(value) as { c?: string; r?: string } : {}
  } catch (_error) {
    return {}
  }
}

/** The clicker as an Overlay member who owns the thread, or why not. */
async function ownerFor(
  args: { teamId: string; slackUserId: string; conversationId: string },
  dependencies: SlackActionDependencies,
): Promise<{ owner: ThreadOwner; principalId: string } | { outcome: 'link_required' | 'not_owner' | 'not_allowed' }> {
  const requester = await (dependencies.resolveRequester ?? ((input) => serverQuery<SlackRequester | null>('resolveRequesterByServer', input)))({
    teamId: args.teamId, slackUserId: args.slackUserId,
  })
  if (!requester?.userId || !requester.principalId) return { outcome: 'link_required' }
  // Buttons follow the same rules as asking: a blocked member, or a guest while guests are off, can't use them.
  if (!requester.allowed || (requester.guest && !requester.settings.guests)) return { outcome: 'not_allowed' }
  const owner = await (dependencies.threadOwner ?? ((conversationId) => serverQuery<ThreadOwner | null>('originByServer', { conversationId })))(args.conversationId)
  if (!owner || owner.userId !== requester.userId || owner.workspaceId !== requester.workspaceId || owner.origin.teamId !== args.teamId) {
    return { outcome: 'not_owner' }
  }
  return { owner, principalId: requester.principalId }
}

export async function answerSlackApproval(
  args: { teamId: string; slackUserId: string; value?: string; approved: boolean },
  dependencies: SlackActionDependencies = {},
): Promise<SlackActionOutcome> {
  const { c: conversationId, r: agentRunId } = parseValue(args.value)
  if (!conversationId || !agentRunId) return 'inactive'
  const found = await ownerFor({ teamId: args.teamId, slackUserId: args.slackUserId, conversationId }, dependencies)
  if ('outcome' in found) return found.outcome
  const getLatestAgentRun = dependencies.getLatestAgentRun
    ?? ((lookup) => getOverlayServerContext().appData.repositories.conversations.getLatestAgentRun(lookup))
  const run = await getLatestAgentRun({
    conversationId: asConversationId(conversationId), agentRunId, userId: found.owner.userId,
  }).catch((error: unknown) => {
    logger.warn('[slack] Could not read the run for an approval', { error })
    return null
  })
  const token = run?.approval?.token
  if (!token) return 'inactive'
  const access = await (dependencies.submitApproval ?? submitAgentRunApproval)({
    actorUserId: found.owner.userId, workspaceId: found.owner.workspaceId, conversationId, agentRunId, token,
    decision: { approved: args.approved },
  }, { getLatestAgentRun })
  if (access === 'allowed') return args.approved ? 'approved' : 'denied'
  return access === 'initiator-only' ? 'not_owner' : 'inactive'
}

/** Moves a channel request to the asker's personal Overlay, in a new thread of their DM with the app. */
export async function continueSlackRequestPrivately(
  args: { teamId: string; slackUserId: string; value?: string },
  dependencies: SlackActionDependencies = {},
): Promise<SlackActionOutcome> {
  const { c: conversationId } = parseValue(args.value)
  if (!conversationId) return 'inactive'
  const found = await ownerFor({ teamId: args.teamId, slackUserId: args.slackUserId, conversationId }, dependencies)
  if ('outcome' in found) return found.outcome
  const { owner, principalId } = found
  if (owner.origin.kind !== 'channel') return 'inactive'
  const hasPersonal = await (dependencies.hasPersonalOverlay ?? ((input) => serverQuery<boolean>('hasPersonalOverlayByServer', input)))({
    workspaceId: owner.workspaceId, userId: owner.userId,
  })
  if (!hasPersonal) return 'no_personal_overlay'
  const question = await (dependencies.latestQuestion ?? latestQuestion)({ conversationId, userId: owner.userId })
  if (!question) return 'inactive'
  // A second click (or Slack retrying the click) must not open another DM thread or start another run.
  const key = 'private-started:' + conversationId
  const claim = dependencies.claim ?? ((name) => convex.mutation<boolean>('integrations/slack:stateSetIfNotExists', {
    serverSecret: getInternalApiSecret(), key: name, value: 'true', ttlMs: SLACK_MARKER_TTL_MS,
  }, call).then((value) => value === true))
  if (!await claim(key)) return 'private_started'
  try {
    const dm = await (dependencies.openDm ?? startSlackDmThread)({
      teamId: args.teamId, slackUserId: args.slackUserId,
      markdown: 'Continuing privately with your personal Overlay:\n\n> ' + question.replace(/\n/g, '\n> '),
    })
    await (dependencies.startRequest ?? startSlackRequest)({
      workspaceId: owner.workspaceId, userId: owner.userId, principalId, slackUserId: args.slackUserId, prompt: question,
      agentRole: 'personal_chief',
      origin: { platform: 'slack', teamId: args.teamId, channelId: dm.channelId, threadTs: dm.threadTs, kind: 'dm' },
    })
  } catch (error) {
    // Nothing started, so the button works again.
    await (dependencies.release ?? ((name) => convex.mutation('integrations/slack:stateDelete', {
      serverSecret: getInternalApiSecret(), key: name,
    }, call).then(() => undefined)))(key).catch((_error: unknown) => undefined)
    throw error
  }
  return 'private_started'
}

async function latestQuestion(args: { conversationId: string; userId: string }): Promise<string> {
  const messages = await getOverlayServerContext().appData.repositories.conversations.getConversationMessages({
    conversationId: asConversationId(args.conversationId), userId: args.userId,
  })
  return [...messages].reverse().find((message) => message.role === 'user')?.content?.trim() ?? ''
}

const OUTCOME_TEXT: Record<SlackActionOutcome, string> = {
  approved: 'Approved. Overlay is continuing.',
  denied: 'Denied. Overlay won’t take that step.',
  inactive: 'This request is no longer waiting.',
  not_owner: 'Only the person who asked can answer this.',
  not_allowed: 'You can’t ask Overlay in this workspace right now.',
  link_required: 'Link your Slack account to Overlay first.',
  private_started: 'Continuing in your DM with Overlay.',
  no_personal_overlay: 'You don’t have a personal Overlay in this workspace yet.',
}

function teamOf(event: SlackActionEvent): string | undefined {
  const raw = event.raw as { team?: { id?: string }; user?: { team_id?: string } } | undefined
  return raw?.team?.id ?? raw?.user?.team_id
}

/** Registers the Slack button handlers once per bot instance. */
export function registerSlackActions(bot: SlackBot): void {
  const handle = (work: (teamId: string, event: SlackActionEvent) => Promise<SlackActionOutcome>) => async (event: SlackActionEvent) => {
    const teamId = teamOf(event)
    if (!teamId || !event.thread) return
    const outcome = await work(teamId, event).catch((error: unknown) => {
      logger.error('[slack] button failed', { actionId: event.actionId, reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' })
      return 'inactive' as const
    })
    const reply = { markdown: OUTCOME_TEXT[outcome] }
    const thread = event.thread
    // A button on a message only the clicker sees (Ask privately) is replaced by the outcome through Slack's
    // response_url, so it can't be clicked again; the approval card is shared, so its outcome is told privately.
    if (event.messageId.startsWith('ephemeral:')) {
      await event.adapter.editMessage(event.threadId, event.messageId, reply)
        .catch((error: unknown) => {
          logger.warn('[slack] could not replace a private message', { reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
          return thread.postEphemeral(event.user, reply, { fallbackToDM: false })
        })
      return
    }
    await thread.postEphemeral(event.user, reply, { fallbackToDM: false })
  }
  bot.onAction([SLACK_ACTIONS.approve, SLACK_ACTIONS.deny], handle((teamId, event) => answerSlackApproval({
    teamId, slackUserId: event.user.userId, value: event.value, approved: event.actionId === SLACK_ACTIONS.approve,
  })))
  bot.onAction(SLACK_ACTIONS.private, handle((teamId, event) => continueSlackRequestPrivately({
    teamId, slackUserId: event.user.userId, value: event.value,
  })))
}
