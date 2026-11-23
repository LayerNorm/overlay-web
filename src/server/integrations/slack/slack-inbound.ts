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
import { postSlackEphemeral, type SlackBot, type SlackBotMessage, type SlackBotThread } from './slack-bot'

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
  /** Who can ask lets this linked member ask (not blocked, or on the allow list). */
  allowed: boolean
}

export type SlackInbound = {
  teamId: string
  channelId: string
  threadTs: string
  kind: 'channel' | 'dm'
  channelName?: string
  external: boolean
  /** The asker belongs to another organization's Slack workspace (a Slack Connect channel). */
  outsider: boolean
  slackUserId: string
  /** The question as markdown, already converted from Slack's markup by slackPromptText. */
  text: string
  /** Asked inside an existing Slack thread (not a new top-level message). */
  inThread?: boolean
}

export type SlackAgentRole = 'workspace_chief' | 'personal_chief'

export type SlackOrigin = {
  platform: 'slack'; teamId: string; channelId: string; threadTs: string; kind: 'channel' | 'dm'; channelName?: string
}

export type SlackAdmission =
  | { status: 'started'; conversationId: string; turnId: string }
  | { status: 'not_installed' }
  | { status: 'link_required'; workspaceId: string }
  | { status: 'not_allowed'; reason: 'slack_connect' | 'outsider' | 'guest' | 'not_listed' }
  | { status: 'empty' }
  /** Admitted, but the turn could not start (governance, budget, no Overlay to answer); openUrl shows why. */
  | { status: 'start_failed'; openUrl: string }

export type SlackAdmissionDependencies = {
  resolveRequester?: (args: { teamId: string; slackUserId: string }) => Promise<SlackRequester | null>
  resolveThread?: (args: {
    workspaceId: string; userId: string; principalId: string; title: string; agentRole: SlackAgentRole; origin: SlackOrigin
  }) => Promise<{ conversationId: string; agentId: string; created: boolean }>
  startTurn?: (args: {
    workspaceId: string; userId: string; conversationId: string; prompt: string; turnId: string
  }) => Promise<string>
  startDelivery?: (input: SlackReplyInput) => Promise<void>
}

const call = { throwOnError: true } as const

/**
 * Turns a Slack message's raw text (mrkdwn) into the markdown question the agent reads: links keep their URLs
 * (`<url|label>` becomes `[label](url)`), people and channels read as names where known, and the bot's own mention,
 * which only addressed the question, is removed.
 */
export function slackPromptText(text: string, options: { botUserId?: string; names?: ReadonlyMap<string, string> } = {}): string {
  const withoutBot = options.botUserId && /^[A-Z0-9]+$/.test(options.botUserId)
    ? text.replace(new RegExp('<@' + options.botUserId + '(?:\\|[^>]*)?>[:,]?', 'g'), ' ')
    : text
  const converted = withoutBot.replace(/<([^<>\n]+)>/g, (token, inner: string) => {
    const pipe = inner.indexOf('|')
    const target = pipe < 0 ? inner : inner.slice(0, pipe)
    const label = pipe < 0 ? '' : inner.slice(pipe + 1)
    if (target.startsWith('@')) {
      const name = label || options.names?.get(target.slice(1))
      return name ? '@' + name : token
    }
    if (target.startsWith('#')) return label ? '#' + label : token
    // <!here>, <!channel>, <!subteam^S1|@team>, <!date^…|fallback>
    if (target.startsWith('!')) return label || '@' + target.slice(1).split('^')[0]
    if (!label || label === target || 'mailto:' + label === target) return label || target
    return '[' + label + '](' + target + ')'
  })
  return converted
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
}

/** Raised when a Slack request was admitted but its turn could not start; openUrl is where Overlay shows why. */
export class SlackRequestStartError extends Error {
  constructor(readonly openUrl: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The Slack request could not start.', { cause })
    this.name = 'SlackRequestStartError'
  }
}

export function slackWorkspaceUrl(workspaceId: string): string {
  return getBaseUrl() + buildWorkspaceHref(workspaceId, '/app/agents')
}

export function slackThreadUrl(workspaceId: string, conversationId: string, agentId: string): string {
  const params = new URLSearchParams({ id: conversationId, agent: agentId })
  return getBaseUrl() + buildWorkspaceHref(workspaceId, '/app/agents?' + params.toString())
}

export async function admitSlackMessage(input: SlackInbound, dependencies: SlackAdmissionDependencies = {}): Promise<SlackAdmission> {
  const prompt = input.text.trim()
  if (!prompt) return { status: 'empty' }
  const requester = await (dependencies.resolveRequester ?? ((args) => convex.query<SlackRequester | null>(
    'integrations/slack:resolveRequesterByServer', { serverSecret: getInternalApiSecret(), ...args }, call,
  ).then((value) => value ?? null)))({ teamId: input.teamId, slackUserId: input.slackUserId })
  if (!requester) return { status: 'not_installed' }
  if (input.external && !requester.settings.slackConnect) return { status: 'not_allowed', reason: 'slack_connect' }
  if (input.outsider) return { status: 'not_allowed', reason: 'outsider' }
  if (!requester.userId || !requester.principalId) return { status: 'link_required', workspaceId: requester.workspaceId }
  if (requester.guest && !requester.settings.guests) return { status: 'not_allowed', reason: 'guest' }
  if (!requester.allowed) return { status: 'not_allowed', reason: 'not_listed' }
  try {
    const started = await startSlackRequest({
      workspaceId: requester.workspaceId, userId: requester.userId, principalId: requester.principalId, slackUserId: input.slackUserId, prompt,
      agentRole: 'workspace_chief',
      origin: {
        platform: 'slack', teamId: input.teamId, channelId: input.channelId, threadTs: input.threadTs, kind: input.kind,
        ...(input.channelName ? { channelName: input.channelName } : {}),
      },
    }, dependencies)
    return { status: 'started', ...started }
  } catch (error) {
    logger.warn('[slack] could not start a request', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' })
    return {
      status: 'start_failed',
      openUrl: error instanceof SlackRequestStartError ? error.openUrl : slackWorkspaceUrl(requester.workspaceId),
    }
  }
}

/** What the asker is told, only to them, when Overlay won't or couldn't take the question; null when nothing. */
export function slackAdmissionNotice(admission: SlackAdmission): string | null {
  if (admission.status === 'not_allowed') return NOT_ALLOWED_TEXT[admission.reason]
  if (admission.status === 'start_failed') return 'Overlay couldn’t start on this. [Open Overlay](' + admission.openUrl + ') to see why.'
  return null
}

/**
 * Runs one Slack request in the asker's own thread under the chosen Overlay, and starts the workflow that posts the
 * reply back to the Slack thread.
 */
export async function startSlackRequest(args: {
  workspaceId: string
  userId: string
  principalId: string
  slackUserId: string
  prompt: string
  agentRole: SlackAgentRole
  origin: SlackOrigin
}, dependencies: SlackAdmissionDependencies = {}): Promise<{ conversationId: string; turnId: string }> {
  const thread = await (dependencies.resolveThread ?? ((resolve) => convex.mutation<{ conversationId: string; agentId: string; created: boolean }>(
    'integrations/slack:resolveThreadByServer', { serverSecret: getInternalApiSecret(), ...resolve }, call,
  ).then((value) => value!)))({
    workspaceId: args.workspaceId, userId: args.userId, principalId: args.principalId, title: args.prompt.slice(0, 80), agentRole: args.agentRole, origin: args.origin,
  })
  const threadUrl = slackThreadUrl(args.workspaceId, thread.conversationId, thread.agentId)
  try {
    const turnId = await (dependencies.startTurn ?? startSlackTurn)({
      workspaceId: args.workspaceId, userId: args.userId, conversationId: thread.conversationId, prompt: args.prompt, turnId: randomUUID(),
    })
    await (dependencies.startDelivery ?? startSlackDelivery)({
      teamId: args.origin.teamId, channelId: args.origin.channelId, threadTs: args.origin.threadTs, kind: args.origin.kind,
      slackUserId: args.slackUserId, workspaceId: args.workspaceId, userId: args.userId,
      conversationId: thread.conversationId, turnId, threadUrl,
      offerPrivate: args.agentRole === 'workspace_chief' && args.origin.kind === 'channel',
    })
    return { conversationId: thread.conversationId, turnId }
  } catch (error) {
    // The thread exists, so the asker can open it and see the failure Overlay recorded there.
    throw new SlackRequestStartError(threadUrl, error)
  }
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
  slack_connect: 'Overlay doesn’t answer in channels shared with other organizations here.',
  outsider: 'Overlay only answers members of the workspace that added it.',
  guest: 'Overlay doesn’t answer guests in this workspace.',
  not_listed: 'You can’t ask Overlay in Slack. Ask a workspace owner or admin for access.',
} as const

/** A question from someone who still has to link waits this long for them to finish linking. */
const PENDING_REQUEST_TTL_MS = 60 * 60 * 1000
const pendingRequestKey = (teamId: string, slackUserId: string) => 'overlay:pending:' + teamId + ':' + slackUserId

async function savePendingRequest(input: SlackInbound): Promise<void> {
  await convex.mutation('integrations/slack:stateSet', {
    serverSecret: getInternalApiSecret(), key: pendingRequestKey(input.teamId, input.slackUserId), value: input, ttlMs: PENDING_REQUEST_TTL_MS,
  }, call)
}

/**
 * Runs the question someone asked before linking, once Sign in with Slack proves they are that Slack user. It goes
 * through the same admission as a new message, so the current settings still decide.
 */
export async function resumeSlackRequestAfterLink(
  args: { teamId: string; slackUserId: string },
  dependencies: SlackAdmissionDependencies & {
    takePending?: (key: string) => Promise<SlackInbound | null>
    notify?: typeof postSlackEphemeral
  } = {},
): Promise<SlackAdmission | null> {
  const take = dependencies.takePending ?? ((key) => convex.mutation<SlackInbound | null>('integrations/slack:stateTake', {
    serverSecret: getInternalApiSecret(), key,
  }, call).then((value) => value ?? null))
  const pending = await take(pendingRequestKey(args.teamId, args.slackUserId))
  if (!pending || pending.teamId !== args.teamId || pending.slackUserId !== args.slackUserId) return null
  const admission = await admitSlackMessage(pending, dependencies)
  // They asked in Slack, so a refusal or failure is told there, only to them, where the question was asked.
  const notice = slackAdmissionNotice(admission)
  if (notice) {
    await (dependencies.notify ?? postSlackEphemeral)({
      teamId: pending.teamId, channelId: pending.channelId, threadTs: pending.inThread ? pending.threadTs : undefined,
      slackUserId: pending.slackUserId, markdown: notice,
    })
  }
  return admission
}

/** The Slack workspace the app is installed in for this request; falls back to the event's team. */
function installedTeamId(adapter: ReturnType<SlackBot['getAdapter']>, raw: { team?: string; team_id?: string } | undefined) {
  try {
    const scope = JSON.parse(adapter.getConcurrencyScope() ?? 'null') as unknown
    if (Array.isArray(scope) && scope[0] === 'installation' && typeof scope[1] === 'string') return scope[1]
  } catch (_error) {
    // Single-workspace mode has no scope.
  }
  return raw?.team_id ?? raw?.team
}

async function handleSlackMessage(bot: SlackBot, thread: SlackBotThread, message: SlackBotMessage): Promise<void> {
  if (message.author.isBot === true || message.author.isMe) return
  const adapter = bot.getAdapter('slack')
  const decoded = adapter.decodeThreadId(thread.id)
  const raw = message.raw as { team?: string; team_id?: string; user_team?: string; text?: string; ts?: string; thread_ts?: string } | undefined
  const teamId = installedTeamId(adapter, raw)
  const authorTeamId = raw?.user_team ?? raw?.team ?? teamId
  if (!teamId) {
    logger.warn('[slack] message without a team id')
    return
  }
  // Slack sets thread_ts only on a reply inside an existing thread.
  const inThread = Boolean(raw?.thread_ts && raw.thread_ts !== raw.ts)
  const inbound: SlackInbound = {
    teamId,
    channelId: decoded.channel,
    threadTs: decoded.threadTs || message.id,
    kind: thread.isDM ? 'dm' : 'channel',
    ...(thread.isDM ? {} : { channelName: await thread.channel.fetchMetadata().then((info) => info.name, () => undefined) }),
    external: adapter.getChannelVisibility(thread.id) === 'external',
    outsider: authorTeamId !== teamId,
    slackUserId: message.author.userId,
    text: await promptFromSlack(adapter, typeof raw?.text === 'string' ? raw.text : message.text),
    ...(inThread ? { inThread: true } : {}),
  }
  // Slack shows a private note sent into a thread only to people viewing that thread. A new top-level message has no
  // thread yet (the SDK still names its thread after the message), so its notes go to the channel, still only visible
  // to the asker.
  const notes = inThread || thread.isDM ? thread : thread.channel
  const admission = await admitSlackMessage(inbound)
  if (admission.status === 'link_required') {
    await savePendingRequest(inbound).catch((error: unknown) => {
      logger.warn('[slack] could not save a request until linking', { reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
    })
    const url = new URL('/api/v1/integrations/slack/link', getBaseUrl())
    url.searchParams.set('workspaceId', admission.workspaceId)
    await notes.postEphemeral(message.author, {
      markdown: 'Connect your Slack account to Overlay so I can answer with your access. I’ll answer this once you’re linked. [Connect to Overlay](' + url.toString() + ')',
    }, { fallbackToDM: false })
    return
  }
  const notice = slackAdmissionNotice(admission)
  if (notice) await notes.postEphemeral(message.author, { markdown: notice }, { fallbackToDM: false })
}

/** The question from a message's raw Slack text, with mentioned people's names looked up (cached by the adapter). */
async function promptFromSlack(adapter: ReturnType<SlackBot['getAdapter']>, rawText: string): Promise<string> {
  const botUserId = adapter.botUserId
  const ids = [...new Set([...rawText.matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]!))].filter((id) => id !== botUserId)
  const names = new Map<string, string>()
  await Promise.all(ids.slice(0, 20).map(async (id) => {
    const user = await adapter.getUser(id).catch((_error: unknown) => null)
    const name = user?.fullName || user?.userName
    if (name) names.set(id, name)
  }))
  return slackPromptText(rawText, { ...(botUserId ? { botUserId } : {}), names })
}

type SlackTokensRevokedPayload = {
  type?: string
  team_id?: string
  event?: { type?: string; tokens?: { bot?: unknown[] } }
}

/**
 * Slack sends tokens_revoked when the bot token is revoked while the app stays installed; the Chat SDK does not pass
 * it to handlers. A revoked bot token can't post anything, so the installation is removed like an uninstall. Revoked
 * user tokens alone (Sign in with Slack) leave the installation alone. Call only with a body whose signature passed.
 */
export async function handleSlackTokensRevoked(
  body: string,
  uninstall: (teamId: string) => Promise<void> = (teamId) => convex.mutation('integrations/slack:uninstallByServer', {
    serverSecret: getInternalApiSecret(), teamId,
  }, call).then(() => undefined),
): Promise<boolean> {
  let payload: SlackTokensRevokedPayload
  try {
    payload = JSON.parse(body) as SlackTokensRevokedPayload
  } catch (_error) {
    return false
  }
  if (payload.type !== 'event_callback' || payload.event?.type !== 'tokens_revoked') return false
  const bot = payload.event.tokens?.bot
  if (!Array.isArray(bot) || bot.length === 0 || !payload.team_id) return false
  await uninstall(payload.team_id)
  return true
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
