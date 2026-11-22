/** Which mockup threads came from Slack. In production this is the conversation's `origin` field. */
export type SlackOrigin = { kind: 'channel' | 'dm'; channel: string; permalink: string }

export const SLACK_ORIGINS: Record<string, SlackOrigin> = {}

export const slackOrigin = (conversationId: string | null | undefined): SlackOrigin | undefined =>
  conversationId ? SLACK_ORIGINS[conversationId] : undefined
