import type { WorkspaceAgentCreatureShape, WorkspaceAgentVisibility } from '@overlay/workspace-contracts'
import { WORKSPACE_AGENT_CREATURE_SHAPES } from '@overlay/workspace-contracts'
import { parseByoModelId } from '@/shared/agents/agent-model'
import { isSupportedAgentProviderId } from '@/shared/agents/provider-accounts'

export class WorkspaceAgentServiceError extends Error {
  constructor(
    public readonly code: 'forbidden' | 'not_found' | 'validation' | 'conflict',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceAgentServiceError'
  }
}

const SUPPORTED_WORKSPACE_AGENT_HARNESSES = ['overlay', 'claude-code', 'codex'] as const
type SupportedWorkspaceAgentHarness = (typeof SUPPORTED_WORKSPACE_AGENT_HARNESSES)[number]

export function assertSupportedWorkspaceAgentHarness(value: string): asserts value is SupportedWorkspaceAgentHarness {
  if (!(SUPPORTED_WORKSPACE_AGENT_HARNESSES as readonly string[]).includes(value)) {
    throw new WorkspaceAgentServiceError('validation', 'Unsupported agent harness')
  }
}

export function assertSupportedAgentConfiguration(modelId: string, harness: string): void {
  assertSupportedWorkspaceAgentHarness(harness)
  const byo = parseByoModelId(modelId)
  if (byo && !isSupportedAgentProviderId(byo.adapterId)) {
    throw new WorkspaceAgentServiceError('validation', 'Unsupported connected agent adapter')
  }
}

export function normalizeVisibility(value: WorkspaceAgentVisibility | undefined): WorkspaceAgentVisibility {
  return value === 'creator' ? 'creator' : 'workspace'
}

export function required(value: string, label: string, max: number) {
  const normalized = value.trim()
  if (!normalized) throw new WorkspaceAgentServiceError('validation', `${label} is required`)
  if (normalized.length > max) throw new WorkspaceAgentServiceError('validation', `${label} is too long`)
  return normalized
}

export function optional(value: string | undefined, max: number) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.length > max) throw new WorkspaceAgentServiceError('validation', 'Description is too long')
  return normalized
}

export function color(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new WorkspaceAgentServiceError('validation', 'Avatar color must be a six-digit hex color')
  }
  return normalized.toLowerCase()
}

export function shape(value?: string): WorkspaceAgentCreatureShape | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (!(WORKSPACE_AGENT_CREATURE_SHAPES as readonly string[]).includes(normalized)) {
    throw new WorkspaceAgentServiceError('validation', 'Avatar shape is not a known creature shape')
  }
  return normalized as WorkspaceAgentCreatureShape
}

export function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
