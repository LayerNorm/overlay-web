'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import type { MemoryRowForSidebar } from '@/shared/knowledge/memory-display-segments'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../convex/_generated/api'

/**
 * The workspace's memories, live, optionally narrowed to one member or agent principal: undefined while loading,
 * null when the viewer cannot read the workspace. Saves, deletes and memories extracted from any chat or agent
 * turn reach every open list without a reload.
 */
export function useMemories(ownerPrincipalId?: string): MemoryRowForSidebar[] | null | undefined {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = status === 'ready' ? activeWorkspaceId : null
  return useQuery(
    api.knowledge.memoryBrowse.list,
    workspaceId && isAuthenticated && !isLoading
      ? { workspaceId, ...(ownerPrincipalId ? { ownerPrincipalId } : {}) }
      : 'skip',
  )
}
