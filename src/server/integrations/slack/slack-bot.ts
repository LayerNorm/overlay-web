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
async function createSlackBot() {
  const config = slackAppConfig()
  if (!config) throw new Error('The Overlay Slack app is not configured.')
  const [{ Chat }, { createSlackAdapter }] = await Promise.all([
    import(/* workflow-vm-exclusion */ 'chat'),
    import('@chat-adapter/slack'),
  ])
  type BotState = ConstructorParameters<typeof Chat>[0]['state']
  return new Chat<{ slack: SlackAdapter }>({
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
  })
}

export type SlackBot = Awaited<ReturnType<typeof createSlackBot>>
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

/** Posts messages into a Slack thread as the bot of the workspace that owns it. */
export async function postToSlackThread(args: {
  teamId: string
  channelId: string
  threadTs: string
  messages: Array<{ markdown: string }>
}): Promise<void> {
  const instance = await getSlackBot()
  await instance.initialize()
  const adapter = instance.getAdapter('slack')
  const installation = await adapter.getInstallation(args.teamId)
  if (!installation) throw new Error('SLACK_TEAM_NOT_INSTALLED')
  await adapter.withBotToken(installation.botToken, async () => {
    const thread = instance.thread('slack:' + args.channelId + ':' + args.threadTs)
    for (const message of args.messages) await thread.post({ markdown: message.markdown })
  }, { installationId: args.teamId, ...(installation.botUserId ? { botUserId: installation.botUserId } : {}) })
}
