import 'server-only'

/**
 * Chat SDK adapter module boundary.
 *
 * `@chat-adapter/slack` ships subpath exports with only `types` + `import`
 * conditions (no `require`/`default`). Static imports therefore fail under
 * the repo's tsx-compiled (CJS) unit tests while working in Next.js (ESM).
 * Every runtime use goes through these dynamic loaders, which resolve with
 * the `import` condition everywhere; type-only imports below are fully
 * erased and never touch the resolver at runtime.
 */
import type {
  SlackWebhookPayload,
  readSlackWebhook as readSlackWebhookFn,
} from '@chat-adapter/slack/webhook'
import type {
  SlackApiResponse,
  callSlackApi as callSlackApiFn,
  postSlackEphemeral as postSlackEphemeralFn,
  postSlackMessage as postSlackMessageFn,
} from '@chat-adapter/slack/api'

export type { SlackWebhookPayload }
export type ReadSlackWebhook = typeof readSlackWebhookFn
export type PostSlackMessage = typeof postSlackMessageFn
export type PostSlackEphemeral = typeof postSlackEphemeralFn
export type CallSlackApi = typeof callSlackApiFn
export type SlackApiResponseShape = SlackApiResponse

export function loadSlackWebhook(): Promise<{ readSlackWebhook: ReadSlackWebhook }> {
  return import('@chat-adapter/slack/webhook')
}

export function loadSlackApi(): Promise<{
  postSlackMessage: PostSlackMessage
  postSlackEphemeral: PostSlackEphemeral
  callSlackApi: CallSlackApi
}> {
  return import('@chat-adapter/slack/api')
}
