import type { AgentEnvironmentResource } from '@overlay/api-client'
import {
  BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS,
  type BuiltInUserOwnedAcpAdapterId,
  type WorkspaceAgentDirectoryItem,
  type WorkspaceAgentHarness,
} from '@overlay/workspace-contracts'

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
  {
    id: 'hermes',
    label: 'Hermes',
    description: 'Run Hermes 0.20.6 or newer through its official Agent Client Protocol server.',
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
  connectable: boolean
}

export type AcpAdapterCapability = {
  id: string
  label: string
}

export function acpAdaptersForEnvironment(environment: AgentEnvironmentResource): AcpAdapterCapability[] {
  if (!Array.isArray(environment.capabilities.adapters)) return []
  return (environment.capabilities.adapters as Array<Record<string, unknown>>).flatMap((adapter) => (
    adapter.protocol === 'acp' && typeof adapter.id === 'string'
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

export function builtInHarnessCatalogIsComplete() {
  return BUILT_IN_BYO_HARNESSES.length === BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS.length
    && BUILT_IN_USER_OWNED_ACP_ADAPTER_IDS.every((id) => (
      BUILT_IN_BYO_HARNESSES.some((harness) => harness.id === id)
    ))
}

export function workspaceAgentUsesByo(
  agent: Pick<WorkspaceAgentDirectoryItem, 'harness' | 'modelId'> | null | undefined,
) {
  return Boolean(agent && (agent.harness !== 'overlay' || agent.modelId.startsWith('byo/')))
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

export function generatedByoInstructions(harnessLabel: string) {
  return `Run delegated work through ${harnessLabel} in the connected environment. Stream user-visible progress and return a concise final result to Overlay.`
}

export function generatedAgentSetupPrompt(command: string) {
  return [
    'Connect this computer to Overlay, my AI workspace.',
    '',
    'Run this command in the background so it keeps running after our session ends (for example with `nohup … &` on macOS or Linux), then check its output for a "Verify this phrase in Overlay: …" line and tell me the phrase so I can approve the connection. Leave the process running — it is the connector Overlay talks to. It is outbound-only and opens no ports.',
    '',
    command,
  ].join('\n')
}
