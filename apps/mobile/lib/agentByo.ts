/**
 * Bring-your-own-harness helpers for connected-agent environments.
 *
 * Mobile-local mirror of web `src/features/agents/lib/byo-agent-setup.ts` and
 * the input-building pieces of `agent-editor-input.ts`.
 */
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type {
  BuiltInUserOwnedAcpAdapterId,
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentHarness,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { toolIdsForEnabledGroups } from './agentToolGroups'

export const BUILT_IN_BYO_HARNESSES = [
  {
    id: 'codex',
    label: 'Codex',
    description: 'Run OpenAI Codex through the Agent Client Protocol.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Run Anthropic Claude Code through the Agent Client Protocol.',
  },
] as const satisfies ReadonlyArray<{
  id: BuiltInUserOwnedAcpAdapterId
  label: string
  description: string
}>

export type BuiltInByoHarnessId = (typeof BUILT_IN_BYO_HARNESSES)[number]['id']

export type ByoHarnessOption = {
  id: string
  label: string
  description: string
  /** Built-in harnesses can start a new enrollment; env-advertised ones can't. */
  connectable: boolean
}

export type AcpAdapterCapability = {
  id: string
  label: string
}

export function acpAdaptersForEnvironment(environment: AgentEnvironmentResource): AcpAdapterCapability[] {
  if (!Array.isArray(environment.capabilities.adapters)) return []
  return (environment.capabilities.adapters as Array<Record<string, unknown>>).flatMap((adapter) => (
    adapter.protocol === 'acp' && typeof adapter.id === 'string' && adapter.id !== 'hermes'
      ? [{
          id: adapter.id,
          label: typeof adapter.displayName === 'string' ? adapter.displayName : adapter.id,
        }]
      : []
  ))
}

export function availableByoHarnesses(environments: AgentEnvironmentResource[]): ByoHarnessOption[] {
  const options = new Map<string, ByoHarnessOption>(BUILT_IN_BYO_HARNESSES.map((harness) => [
    harness.id,
    { ...harness, connectable: true },
  ]))
  for (const environment of environments) {
    for (const adapter of acpAdaptersForEnvironment(environment)) {
      if (!options.has(adapter.id)) {
        options.set(adapter.id, {
          id: adapter.id,
          label: adapter.label,
          description: 'Use the ACP-compatible harness advertised by this environment.',
          connectable: false,
        })
      }
    }
  }
  return [...options.values()]
}

export function environmentSupportsHarness(environment: AgentEnvironmentResource, harnessId: string) {
  return acpAdaptersForEnvironment(environment).some((adapter) => adapter.id === harnessId)
}

export function defaultWorkingDirectory(environment: AgentEnvironmentResource | undefined) {
  if (!environment?.filesystemGrant || environment.filesystemGrant.mode !== 'selected_roots') return ''
  return environment.filesystemGrant.roots[0] ?? ''
}

export function workspaceHarnessForByo(harnessId: string): WorkspaceAgentHarness {
  return harnessId === 'claude-code' ? 'claude-code' : 'overlay'
}

export function workspaceAgentUsesByo(
  agent: Pick<WorkspaceAgentDirectoryItem, 'harness' | 'modelId'> | null | undefined,
) {
  return Boolean(agent && (agent.harness !== 'overlay' || agent.modelId.startsWith('byo/')))
}

export function generatedByoInstructions(harnessLabel: string) {
  return `Run delegated work through ${harnessLabel} in the connected environment. Stream user-visible progress and return a concise final result to Overlay.`
}

/** The built-in master agent skips deletion and stays on the Overlay runtime. */
export function isDefaultMasterAgent(
  agent: { isDefault?: boolean; name: string } | null | undefined,
): boolean {
  return Boolean(agent && (agent.isDefault || agent.name.toLowerCase() === 'overlay'))
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
}): WorkspaceAgentCreateInput {
  const byo = args.agentType === 'byo'
  return {
    name: args.name.trim(),
    description: args.description.trim() || undefined,
    instructions: byo ? generatedByoInstructions(args.harnessLabel) : args.instructions.trim(),
    harness: byo ? workspaceHarnessForByo(args.adapterId) : 'overlay',
    modelId: byo ? `byo/${args.adapterId}` : args.modelId.trim(),
    avatarColor: args.avatarColor,
    avatarShape: args.avatarShape,
    allowedToolIds: byo ? [] : toolIdsForEnabledGroups(args.enabledToolGroups),
    visibility: args.visibility,
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

export function parseRoots(value: string): string[] {
  return value.split(/[,\n]/).map((root) => root.trim()).filter(Boolean)
}
