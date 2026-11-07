'use client'

import { useMemo } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { WorkspaceSharingPolicy } from '@overlay/workspace-contracts'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import {
  DEFAULT_RESOURCE_SCOPE_POLICY,
  canCreateInScope,
  type ResourceKind,
  type ResourceScope,
  type ResourceScopePolicy,
  type ResourceViewer,
} from '@/shared/workspaces/resource-scope'
import { api } from '../../convex/_generated/api'

/** What the secondary panel needs to know to hide a New button the person cannot use. */
export interface WorkspaceCreateAccess {
  scope: ResourceScopePolicy
  memberCanCreateChannels: boolean
  memberCanCreateAgents: boolean
}

const PERMISSIVE: WorkspaceCreateAccess = {
  scope: DEFAULT_RESOURCE_SCOPE_POLICY,
  memberCanCreateChannels: true,
  memberCanCreateAgents: true,
}

function toAccess(policy: WorkspaceSharingPolicy): WorkspaceCreateAccess {
  return {
    scope: {
      workspaceExtensionsEditors: policy.workspaceExtensionsEditors === 'admins' ? 'admins' : 'members',
      workspaceContentEditors: policy.workspaceContentEditors === 'admins' ? 'admins' : 'members',
      memberCanMoveScope: policy.memberCanMoveScope !== false,
    },
    memberCanCreateChannels: policy.memberCanCreateChannels !== false,
    memberCanCreateAgents: policy.memberCanCreateAgents !== false,
  }
}

/** The active workspace's sharing policy and whether the viewer may change it, live; undefined while loading. */
export function useLiveWorkspacePolicy(workspaceId: string | null) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  return useQuery(api.collaboration.directory.policy, workspaceId && isAuthenticated && !isLoading ? { workspaceId } : 'skip') as
    { policy: WorkspaceSharingPolicy; canManage: boolean } | null | undefined
}

/**
 * The creation rules of the active workspace, for hiding buttons, live: an admin's change reaches every member's
 * panels at once. Convex enforces the rules regardless, so while the policy loads (or if it cannot be read) this is
 * permissive rather than hiding something the person may be allowed to do.
 */
export function useWorkspaceCreateAccess(): {
  access: WorkspaceCreateAccess
  viewer: ResourceViewer | null
  canCreate: (kind: ResourceKind, scope: ResourceScope) => boolean
} {
  const { activeWorkspace } = useWorkspace()
  const live = useLiveWorkspacePolicy(activeWorkspace?.id ?? null)
  const access = useMemo(() => (live ? toAccess(live.policy) : PERMISSIVE), [live])
  const role = activeWorkspace?.role ?? null
  return useMemo(() => {
    const viewer: ResourceViewer | null = role ? { userId: '', role } : null
    return {
      access,
      viewer,
      canCreate: (kind: ResourceKind, scope: ResourceScope) => (viewer ? canCreateInScope(kind, scope, viewer, access.scope) : true),
    }
  }, [access, role])
}
