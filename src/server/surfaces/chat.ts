import 'server-only'

import type { SlackAdapter } from '@chat-adapter/slack'
import { resolveConvexUrl } from '@/server/database/convex-url'
import { ConvexChatStateAdapter } from './convex-chat-state'

/**
 * Chat SDK normalization layer for external surfaces. The instance is a
 * singleton: Slack installations, thread subscriptions, locks, and webhook
 * dedup all resolve through its state adapter.
 *
 * The SDK packages are ESM-only (`exports` declares `import` but no
 * `require`/`default`), so they load via dynamic import — server contexts
 * that never touch surfaces (tests, the no-Convex runtime) must be able to
 * import this module without resolving the SDK.
 *
 * State backend: Convex (ConvexChatStateAdapter), so installations, bot
 * tokens, subscriptions, locks, and dedupe keys are shared by every serverless
 * instance and survive deploys. In-memory state is used only when no Convex
 * deployment is configured (unit tests, offline local runs); it cannot carry
 * an OAuth install from the callback instance to the webhook instance.
 *
 * IMPORTANT: no literal specifier for the Chat SDK package may appear in this
 * file — not in imports, type imports, or dynamic imports. The Workflow
 * builder's fast-discovery scans raw source (comments included) and serializes
 * every reachable serde-registered package into the workflow vm bundle; the
 * SDK's serde chunk throws at module scope there. The comment inside the
 * dynamic import below keeps it invisible to that scan — do not remove it.
 * See src/server/workflows/workflow-imports.test.ts.
 */
async function createSurfaceChat() {
  const [{ Chat }, { createSlackAdapter }] = await Promise.all([
    import(/* workflow-vm-exclusion */ 'chat'),
    import('@chat-adapter/slack'),
  ])
  // The adapter is typed structurally (see convex-chat-state.ts); its queue
  // entries are the JSON-parsed Message payloads the Postgres adapter returns.
  type SurfaceChatState = ConstructorParameters<typeof Chat>[0]['state']
  const state: SurfaceChatState = resolveConvexUrl(process.env).url
    ? new ConvexChatStateAdapter() as unknown as SurfaceChatState
    : (await import('@chat-adapter/state-memory')).createMemoryState()
  return new Chat<{ slack: SlackAdapter }>({
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

export type SurfaceChat = Awaited<ReturnType<typeof createSurfaceChat>>
export type SurfaceInboundThread = Parameters<
  Parameters<SurfaceChat['onNewMention']>[0]
>[0]
export type SurfaceInboundMessage = Parameters<
  Parameters<SurfaceChat['onNewMention']>[0]
>[1]

let chatInstance: SurfaceChat | undefined

export async function getSurfaceChat(): Promise<SurfaceChat> {
  chatInstance ??= await createSurfaceChat()
  return chatInstance
}

export async function getSlackAdapter(): Promise<SlackAdapter> {
  const chat = await getSurfaceChat()
  // Non-webhook paths (OAuth callback, channel listing, outbound posts) never
  // pass through Chat.handleWebhook, which is the only place the SDK
  // auto-initializes. Without this the adapter has no bound Chat instance and
  // setInstallation/postMessage throw VALIDATION_ERROR.
  await chat.initialize()
  return chat.getAdapter('slack')
}

/** OAuth and webhooks both need these; surfaces stay off when unset. */
export function slackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID
    && process.env.SLACK_CLIENT_SECRET
    && process.env.SLACK_SIGNING_SECRET,
  )
}
