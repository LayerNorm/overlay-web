import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentHarness,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { generatedByoInstructions, workspaceHarnessForByo } from './byo-agent-setup'

/** `'overlay'` inside the hosted branch means the native Overlay agent; anything else is a managed harness id. */
export function isManagedHarnessRuntime(hostedRuntime: string): boolean {
  return hostedRuntime !== 'overlay' && hostedRuntime.trim().length > 0
}

/** Builds the agent create/update payload from editor state (overlay + managed harness + BYO shapes). */
export function buildWorkspaceAgentInput(args: {
  name: string
  description: string
  instructions: string
  agentType: 'overlay' | 'byo'
  /** Runtime inside "Hosted on Overlay Cloud"; `'overlay'` or a managed harness id. */
  hostedRuntime: string
  /** Priced Overlay model id backing the picked harness model (`billingModelId`). */
  harnessBillingModelId: string
  harnessLabel: string
  adapterId: string
  modelId: string
  avatarColor: string
  avatarShape: WorkspaceAgentCreatureShape
  enabledToolGroups: ReadonlySet<string>
  visibility: WorkspaceAgentVisibility
}): WorkspaceAgentCreateInput {
  const byo = args.agentType === 'byo'
  const managed = args.agentType === 'overlay' && isManagedHarnessRuntime(args.hostedRuntime)
  return {
    name: args.name.trim(),
    description: args.description.trim() || undefined,
    instructions: byo ? generatedByoInstructions(args.harnessLabel) : args.instructions.trim(),
    harness: managed
      ? args.hostedRuntime as WorkspaceAgentHarness
      : byo ? workspaceHarnessForByo(args.adapterId) : 'overlay',
    // Managed harnesses bill Overlay's priced model for the picked harness
    // model; the harness-native alias lives on the binding, not the agent.
    modelId: managed ? args.harnessBillingModelId : byo ? `byo/${args.adapterId}` : args.modelId.trim(),
    avatarColor: args.avatarColor,
    avatarShape: args.avatarShape,
    // Harness runtimes own their tool surface inside the sandbox — Overlay's
    // tool-group grants apply to the native agent only.
    allowedToolIds: byo || managed ? [] : toolIdsForEnabledGroups(args.enabledToolGroups),
    visibility: args.visibility,
  }
}

/** The built-in master agent renders the master notice and skips deletion. */
export function isDefaultMasterAgent(
  agent: { isDefault?: boolean; name: string } | null | undefined,
): boolean {
  return Boolean(agent && (agent.isDefault || agent.name.toLowerCase() === 'overlay'))
}

/** Mirrors the editor's save gating: identity plus either overlay behavior, a managed harness, or a valid BYO binding. */
export function isAgentEditorValid(args: {
  name: string
  instructions: string
  modelId: string
  agentType: 'overlay' | 'byo'
  hostedRuntime: string
  harnessBillingModelId: string
  managedHarnessEnabled: boolean
  connectedAgentsEnabled: boolean
  bindingValid: boolean
}): boolean {
  if (!args.name.trim()) return false
  if (args.agentType === 'overlay' && isManagedHarnessRuntime(args.hostedRuntime)) {
    return Boolean(args.managedHarnessEnabled && args.instructions.trim() && args.harnessBillingModelId.trim())
  }
  return Boolean(args.agentType === 'overlay'
    ? args.instructions.trim() && args.modelId.trim()
    : args.connectedAgentsEnabled && args.bindingValid)
}
