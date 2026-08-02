import {
  WORKSPACE_MEMBERSHIP_ROLES,
  WORKSPACE_MEMBERSHIP_STATUSES,
  type WorkspaceMembershipRole,
  type WorkspaceMembershipStatus,
} from '@overlay/workspace-contracts'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

export function requiredWorkspaceParam(
  params: Record<string, string | string[]>,
  key: string,
): string {
  const value = params[key]
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim()
  if (!normalized) throw validation(`Missing ${key}`)
  return normalized
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
): string {
  const value = typeof body[key] === 'string' ? body[key].trim() : ''
  if (!value) throw validation(`${key} is required`)
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw validation(`${key} must be at most ${options.maxLength} characters`)
  }
  return value
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
): string | undefined {
  if (body[key] === undefined || body[key] === null) return undefined
  if (typeof body[key] !== 'string') throw validation(`${key} must be a string`)
  const value = body[key].trim()
  if (!value) return undefined
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw validation(`${key} must be at most ${options.maxLength} characters`)
  }
  return value
}

export function workspaceRole(
  body: Record<string, unknown>,
  key = 'role',
): WorkspaceMembershipRole {
  const value = body[key]
  if (
    typeof value !== 'string'
    || !WORKSPACE_MEMBERSHIP_ROLES.includes(value as WorkspaceMembershipRole)
  ) {
    throw validation('role is invalid')
  }
  return value as WorkspaceMembershipRole
}

export function invitationRole(body: Record<string, unknown>): Exclude<WorkspaceMembershipRole, 'owner'> {
  const role = workspaceRole(body)
  if (role === 'owner') throw validation('Owners must be promoted after joining the workspace')
  return role
}

export function membershipStatus(
  body: Record<string, unknown>,
): WorkspaceMembershipStatus {
  const value = body.status
  if (
    typeof value !== 'string'
    || !WORKSPACE_MEMBERSHIP_STATUSES.includes(value as WorkspaceMembershipStatus)
  ) {
    throw validation('status is invalid')
  }
  return value as WorkspaceMembershipStatus
}

export function validation(message: string): WorkspaceServiceError {
  return new WorkspaceServiceError(message, 400, 'validation')
}
