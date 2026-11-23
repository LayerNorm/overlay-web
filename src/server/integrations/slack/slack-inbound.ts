import 'server-only'

import { randomUUID } from 'node:crypto'
import { start } from 'workflow/api'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { getBaseUrl } from '@/server/web/app-url'
import { startWorkspaceAgentTurns } from '@/server/agents/start-agent-turns'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { slackReplyWorkflow, type SlackReplyInput } from '@/server/workflows/slack-reply'
import type { SlackBot, SlackBotMessage, SlackBotThread } from './slack-bot'

/**
 * Slack messages become ordinary Workspace Overlay turns (internal/develop/slack-integration.md). A mention in a
 * channel or a DM to the app is saved as the asker's message in their own Overlay thread for that Slack thread, the
 * turn starts like any web turn, and a durable workflow posts the finished reply back to Slack.
 */

export type SlackRequester = {
  workspaceId: string
  settings: { whoCanAsk: string; unlinkedPeople: string; guests: boolean; slackConnect: boolean; actionsInChannels: string }
  userId: string | null
  principalId: string | null
  guest: boolean
}

export type SlackInbound = {
  teamId: string
  channelId: string
  threadTs: string
  kind: 'channel' | 'dm'
  channelName?: string
  external: boolean
  slackUserId: string
  text: string
}

export type SlackAgentRole = 'workspace_chief' | 'personal_chief'

export type SlackOrigin = {
  platform: 'slack'; teamId: string; channelId: string; threadTs: string; kind: 'channel' | 'dm'; channelName?: string
}

export type SlackAdmission =
  | { status: 'started'; conversationId: string; turnId: string }
  | { status: 'not_installed' }
  | { status: 'link_required'; workspaceId: string }
  | { status: 'not_allowed'; reason: 'slack_connect' | 'guest' }
  | { status: 'empty' }

export type SlackAdmissionDependencies = {
  resolveRequester?: (args: { teamId: string; slackUserId: string }) => Promise<SlackRequester | null>
  resolveThread?: (args: {
    workspaceId: string; userId: string; title: string; agentRole: SlackAgentRole; origin: SlackOrigin
  }) => Promise<{ conversationId: string; agentId: string; created: boolean }>
  startTurn?: (args: {
    workspaceId: string; userId: string; conversationId: string; prompt: string; turnId: string
  }) => Promise<string>
  startDelivery?: (input: SlackReplyInput) => Promise<void>
}

const call = { throwOnError: true } as const

/** Removes the bot mention the question was addressed with. */
export function slackPromptText(text: string): string {
  return text.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, ' ').replace(/^\s*@Overlay\b[:,]?/i, ' ').replace(/[ \t]+/g, ' ').trim()
}

export function slackThreadUrl(workspaceId: string, conversationId: string, agentId: string): string {
  const params = new URLSearchParams({ id: conversationId, agent: agentId })
  return getBaseUrl() + buildWorkspaceHref(workspaceId, '/app/agents?' + params.toString())
}

export async function admitSlackMessage(input: SlackInbound, dependencies: SlackAdmissionDependencies = {}): Promise<SlackAdmission> {
  const prompt = slackPromptText(input.text)
  if (!prompt) return { status: 'empty' }
  const requester = await (dependencies.resolveRequester ?? ((args) => convex.query<SlackRequester | null>(
    'integrations/slack:resolveRequesterByServer', { serverSecret: getInternalApiSecret(), ...args }, call,
  ).then((value) => value ?? null)))({ teamId: input.teamId, slackUserId: input.slackUserId })
  if (!requester) return { status: 'not_installed' }
  if (input.external && !requester.settings.slackConnect) return { status: 'not_allowed', reason: 'slack_connect' }
  if (!requester.userId) return { status: 'link_required', workspaceId: requester.workspaceId }
  if (requester.guest && !requester.settings.guests) return { status: 'not_allowed', reason: 'guest' }
  const started = await startSlackRequest({
    workspaceId: requester.workspaceId, userId: requester.userId, slackUserId: input.slackUserId, prompt,
    agentRole: 'workspace_chief',
    origin: {
      platform: 'slack', teamId: input.teamId, channelId: input.channelId, threadTs: input.threadTs, kind: input.kind,
      ...(input.channelName ? { channelName: input.channelName } : {}),
    },
  }, dependencies)
  return { status: 'started', ...started }
}

/**
 * Runs one Slack request in the asker's own thread under the chosen Overlay, and starts the workflow that posts the
 * reply back to the Slack thread.
 */
export async function startSlackRequest(args: {
  workspaceId: string
  userId: string
  slackUserId: string
  prompt: string
  agentRole: SlackAgentRole
  origin: SlackOrigin
}, dependencies: SlackAdmissionDependencies = {}): Promise<{ conversationId: string; turnId: string }> {
  const thread = await (dependencies.resolveThread ?? ((resolve) => convex.mutation<{ conversationId: string; agentId: string; created: boolean }>(
    'integrations/slack:resolveThreadByServer', { serverSecret: getInternalApiSecret(), ...resolve }, call,
  ).then((value) => value!)))({
    workspaceId: args.workspaceId, userId: args.userId, title: args.prompt.slice(0, 80), agentRole: args.agentRole, origin: args.origin,
  })
  const turnId = await (dependencies.startTurn ?? startSlackTurn)({
    workspaceId: args.workspaceId, userId: args.userId, conversationId: thread.conversationId, prompt: args.prompt, turnId: randomUUID(),
  })
  await (dependencies.startDelivery ?? startSlackDelivery)({
    teamId: args.origin.teamId, channelId: args.origin.channelId, threadTs: args.origin.threadTs, kind: args.origin.kind,
    slackUserId: args.slackUserId, workspaceId: args.workspaceId, userId: args.userId,
    conversationId: thread.conversationId, turnId,
    threadUrl: slackThreadUrl(args.workspaceId, thread.conversationId, thread.agentId),
    offerPrivate: args.agentRole === 'workspace_chief' && args.origin.kind === 'channel',
  })
  return { conversationId: thread.conversationId, turnId }
}

export async function startSlackDelivery(input: SlackReplyInput): Promise<void> {
  await start(slackReplyWorkflow, [input])
}

/** Saves the question as the asker's message and starts the Workspace Overlay's turn; returns the agent's turn id. */
export async function startSlackTurn(args: {
  workspaceId: string; userId: string; conversationId: string; prompt: string; turnId: string
}): Promise<string> {
  const server = getOverlayServerContext()
  const workspace = await server.workspaceService.resolveActiveWorkspace(args.userId, args.workspaceId)
  if (workspace.workspace.id !== args.workspaceId) throw new Error('WORKSPACE_ACCESS_DENIED')
  await server.workspaceGovernanceService.assertWithinLimits({
    action: 'message.send',
    scope: { workspaceId: args.workspaceId, principalId: workspace.principal.id, conversationId: args.conversationId },
  })
  const messageId = await server.appData.repositories.conversationCollaboration.addMessage({
    actorUserId: args.userId,
    conversationId: args.conversationId,
    workspaceId: args.workspaceId,
    turnId: args.turnId,
    clientNonce: args.turnId,
    content: args.prompt,
    parts: [{ type: 'text', text: args.prompt }],
  })
  const invocations = await startWorkspaceAgentTurns({
    actorUserId: args.userId,
    conversationId: args.conversationId,
    initiatorPrincipalId: workspace.principal.id,
    mentionedPrincipalIds: [],
    messageId: String(messageId),
    prompt: args.prompt,
    memoryEnabled: true,
    turnId: args.turnId,
    workspaceId: args.workspaceId,
    strictErrors: true,
  })
  const invocation = invocations[0]
  if (!invocation) throw new Error('The Workspace Overlay did not start.')
  return invocation.turnId
}

const NOT_ALLOWED_TEXT = {
  slack_connect: 'Overlay doesn’t answer in channels shared with other organizations yet.',
  guest: 'Overlay doesn’t answer guests in this workspace.',
} as const

async function handleSlackMessage(bot: SlackBot, thread: SlackBotThread, message: SlackBotMessage): Promise<void> {
  if (message.author.isBot === true || message.author.isMe) return
  const adapter = bot.getAdapter('slack')
  const decoded = adapter.decodeThreadId(thread.id)
  const raw = message.raw as { team?: string; user_team?: string } | undefined
  const teamId = raw?.team ?? raw?.user_team
  if (!teamId) {
    logger.warn('[slack] message without a team id')
    return
  }
  const admission = await admitSlackMessage({
    teamId,
    channelId: decoded.channel,
    threadTs: decoded.threadTs || message.id,
    kind: thread.isDM ? 'dm' : 'channel',
    ...(thread.isDM ? {} : { channelName: await thread.channel.fetchMetadata().then((info) => info.name, () => undefined) }),
    external: adapter.getChannelVisibility(thread.id) === 'external',
    slackUserId: message.author.userId,
    text: message.text,
  })
  if (admission.status === 'link_required') {
    const url = new URL('/api/v1/integrations/slack/link', getBaseUrl())
    url.searchParams.set('workspaceId', admission.workspaceId)
    await thread.postEphemeral(message.author, {
      markdown: 'Connect your Slack account to Overlay so I can answer with your access. [Connect to Overlay](' + url.toString() + ')',
    }, { fallbackToDM: false })
    return
  }
  if (admission.status === 'not_allowed') {
    await thread.postEphemeral(message.author, { markdown: NOT_ALLOWED_TEXT[admission.reason] }, { fallbackToDM: false })
  }
}

/** Registers the bot's event handlers once per instance. */
export function registerSlackHandlers(bot: SlackBot): void {
  const run = (thread: SlackBotThread, message: SlackBotMessage) => handleSlackMessage(bot, thread, message).catch((error: unknown) => {
    logger.error('[slack] could not admit a message', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' })
  })
  bot.onNewMention(run)
  bot.onDirectMessage(run)
  bot.onUninstalled(async (event) => {
    if (event.adapter.name !== 'slack') return
    await convex.mutation('integrations/slack:uninstallByServer', {
      serverSecret: getInternalApiSecret(), teamId: event.conversationId,
    }, call)
  })
}
