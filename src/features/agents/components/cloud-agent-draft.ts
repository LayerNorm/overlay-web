import type { AgentProviderId } from '@/shared/agents/provider-accounts'

export type OtherAgentDraft = {
  adapterId: AgentProviderId
  runsOn: 'cloud' | 'machine'
  providerAccountId: string
}

export const OTHER_AGENT_LABEL: Record<AgentProviderId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  cursor: 'Cursor',
}

export function initialOtherAgentDraft(): OtherAgentDraft {
  return { adapterId: 'claude-code', runsOn: 'cloud', providerAccountId: '' }
}

/** An agent on Overlay Cloud needs a name and an account; its instructions are optional (the agent has its own). */
export function isOtherAgentDraftValid(name: string, other: OtherAgentDraft): boolean {
  return Boolean(name.trim() && other.runsOn === 'cloud' && other.providerAccountId)
}
