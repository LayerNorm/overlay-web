import 'server-only'

import type { Chat } from 'chat'
import type { SlackAdapter } from '@chat-adapter/slack'

/**
 * Chat SDK normalization layer for external surfaces. The instance is a
 * singleton: Slack installations, thread subscriptions, locks, and webhook
 * dedup all resolve through its state adapter.
 *
 * The SDK packages are ESM-only (`exports` declares `import` but no
 * `require`/`default`), so they load via dynamic import — server contexts
 * that never touch surfaces (tests, the no-Convex runtime) must be able to
 * import this module without resolving `chat`.
 *
 * State backend: Postgres when the app-data database is configured
 * (OVERLAY_DATABASE_URL) so installations survive deploys; in-memory for local
 * development and tests. A repository-backed adapter is the documented
 * follow-up for Convex-parity.
 */
let chatInstance: Chat<{ slack: SlackAdapter }> | undefined

export async function getSurfaceChat(): Promise<Chat<{ slack: SlackAdapter }>> {
  if (!chatInstance) {
    const [{ Chat }, { createSlackAdapter }] = await Promise.all([
      import('chat'),
      import('@chat-adapter/slack'),
    ])
    const state = process.env.OVERLAY_DATABASE_URL
      ? (await import('@chat-adapter/state-pg')).createPostgresState({
          url: process.env.OVERLAY_DATABASE_URL,
        })
      : (await import('@chat-adapter/state-memory')).createMemoryState()
    chatInstance = new Chat<{ slack: SlackAdapter }>({
      userName: 'Overlay',
      adapters: {
        slack: createSlackAdapter({
          agentView: true,
          clientId: process.env.SLACK_CLIENT_ID,
          clientSecret: process.env.SLACK_CLIENT_SECRET,
          encryptionKey: process.env.SLACK_ENCRYPTION_KEY,
          signingSecret: process.env.SLACK_SIGNING_SECRET,
        }),
      },
      state,
    })
  }
  return chatInstance
}

export async function getSlackAdapter(): Promise<SlackAdapter> {
  return (await getSurfaceChat()).getAdapter('slack')
}

/** OAuth and webhooks both need these; surfaces stay off when unset. */
export function slackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID
    && process.env.SLACK_CLIENT_SECRET
    && process.env.SLACK_SIGNING_SECRET,
  )
}
