import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

export type OverlaySlashCommand =
  | { action: 'agents' }
  | { action: 'ask'; query: string }
  | { action: 'help' }

/**
 * Matches a Slack message against the actor-visible agent directory.
 * Mention tokens are stripped, then the longest agent name that opens the
 * remaining text wins; otherwise the workspace default agent answers.
 * The directory is pre-filtered by visibility, so creator-only agents are
 * unmatchable by anyone but their creator — no existence check needed here.
 */
export function resolveMentionedAgent(args: {
  text: string
  visibleAgents: WorkspaceAgentDirectoryItem[]
}): WorkspaceAgentDirectoryItem | null {
  if (args.visibleAgents.length === 0) return null
  const rest = normalizeMentionText(args.text)
  const ranked = [...args.visibleAgents].sort((a, b) => b.name.length - a.name.length)
  for (const agent of ranked) {
    const name = agent.name.toLowerCase().trim()
    if (!name) continue
    if (rest === name || (rest.startsWith(name) && !isWordChar(rest[name.length] ?? ''))) {
      return agent
    }
  }
  return defaultAgent(args.visibleAgents)
}

/** Parses `/overlay` invocations: bare/`agents` list, `ask …` runs, else help. */
export function parseOverlayCommand(args: {
  command: string
  text: string
}): OverlaySlashCommand {
  if (args.command.trim() !== '/overlay') return { action: 'help' }
  const text = args.text.trim()
  if (!text || text.toLowerCase() === 'agents') return { action: 'agents' }
  const ask = /^ask\s+([\s\S]+)$/i.exec(text)
  if (ask?.[1]?.trim()) return { action: 'ask', query: ask[1].trim() }
  return { action: 'help' }
}

export function defaultAgent(
  visibleAgents: WorkspaceAgentDirectoryItem[],
): WorkspaceAgentDirectoryItem | null {
  return visibleAgents.find((agent) => agent.isDefault || agent.name.toLowerCase() === 'overlay')
    ?? visibleAgents[0]
    ?? null
}

function normalizeMentionText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/^[\s,:;\-–—!?.]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isWordChar(char: string): boolean {
  return char !== '' && /[\p{L}\p{N}_]/u.test(char)
}
