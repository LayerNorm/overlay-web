import { desktopAppJson } from './app-api-client'
import { clearChatListCache } from './chat-list-cache'
import { clearDesktopFileListCache } from './files-list-cache'
import { clearDesktopIntegrations } from './integrations-cache'
import { clearChatStorageCaches } from '../utils/chatStorage'
import {
  dispatchWorkspaceChanged,
  getActiveWorkspaceId,
  setActiveWorkspaceId
} from './workspace-store'

/**
 * Minimal workspace shapes mirrored from `@overlay/workspace-contracts`
 * (`WorkspaceSummary`, `WorkspaceListResponse`, `WorkspaceActivateResponse`).
 * Desktop vendors its own copy so phase 1 needs no new workspace package;
 * full management (invitations, teams, billing) stays web-only.
 */
export interface DesktopWorkspaceSummary {
  id: string
  name: string
  slug: string
  kind: 'personal' | 'organization'
  status: string
  role: string
  memberCount?: number
}

export interface DesktopWorkspaceListResponse {
  workspaces: DesktopWorkspaceSummary[]
  activeWorkspaceId: string
}

export interface DesktopWorkspaceActivateResponse {
  activeWorkspaceId: string
  workspace: DesktopWorkspaceSummary
}

function isWorkspaceSummary(value: unknown): value is DesktopWorkspaceSummary {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    (record.kind === 'personal' || record.kind === 'organization')
  )
}

function normalizeListResponse(value: unknown): DesktopWorkspaceListResponse {
  const record = (value ?? {}) as Record<string, unknown>
  const workspaces = Array.isArray(record.workspaces)
    ? record.workspaces.filter(isWorkspaceSummary)
    : []
  const activeWorkspaceId =
    typeof record.activeWorkspaceId === 'string' ? record.activeWorkspaceId : ''
  return { workspaces, activeWorkspaceId }
}

export async function listWorkspaces(): Promise<DesktopWorkspaceListResponse> {
  const raw = await desktopAppJson<unknown>('/api/v1/workspaces')
  return normalizeListResponse(raw)
}

/** Drops all workspace-scoped renderer state before it can leak across workspaces. */
export function invalidateWorkspaceCaches(): void {
  clearChatStorageCaches()
  clearChatListCache()
  clearDesktopFileListCache()
  clearDesktopIntegrations()
}

/**
 * Adopts the server's active workspace (e.g. after sign-in or when the stored
 * id is stale). Returns true when the active workspace changed.
 */
export function adoptServerActiveWorkspace(serverActiveId: string | null): boolean {
  const previous = getActiveWorkspaceId()
  const next = typeof serverActiveId === 'string' && serverActiveId.trim()
    ? serverActiveId.trim()
    : null
  if (previous === next) return false
  if (previous !== null) invalidateWorkspaceCaches()
  setActiveWorkspaceId(next)
  return true
}

export async function activateWorkspace(
  workspaceId: string
): Promise<DesktopWorkspaceActivateResponse> {
  const trimmed = workspaceId.trim()
  if (!trimmed) throw new Error('workspaceId is required')
  const raw = await desktopAppJson<unknown>('/api/v1/workspaces/active', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: trimmed })
  })
  const record = (raw ?? {}) as Record<string, unknown>
  const activeWorkspaceId =
    typeof record.activeWorkspaceId === 'string' ? record.activeWorkspaceId : trimmed
  const workspace = isWorkspaceSummary(record.workspace)
    ? record.workspace
    : {
        id: activeWorkspaceId,
        name: 'Workspace',
        slug: '',
        kind: 'organization' as const,
        status: 'active',
        role: 'member'
      }
  invalidateWorkspaceCaches()
  setActiveWorkspaceId(activeWorkspaceId)
  dispatchWorkspaceChanged(activeWorkspaceId)
  return { activeWorkspaceId, workspace }
}
