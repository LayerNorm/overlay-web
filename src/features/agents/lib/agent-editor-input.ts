import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentPlatform,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { generatedByoInstructions, workspaceHarnessForByo } from './byo-agent-setup'

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
  enabledToolGroups: ReadonlySet<string>
  visibility: WorkspaceAgentVisibility
  platforms: WorkspaceAgentPlatform[]
}): WorkspaceAgentCreateInput {
  const byo = args.agentType === 'byo'
  return {
    name: args.name.trim(),
    description: args.description.trim() || undefined,
    instructions: byo ? generatedByoInstructions(args.harnessLabel) : args.instructions.trim(),
    harness: byo ? workspaceHarnessForByo(args.adapterId) : 'overlay',
    modelId: byo ? `byo/${args.adapterId}` : args.modelId.trim(),
    avatarColor: args.avatarColor,
    allowedToolIds: byo ? [] : toolIdsForEnabledGroups(args.enabledToolGroups),
    visibility: args.visibility,
    platforms: args.platforms,
  }
}

/** Mirrors the editor's save gating: identity plus either overlay behavior or a valid BYO binding. */
export function isAgentEditorValid(args: {
  name: string
  instructions: string
  modelId: string
  agentType: 'overlay' | 'byo'
  connectedAgentsEnabled: boolean
  bindingValid: boolean
}): boolean {
  return Boolean(args.name.trim() && (args.agentType === 'overlay'
    ? args.instructions.trim() && args.modelId.trim()
    : args.connectedAgentsEnabled && args.bindingValid))
}
