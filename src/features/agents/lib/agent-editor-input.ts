import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentReasoningLevel,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { getEffectiveReasoningForModel } from '@overlay/chat-core'
import type { ReasoningModelCapabilities } from '@overlay/chat-core'
import { byoModelId } from '@/shared/agents/agent-model'
import { toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { generatedByoInstructions, workspaceHarnessForByo } from './byo-agent-setup'

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

/** Builds the agent create/update payload from editor state (overlay + BYO shapes). */
export function buildWorkspaceAgentInput(args: {
  name: string
  description: string
  instructions: string
  agentType: 'overlay' | 'byo'
  harnessLabel: string
  adapterId: string
  modelId: string
  avatarColor: string
  avatarShape: WorkspaceAgentCreatureShape
  enabledToolGroups: ReadonlySet<string>
  visibility: WorkspaceAgentVisibility
  permissionMode?: 'ask' | 'auto'
  reasoning?: WorkspaceAgentReasoningLevel
  /** The Overlay tools a connected agent may use over MCP (Overlay Cloud agents); other connected agents hold none. */
  mcpToolIds?: readonly string[]
  /** A connected agent's chosen model (its own model id); empty means the agent's default. */
  byoModel?: string
}): WorkspaceAgentCreateInput {
  const byo = args.agentType === 'byo'
  return {
    name: args.name.trim(),
    description: args.description.trim(),
    instructions: byo ? generatedByoInstructions(args.harnessLabel) : args.instructions.trim(),
    harness: byo ? workspaceHarnessForByo(args.adapterId) : 'overlay',
    modelId: byo ? byoModelId(args.adapterId, args.byoModel) : args.modelId.trim(),
    avatarColor: args.avatarColor,
    avatarShape: args.avatarShape,
    // Connected agents own their tool surface on their own machine — Overlay's
    // tool-group grants apply to the native agent only.
    allowedToolIds: byo ? [...(args.mcpToolIds ?? [])] : toolIdsForEnabledGroups(args.enabledToolGroups),
    visibility: args.visibility,
    ...(byo ? {} : {
      permissionMode: args.permissionMode ?? 'ask',
      ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
    }),
  }
}

/** The built-in master agent renders the master notice and skips deletion. */
export function isDefaultMasterAgent(
  agent: { isDefault?: boolean; agentRole?: string; name: string } | null | undefined,
): boolean {
  return Boolean(agent && (agent.isDefault || agent.agentRole === 'workspace_chief' || agent.agentRole === 'personal_chief'))
}

/** Mirrors the editor's save gating: identity plus either overlay behavior or a valid BYO binding. */
export function isAgentEditorValid(args: {
  name: string
  instructions: string
  modelId: string
  agentType: 'overlay' | 'byo'
  /** A removed hosted runtime: the agent is read-only. */
  legacyHostedRuntime: boolean
  connectedAgentsEnabled: boolean
  bindingValid: boolean
}): boolean {
  if (!args.name.trim()) return false
  if (args.agentType === 'overlay' && args.legacyHostedRuntime) return false
  return Boolean(args.agentType === 'overlay'
    ? args.instructions.trim() && args.modelId.trim()
    : args.connectedAgentsEnabled && args.bindingValid)
}
