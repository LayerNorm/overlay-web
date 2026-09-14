/**
 * System-prompt and message helpers for surface turns — agent responses to
 * messages that arrive on an external platform (Slack first).
 */

export type SurfacePromptContext = {
  platform: string
  channelName?: string
  agentName: string
  agentInstructions?: string
}

const PLATFORM_LABELS: Record<string, string> = {
  slack: 'Slack',
}

export function surfacePlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}

/**
 * Title for the Overlay conversation backing a surface thread — what the
 * chats list shows ("Slack · #fundraising").
 */
export function surfaceConversationTitle(input: {
  platform: string
  channelName?: string
  channelId: string
}): string {
  const channel = input.channelName ?? input.channelId
  return `${surfacePlatformLabel(input.platform)} · #${channel}`
}

/**
 * The agent's persona prompt plus a short surface-context note, appended to
 * the standard act-turn instructions as the secondary extension.
 */
export function buildSurfaceSystemPrompt(input: SurfacePromptContext): string {
  const platformLabel = surfacePlatformLabel(input.platform)
  const where = input.channelName ? ` in #${input.channelName}` : ''
  return [
    input.agentInstructions?.trim() ?? '',
    `You are ${input.agentName}, replying on ${platformLabel}${where}.`,
    'Keep replies concise and use plain markdown formatting that renders well on the platform.',
    'Files, artifacts, and conversations you produce live in Overlay, not on the platform — reference them by name.',
    'If a tool requires interactive approval, it cannot run here — say so briefly instead of waiting.',
  ].filter(Boolean).join('\n')
}

/**
 * Strip Slack mention markup (`<@U123>`, `<!channel>`) from inbound text so
 * the model sees what the human typed. Returns '' when nothing remains.
 */
export function stripSlackMentionMarkup(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/gi, '')
    .replace(/<!(?:channel|here|everyone)>/gi, '')
    .trim()
}
