import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { AVATAR_COLORS } from '../components/AgentEditorForm'
import { SHOWCASE_AGENTS } from './showcase-agents'

export function getShowcaseAgent(
  showcase: boolean,
  mode: 'new' | 'edit',
  agentId: string | undefined,
): WorkspaceAgentDirectoryItem | null {
  if (!showcase || mode !== 'edit') return null
  return SHOWCASE_AGENTS.find((candidate) => candidate.id === agentId) ?? null
}

export function getInitialEditorState(args: {
  showcase: boolean
  mode: 'new' | 'edit'
  agent: WorkspaceAgentDirectoryItem | null
}) {
  const { agent } = args
  return {
    agent,
    loading: !args.showcase,
    canCreate: args.showcase || args.mode === 'edit',
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    instructions: agent?.instructions ?? '',
    modelId: agent?.modelId ?? DEFAULT_MODEL_ID,
    avatarColor: agent?.avatarColor ?? AVATAR_COLORS[0]!,
    avatarShape: agent?.avatarShape ?? 'circle',
    visibility: agent?.visibility ?? 'workspace',
  }
}
