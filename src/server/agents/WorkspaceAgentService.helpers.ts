import type {
  WorkspaceAgentCreatureShape,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentVisibility,
  WorkspaceMembershipRole,
} from '@overlay/workspace-contracts'
import { WORKSPACE_AGENT_CREATURE_SHAPES } from '@overlay/workspace-contracts'

export class WorkspaceAgentServiceError extends Error {
  constructor(
    public readonly code: 'forbidden' | 'not_found' | 'validation' | 'conflict',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceAgentServiceError'
  }
}

export function assertValidOverlayPermissionMode(harness: string, permissionMode?: string) {
  if (harness === 'overlay' && permissionMode !== undefined && permissionMode !== 'ask' && permissionMode !== 'auto') {
    throw new WorkspaceAgentServiceError('validation', 'Overlay permission mode must be ask or auto')
  }
}
export function canCreateAgent(role: WorkspaceMembershipRole) { return role !== 'guest' }
export function canSeeAgent(agent: Pick<WorkspaceAgentDirectoryItem, 'visibility' | 'createdByPrincipalId'>, principalId: string) {
  return agent.visibility !== 'creator' || agent.createdByPrincipalId === principalId
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
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) throw new WorkspaceAgentServiceError('validation', 'Avatar color must be a six-digit hex color')
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
export function unique(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))] }
export function mapThreadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('AGENT_LAST_THREAD')) return new WorkspaceAgentServiceError('conflict', 'An agent must keep at least one thread')
  if (message.includes('AGENT_ARCHIVED')) return new WorkspaceAgentServiceError('conflict', 'Archived agents cannot start new threads')
  if (message.includes('THREAD_ACCESS_DENIED') || message.includes('WORKSPACE_ACCESS_DENIED')) return new WorkspaceAgentServiceError('forbidden', 'Thread is not accessible')
  if (message.includes('THREAD_NOT_FOUND') || message.includes('AGENT_NOT_FOUND')) return new WorkspaceAgentServiceError('not_found', 'Thread not found')
  return error instanceof Error ? error : new Error(message)
}
