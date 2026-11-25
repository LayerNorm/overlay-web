'use client'

import { useEffect } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { api } from '../../convex/_generated/api'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useSavedPanelScope } from '@/hooks/use-panel-scope'

export type AgentDirectory = {
  workspaceId: string | null
  /** null while loading. */
  agents: WorkspaceAgentDirectoryItem[] | null
  canCreate: boolean
  viewerPrincipalId: string | null
  status: 'loading' | 'ready' | 'unavailable'
}

const chiefsEnsured = new Set<string>()

/**
 * The live agent directory for the active workspace. Every caller shares one Convex
 * subscription, so a create, rename or archive anywhere reaches every list without events.
 */
export function useAgentDirectory(options: { includeArchived?: boolean; enabled?: boolean } = {}): AgentDirectory {
  const { activeWorkspaceId, status: workspaceStatus } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = workspaceStatus === 'ready' ? activeWorkspaceId : null
  const canQuery = Boolean(workspaceId && isAuthenticated && !isLoading && options.enabled !== false)
  const result = useQuery(
    api.agents.directory.list,
    canQuery ? { workspaceId: workspaceId!, ...(options.includeArchived ? { includeArchived: true } : {}) } : 'skip',
  )
  const ensureChiefs = useMutation(api.agents.directory.ensureChiefs)
  // Personal (and its chief) is created the first time someone is in Personal mode; Workspace only needs Overlay.
  // The remembered mode follows the URL's (see usePanelScopeState), so a shared Personal link counts too.
  const includePersonal = useSavedPanelScope() === 'personal'
  useEffect(() => {
    if (!canQuery || !workspaceId) return
    const key = `${workspaceId}:${includePersonal ? 'personal' : 'workspace'}`
    if (chiefsEnsured.has(key)) return
    chiefsEnsured.add(key)
    void ensureChiefs({ workspaceId, ...(includePersonal ? { includePersonal: true } : {}) })
      .catch(() => chiefsEnsured.delete(key))
  }, [canQuery, ensureChiefs, includePersonal, workspaceId])

  return directoryResult(workspaceId, canQuery, result)
}

/**
 * Creates the viewer's Personal Chief on their first visit to Personal. Pages that know the mode on screen call this
 * with it, so a Personal URL works even when the remembered mode can't be saved (blocked browser storage).
 */
export function useEnsurePersonalChief(personal: boolean): void {
  const { activeWorkspaceId, status: workspaceStatus } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = workspaceStatus === 'ready' ? activeWorkspaceId : null
  const ensureChiefs = useMutation(api.agents.directory.ensureChiefs)
  useEffect(() => {
    if (!personal || !workspaceId || !isAuthenticated || isLoading) return
    const key = `${workspaceId}:personal`
    if (chiefsEnsured.has(key)) return
    chiefsEnsured.add(key)
    void ensureChiefs({ workspaceId, includePersonal: true }).catch(() => chiefsEnsured.delete(key))
  }, [ensureChiefs, isAuthenticated, isLoading, personal, workspaceId])
}

function directoryResult(
  workspaceId: string | null,
  canQuery: boolean,
  result: { agents: unknown[]; canCreate: boolean; viewerPrincipalId: string | null } | null | undefined,
): AgentDirectory {
  if (!canQuery || result === undefined) {
    return { workspaceId, agents: null, canCreate: false, viewerPrincipalId: null, status: 'loading' }
  }
  if (result === null) {
    return { workspaceId, agents: [], canCreate: false, viewerPrincipalId: null, status: 'unavailable' }
  }
  return {
    workspaceId,
    agents: result.agents as WorkspaceAgentDirectoryItem[],
    canCreate: result.canCreate,
    viewerPrincipalId: result.viewerPrincipalId,
    status: 'ready',
  }
}

/** One live agent for the active workspace; null when missing or not visible, undefined while loading. */
export function useAgent(agentId: string | null): WorkspaceAgentDirectoryItem | null | undefined {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const workspaceId = status === 'ready' ? activeWorkspaceId : null
  const result = useQuery(
    api.agents.directory.get,
    workspaceId && agentId && isAuthenticated && !isLoading ? { workspaceId, agentId } : 'skip',
  )
  return result as WorkspaceAgentDirectoryItem | null | undefined
}
