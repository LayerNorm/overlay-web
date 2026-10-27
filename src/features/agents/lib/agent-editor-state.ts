import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { AVATAR_FALLBACK_COLOR } from './agent-editor-utils'

export function getInitialEditorState(args: {

  mode: 'new' | 'edit'
  agent: WorkspaceAgentDirectoryItem | null
}) {
  const { agent } = args
  return {
    agent,
    loading: true,
    canCreate: args.mode === 'edit',
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    instructions: agent?.instructions ?? '',
    modelId: agent?.modelId ?? DEFAULT_MODEL_ID,
    avatarColor: agent?.avatarColor ?? AVATAR_FALLBACK_COLOR,
    avatarShape: agent?.avatarShape ?? 'circle',
    visibility: agent?.visibility ?? 'workspace',
    permissionMode: agent?.permissionMode === 'auto' ? 'auto' : 'ask',
  }
}
