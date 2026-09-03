import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

export const MANAGE_ACTION_ID = 'overlay_manage'

/** Deep link to the agent editor. Absolute base URL is injected (testable). */
export function manageAgentUrl(args: {
  baseUrl: string
  workspaceId: string
  agentId: string
}): string {
  const base = args.baseUrl.replace(/\/+$/, '')
  return `${base}/app/w/${encodeURIComponent(args.workspaceId)}/agents/${encodeURIComponent(args.agentId)}`
}

function sectionBlock(markdown: string): Record<string, unknown> {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: markdown.slice(0, 2_900) },
  }
}

/**
 * Action-only button (no `url`): link buttons never dispatch, so the click
 * must arrive as `block_actions` for the conversion event to be recorded.
 * The handler answers with an ephemeral message carrying the direct URL.
 */
function manageButton(agentId: string): Record<string, unknown> {
  return {
    type: 'actions',
    elements: [{
      type: 'button',
      action_id: MANAGE_ACTION_ID,
      text: { type: 'plain_text', text: 'Manage in Overlay' },
      value: agentId,
    }],
  }
}

/** Agent reply: answer text plus the logged Manage entry point. */
export function buildAgentReplyBlocks(args: {
  text: string
  agentId: string
}): { fallback: string; blocks: unknown[] } {
  const text = args.text.trim() || '(empty reply)'
  return {
    fallback: text.slice(0, 300),
    blocks: [sectionBlock(text), manageButton(args.agentId)],
  }
}

/** Ephemeral directory listing; capped so one message never exceeds Slack limits. */
export function buildAgentsDirectoryBlocks(args: {
  agents: WorkspaceAgentDirectoryItem[]
  workspaceId: string
  baseUrl: string
}): { fallback: string; blocks: unknown[] } {
  const shown = args.agents.slice(0, 20)
  const blocks: unknown[] = [{
    type: 'section',
    text: { type: 'mrkdwn', text: '*Workspace agents* — mention the bot with an agent name, or `/overlay ask <name> <question>`.' },
  }]
  for (const agent of shown) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeMrkdwn(agent.name)}*\n${escapeMrkdwn(agent.description ?? agent.instructions).slice(0, 300)}`,
      },
      accessory: {
        type: 'button',
        action_id: MANAGE_ACTION_ID,
        text: { type: 'plain_text', text: 'Manage' },
        value: agent.id,
      },
    })
  }
  if (args.agents.length > shown.length) {
    blocks.push(sectionBlock(`_…and ${args.agents.length - shown.length} more in Overlay._`))
  }
  return { fallback: `${shown.length} workspace agents`, blocks }
}

/** Ephemeral usage help for unknown `/overlay` input. */
export function buildHelpBlocks(): { fallback: string; blocks: unknown[] } {
  return {
    fallback: 'Overlay bot usage',
    blocks: [sectionBlock(
      '*Overlay bot*\n• `/overlay agents` — list workspace agents\n• `/overlay ask <name> <question>` — ask an agent\n• `@bot <name> …` in a channel — ask an agent in a thread',
    )],
  }
}

function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
