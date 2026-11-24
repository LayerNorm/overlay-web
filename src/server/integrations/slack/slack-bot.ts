import 'server-only'

import type { SlackAdapter } from '@chat-adapter/slack'
import { slackAppConfig } from './slack-app'
import { ConvexSlackState } from './convex-state'

/**
 * The Chat SDK instance behind the Overlay Slack app (internal/develop/slack-integration.md). One singleton per
 * server instance; installations, subscriptions, locks and webhook dedupe live in Convex (ConvexSlackState), so every
 * instance shares them.
 *
 * No literal import specifier for the SDK package may appear in this file. The Workflow builder scans raw source for
 * specifiers and inlines every reachable serde package into the workflow vm, where the SDK throws at module scope.
 * The comment inside the dynamic import keeps it invisible to that scan (src/server/workflows/workflow-imports.test.ts).
 */
async function loadSdk() {
  const [sdk, { createSlackAdapter }] = await Promise.all([
    import(/* workflow-vm-exclusion */ 'chat'),
    import('@chat-adapter/slack'),
  ])
  return { sdk, createSlackAdapter }
}

async function createSlackBot() {
  const config = slackAppConfig()
  if (!config) throw new Error('The Overlay Slack app is not configured.')
  const { sdk, createSlackAdapter } = await loadSdk()
  type BotState = ConstructorParameters<typeof sdk.Chat>[0]['state']
  const instance = new sdk.Chat<{ slack: SlackAdapter }>({
    userName: 'Overlay',
    adapters: {
      slack: createSlackAdapter({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        encryptionKey: config.encryptionKey,
        signingSecret: config.signingSecret,
      }),
    },
    state: new ConvexSlackState() as unknown as BotState,
    // Every message must reach its handler. The default ('drop') throws for a second message in a thread while the
    // first is still being admitted, and the deduped event is then lost; 'queue' keeps only the latest queued message.
    // Handlers are safe to run side by side: each one only reads Convex and calls resolveThreadByServer, a Convex
    // mutation whose transaction retries on conflict, so two messages in one Slack thread find or create the same
    // Overlay thread, and each becomes its own turn there, as two quick messages on the web do.
    concurrency: 'concurrent',
  })
  return Object.assign(instance, { sdk })
}

export type SlackBot = Awaited<ReturnType<typeof createSlackBot>>
export type SlackSdk = SlackBot['sdk']
export type SlackBotThread = Parameters<Parameters<SlackBot['onNewMention']>[0]>[0]
export type SlackBotMessage = Parameters<Parameters<SlackBot['onNewMention']>[0]>[1]

let bot: Promise<SlackBot> | undefined

export function getSlackBot(): Promise<SlackBot> {
  bot ??= createSlackBot().catch((error: unknown) => {
    bot = undefined
    throw error
  })
  return bot
}

/** The adapter for work outside a webhook (OAuth callback, delivery), which never passes through handleWebhook. */
export async function getSlackAdapter(): Promise<SlackAdapter> {
  const instance = await getSlackBot()
  await instance.initialize()
  return instance.getAdapter('slack')
}

/** Runs Slack work outside a webhook as the bot of the workspace that owns teamId. */
export async function withSlackInstallation<T>(teamId: string, work: (instance: SlackBot, adapter: SlackAdapter) => Promise<T>): Promise<T> {
  const instance = await getSlackBot()
  await instance.initialize()
  const adapter = instance.getAdapter('slack')
  const installation = await adapter.getInstallation(teamId)
  if (!installation) throw new Error('SLACK_TEAM_NOT_INSTALLED')
  return await adapter.withBotToken(installation.botToken, () => work(instance, adapter), {
    installationId: teamId, ...(installation.botUserId ? { botUserId: installation.botUserId } : {}),
  })
}

const threadKey = (channelId: string, threadTs: string) => 'slack:' + channelId + ':' + threadTs

/** Posts messages into a Slack thread as the bot of the workspace that owns it. */
export async function postToSlackThread(args: {
  teamId: string
  channelId: string
  threadTs: string
  messages: Array<{ markdown: string }>
}): Promise<void> {
  await withSlackInstallation(args.teamId, async (instance) => {
    const thread = instance.thread(threadKey(args.channelId, args.threadTs))
    for (const message of args.messages) await thread.post({ markdown: message.markdown })
  })
}

/** Shows a message only to one person, in a Slack thread, as the bot of the workspace that owns it. */
export async function postSlackEphemeral(args: {
  teamId: string
  channelId: string
  /** Omit to post at the channel level, which is where Slack shows a note about a new top-level message. */
  threadTs?: string
  slackUserId: string
  markdown: string
}): Promise<void> {
  await withSlackInstallation(args.teamId, async (instance) => {
    await instance.thread(threadKey(args.channelId, args.threadTs ?? '')).postEphemeral(args.slackUserId, { markdown: args.markdown }, { fallbackToDM: false })
  })
}

export const SLACK_ACTIONS = {
  approve: 'overlay_approve',
  deny: 'overlay_deny',
  private: 'overlay_private',
} as const

/** Asks the requester to approve a step, in the Slack thread the request came from. */
export async function postSlackApprovalCard(args: {
  teamId: string
  channelId: string
  threadTs: string
  title: string
  detail: string
  conversationId: string
  agentRunId: string
  threadUrl: string
}): Promise<void> {
  await withSlackInstallation(args.teamId, async (instance) => {
    const { Actions, Button, Card, CardText, LinkButton } = instance.sdk
    const value = JSON.stringify({ c: args.conversationId, r: args.agentRunId })
    await instance.thread(threadKey(args.channelId, args.threadTs)).post(Card({
      title: args.title,
      children: [
        CardText(args.detail),
        Actions([
          Button({ id: SLACK_ACTIONS.approve, label: 'Approve', style: 'primary', value }),
          Button({ id: SLACK_ACTIONS.deny, label: 'Deny', style: 'danger', value }),
          LinkButton({ url: args.threadUrl, label: 'Open in Overlay' }),
        ]),
      ],
    }))
  })
}

/** Offers, only to the requester, to continue a channel request privately with their personal Overlay. */
export async function postSlackPrivateOffer(args: {
  teamId: string
  channelId: string
  threadTs: string
  slackUserId: string
  conversationId: string
}): Promise<void> {
  await withSlackInstallation(args.teamId, async (instance) => {
    const { Actions, Button, Card, CardText } = instance.sdk
    await instance.thread(threadKey(args.channelId, args.threadTs)).postEphemeral(args.slackUserId, Card({
      children: [
        CardText('Overlay doesn’t use your own files, memories or connected accounts in a channel. Your personal Overlay can answer in a DM instead.'),
        Actions([Button({ id: SLACK_ACTIONS.private, label: 'Ask privately', value: JSON.stringify({ c: args.conversationId }) })]),
      ],
    }), { fallbackToDM: false })
  })
}

/** Starts a new thread in the requester's DM with the app; returns where it is. */
export async function startSlackDmThread(args: { teamId: string; slackUserId: string; markdown: string }): Promise<{ channelId: string; threadTs: string }> {
  return await withSlackInstallation(args.teamId, async (instance, adapter) => {
    const threadId = await adapter.openDM(args.slackUserId)
    const sent = await instance.thread(threadId).post({ markdown: args.markdown })
    return { channelId: adapter.decodeThreadId(threadId).channel, threadTs: sent.id }
  })
}
