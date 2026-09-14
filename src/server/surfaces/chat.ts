import 'server-only'

import { Chat } from 'chat'
import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createPostgresState } from '@chat-adapter/state-pg'

/**
 * Chat SDK normalization layer for external surfaces. The instance is a
 * singleton: Slack installations, thread subscriptions, locks, and webhook
 * dedup all resolve through its state adapter.
 *
 * State backend: Postgres when the app-data database is configured
 * (OVERLAY_DATABASE_URL) so installations survive deploys; in-memory for local
 * development and tests. A repository-backed adapter is the documented
 * follow-up for Convex-parity.
 */
let chatInstance: Chat<{ slack: SlackAdapter }> | undefined

export function getSurfaceChat(): Chat<{ slack: SlackAdapter }> {
  chatInstance ??= new Chat<{ slack: SlackAdapter }>({
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
    state: process.env.OVERLAY_DATABASE_URL
      ? createPostgresState({ url: process.env.OVERLAY_DATABASE_URL })
      : createMemoryState(),
  })
  return chatInstance
}

export function getSlackAdapter(): SlackAdapter {
  return getSurfaceChat().getAdapter('slack')
}

/** OAuth and webhooks both need these; surfaces stay off when unset. */
export function slackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID
    && process.env.SLACK_CLIENT_SECRET
    && process.env.SLACK_SIGNING_SECRET,
  )
}
