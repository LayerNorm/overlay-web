import {
  WORKSPACE_SHARE_ACCESS_ROLES,
  type WorkspaceShareAccessRole,
  type WorkspaceShareResourceType,
  type WorkspaceShareTargetType,
} from '@overlay/workspace-contracts'

/**
 * One source of truth for what a share role means. The sharing service enforces
 * these rules server-side; the Share dialog reads them so the UI can never offer
 * a permission the API would reject.
 */
export type ShareAction = 'view' | 'execute' | 'edit'

const ROLE_RANK: Record<WorkspaceShareAccessRole, number> = {
  viewer: 1,
  operator: 2,
  editor: 3,
}

const EXECUTABLE_RESOURCE_TYPES: readonly WorkspaceShareResourceType[] = ['automation', 'agent']

export function isShareAccessRole(value: unknown): value is WorkspaceShareAccessRole {
  return typeof value === 'string'
    && (WORKSPACE_SHARE_ACCESS_ROLES as readonly string[]).includes(value)
}

export function shareRoleAllows(role: WorkspaceShareAccessRole, action: ShareAction): boolean {
  if (action === 'view') return true
  if (action === 'execute') return role === 'operator' || role === 'editor'
  return role === 'editor'
}

export function strongestShareRole(
  roles: readonly WorkspaceShareAccessRole[],
): WorkspaceShareAccessRole | undefined {
  return roles.reduce<WorkspaceShareAccessRole | undefined>((best, role) => (
    !best || ROLE_RANK[role] > ROLE_RANK[best] ? role : best
  ), undefined)
}

/**
 * Returns null when the role is offerable for the resource, otherwise the
 * message shown to the person attempting it.
 */
export function shareRoleRejection(
  resourceType: WorkspaceShareResourceType,
  role: WorkspaceShareAccessRole,
): string | null {
  if (resourceType === 'conversation' && role !== 'viewer') {
    return 'Conversations can be shared as view-only'
  }
  if (role === 'operator' && !EXECUTABLE_RESOURCE_TYPES.includes(resourceType)) {
    return 'Can run is available only for automations and agents'
  }
  return null
}

export function shareRoleOptions(resourceType: WorkspaceShareResourceType): Array<{
  value: WorkspaceShareAccessRole
  label: string
  description: string
}> {
  return WORKSPACE_SHARE_ACCESS_ROLES
    .filter((role) => shareRoleRejection(resourceType, role) === null)
    .map((role) => ({
      value: role,
      label: roleLabel(role),
      description: roleDescription(role, resourceType),
    }))
}

function roleLabel(role: WorkspaceShareAccessRole): string {
  if (role === 'viewer') return 'Can view'
  if (role === 'operator') return 'Can run'
  return 'Can edit'
}

function roleDescription(
  role: WorkspaceShareAccessRole,
  resourceType: WorkspaceShareResourceType,
): string {
  if (role === 'operator') {
    return resourceType === 'agent'
      ? 'Use the agent without seeing its instructions, credentials, or configuration'
      : 'Run this automation without changing what it does'
  }
  if (role === 'editor') {
    return resourceType === 'agent'
      ? 'Change identity, instructions, runtime, and connected resources'
      : 'Change contents and settings'
  }
  return resourceType === 'agent'
    ? 'See that the agent exists and read its shared output'
    : 'Open and read, without changes'
}

/** Explains, in the Share dialog, how a grant target keeps evolving. */
export function describeTargetInheritance(targetType: WorkspaceShareTargetType): string {
  if (targetType === 'team') return 'Everyone on this team, including people added later'
  if (targetType === 'room') return 'Everyone in this room, including people and agents added later'
  return 'This person or agent only'
}

export const SHARE_RESOURCE_LABELS: Record<WorkspaceShareResourceType, string> = {
  conversation: 'chat',
  file: 'file',
  project: 'project',
  knowledge_base: 'knowledge base',
  automation: 'automation',
  agent: 'agent',
}
