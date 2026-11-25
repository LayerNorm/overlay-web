import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentReasoningLevel,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { getEffectiveReasoningForModel } from '@overlay/chat-core'
import type { ReasoningModelCapabilities } from '@overlay/chat-core'
import { toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'

export function workspaceAgentReasoningForSave({
  modelId,
  reasoning,
  reasoningModels,
  existingModelId,
  existingReasoning,
}: {
  modelId: string
  reasoning?: WorkspaceAgentReasoningLevel
  reasoningModels: readonly ReasoningModelCapabilities[]
  existingModelId?: string
  existingReasoning?: WorkspaceAgentReasoningLevel
}): WorkspaceAgentReasoningLevel | undefined {
  const effective = getEffectiveReasoningForModel(
    reasoningModels.find((model) => model.id === modelId),
    reasoning,
  )
  if (effective) return effective
  if (existingModelId === modelId && existingReasoning && existingReasoning !== 'provider-default') {
    return 'provider-default'
  }
  return undefined
}

/** Builds the agent create/update payload from editor state. */
export function buildWorkspaceAgentInput(args: {
  name: string
  description: string
  instructions: string
  modelId: string
  avatarColor: string
  avatarShape: WorkspaceAgentCreatureShape
  enabledToolGroups: ReadonlySet<string>
  /** Set only when creating: a saved agent's access changes only through the confirmed, one-way move. */
  visibility?: WorkspaceAgentVisibility
  permissionMode?: 'ask' | 'auto'
  reasoning?: WorkspaceAgentReasoningLevel
}): WorkspaceAgentCreateInput {
  return {
    name: args.name.trim(),
    description: args.description.trim(),
    instructions: args.instructions.trim(),
    harness: 'overlay',
    modelId: args.modelId.trim(),
    avatarColor: args.avatarColor,
    avatarShape: args.avatarShape,
    allowedToolIds: toolIdsForEnabledGroups(args.enabledToolGroups),
    ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
    permissionMode: args.permissionMode ?? 'ask',
    ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
  }
}

/** The built-in master agent renders the master notice and skips deletion. */
export function isDefaultMasterAgent(
  agent: { isDefault?: boolean; agentRole?: string; name: string } | null | undefined,
): boolean {
  return Boolean(agent && (agent.isDefault || agent.agentRole === 'workspace_chief' || agent.agentRole === 'personal_chief'))
}

/** Mirrors the editor's save gating: a name, instructions and a model. */
export function isAgentEditorValid(args: {
  name: string
  instructions: string
  modelId: string
}): boolean {
  return Boolean(args.name.trim() && args.instructions.trim() && args.modelId.trim())
}
