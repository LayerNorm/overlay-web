'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import {
  DEFAULT_RESOURCE_SCOPE_POLICY,
  canCreateInScope,
  type ResourceKind,
  type ResourceScope,
  type ResourceScopePolicy,
  type ResourceViewer,
} from '@/shared/workspaces/resource-scope'
import type { WorkspaceSharingPolicyResponse } from '@/shared/workspaces/types'

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

const CHANGED_EVENT = 'overlay:workspace-scope-policy-changed'
const cache = new Map<string, WorkspaceCreateAccess>()
const inflight = new Set<string>()

async function fetchSharingPolicy(workspaceId: string): Promise<WorkspaceSharingPolicyResponse> {
  const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/policies`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId },
  })
  if (!response.ok) throw new Error('Could not load the workspace policy')
  return await response.json() as WorkspaceSharingPolicyResponse
}

function toAccess(response: WorkspaceSharingPolicyResponse): WorkspaceCreateAccess {
  const { policy } = response
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

/** Forget a workspace's cached policy (after an admin changes it) so the next read fetches it again. */
export function invalidateWorkspaceScopePolicy(workspaceId: string): void {
  cache.delete(workspaceId)
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED_EVENT, onChange)
  return () => window.removeEventListener(CHANGED_EVENT, onChange)
}

/**
 * The creation rules of the active workspace, for hiding buttons. Convex enforces them regardless, so while the policy
 * loads (or if it cannot be read) this is permissive rather than hiding something the person may be allowed to do.
 */
export function useWorkspaceCreateAccess(): {
  access: WorkspaceCreateAccess
  viewer: ResourceViewer | null
  canCreate: (kind: ResourceKind, scope: ResourceScope) => boolean
} {
  const { activeWorkspace } = useWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const [, setVersion] = useState(0)
  useSyncExternalStore(subscribe, () => workspaceId ? cache.get(workspaceId) : undefined, () => undefined)

  useEffect(() => {
    if (!workspaceId || cache.has(workspaceId) || inflight.has(workspaceId)) return
    inflight.add(workspaceId)
    void fetchSharingPolicy(workspaceId)
      .then((response) => { cache.set(workspaceId, toAccess(response)) })
      .catch(() => undefined)
      .finally(() => {
        inflight.delete(workspaceId)
        setVersion((value) => value + 1)
        window.dispatchEvent(new Event(CHANGED_EVENT))
      })
  }, [workspaceId])

  const access = (workspaceId ? cache.get(workspaceId) : undefined) ?? PERMISSIVE
  const viewer: ResourceViewer | null = activeWorkspace ? { userId: '', role: activeWorkspace.role } : null
  return {
    access,
    viewer,
    canCreate: (kind, scope) => (viewer ? canCreateInScope(kind, scope, viewer, access.scope) : true),
  }
}
