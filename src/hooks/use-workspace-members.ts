'use client'

import { useMemo } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { WorkspaceManagementItem, WorkspaceManagementResponse } from '@overlay/workspace-contracts'
import { api } from '../../convex/_generated/api'

export type WorkspaceManagementTab = 'people' | 'guests' | 'teams' | 'roles' | 'chats-agents'

/**
 * One workspace settings tab, live: role changes, removals, invitations, acceptances, renames and team edits appear
 * in every subscribed page at once. Undefined while loading, null without access to the workspace.
 */
export function useLiveWorkspaceManagement(workspaceId: string | null | undefined, view: WorkspaceManagementTab) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  return useQuery(
    api.collaboration.management.view,
    workspaceId && isAuthenticated && !isLoading ? { workspaceId, view } : 'skip',
  ) as WorkspaceManagementResponse | null | undefined
}

/**
 * Every active person and agent in the workspace, live, for pickers and mentions (one row per principal). Pass null
 * to skip. Undefined while loading; empty without access.
 */
export function useLiveWorkspacePrincipals(workspaceId: string | null | undefined):
  { currentPrincipalId: string; items: WorkspaceManagementItem[] } | undefined {
  const people = useLiveWorkspaceManagement(workspaceId, 'people')
  const agents = useLiveWorkspaceManagement(workspaceId, 'chats-agents')
  return useMemo(() => {
    if (people === undefined || agents === undefined) return undefined
    const byPrincipal = new Map<string, WorkspaceManagementItem>()
    for (const item of [...(people?.items ?? []), ...(agents?.items ?? [])]) {
      if (item.kind === 'member' && item.principalId && item.status === 'active') byPrincipal.set(item.principalId, item)
    }
    return { currentPrincipalId: people?.currentPrincipalId ?? '', items: [...byPrincipal.values()] }
  }, [agents, people])
}
