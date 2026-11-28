import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { useAuth } from './AuthContext'
import { useAppSession } from './AppSessionContext'
import { useNativeDataReady } from './ConvexAuthProvider'
import { setRequestWorkspaceId } from '../services/appApi'
import {
  activateWorkspace,
  applyWorkspaceLocally,
  fetchWorkspaces,
  subscribeWorkspaces,
  isPersonalWorkspace,
  loadPersistedWorkspaceId,
} from '../services/workspaceService'

type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[]
  /** Effective workspace id scopes requests via x-overlay-workspace-id. */
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceSummary | null
  /** Native membership reads are required even for single-workspace accounts. */
  workspacesEnabled: boolean
  isLoading: boolean
  isSwitching: boolean
  error: string | null
  switchWorkspace: (workspaceId: string) => Promise<void>
  /** Creates an organization workspace and makes it active (matches web create). */
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)

function resolveActiveWorkspaceId(
  workspaces: WorkspaceSummary[],
  serverActiveId: string,
): string | null {
  if (serverActiveId && workspaces.some((w) => w.id === serverActiveId)) {
    return serverActiveId
  }
  const personal = workspaces.find(isPersonalWorkspace)
  return personal?.id ?? workspaces[0]?.id ?? null
}

export function WorkspaceProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const nativeReady = useNativeDataReady()
  const { isLoading: sessionLoading, isInitialized, error: bootstrapError, refresh: refreshSession } = useAppSession()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workspacesEnabled = true

  const applyActiveWorkspace = useCallback((workspaceId: string | null) => {
    setActiveWorkspaceId(workspaceId)
    applyWorkspaceLocally(workspaceId)
  }, [])

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !workspacesEnabled || !nativeReady) {
      return
    }
    if (!isInitialized) {
      await refreshSession({ forceRefresh: true })
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const { workspaces: list, activeWorkspaceId: serverActiveId } = await fetchWorkspaces()
      setWorkspaces(list)
      applyActiveWorkspace(resolveActiveWorkspaceId(list, serverActiveId))
    } catch (nextError) {
      // A failing workspaces endpoint must not break the app — degrade to
      // personal-scope behavior (no header) and surface nothing blocking.
      setError(nextError instanceof Error ? nextError.message : 'Failed to load workspaces')
    } finally {
      setIsLoading(false)
    }
  }, [applyActiveWorkspace, isAuthenticated, workspacesEnabled, nativeReady, isInitialized, refreshSession])

  useEffect(() => {
    if (!nativeReady || !workspacesEnabled || !isInitialized) return
    return subscribeWorkspaces(({ workspaces: list, activeWorkspaceId: serverActiveId }) => {
      setWorkspaces(list)
      setIsLoading(false)
      setError(null)
      applyActiveWorkspace(resolveActiveWorkspaceId(list, serverActiveId))
    })
  }, [nativeReady, workspacesEnabled, applyActiveWorkspace, isInitialized])

  // Warm-start: apply the persisted selection so requests issued before the
  // workspaces fetch completes still carry the right scope. Skipped once the
  // server-resolved value has landed so a slow read can't clobber it.
  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    let cancelled = false
    void loadPersistedWorkspaceId().then((persisted) => {
      if (cancelled || !persisted) {
        return
      }
      setActiveWorkspaceId((current) => {
        if (current) {
          return current
        }
        setRequestWorkspaceId(persisted)
        return persisted
      })
    })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (authLoading) {
      return
    }
    if (!isAuthenticated) {
      setWorkspaces([])
      setIsLoading(true)
      setActiveWorkspaceId(null)
      setError(null)
      applyWorkspaceLocally(null)
      return
    }
    if (sessionLoading || !isInitialized) {
      return
    }
    if (!workspacesEnabled) {
      setWorkspaces([])
      applyActiveWorkspace(null)
      return
    }
    void refresh()
  }, [
    applyActiveWorkspace,
    authLoading,
    isAuthenticated,
    refresh,
    sessionLoading,
    isInitialized,
    workspacesEnabled,
  ])

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === activeWorkspaceId) {
        return
      }
      setIsSwitching(true)
      setError(null)
      const previous = activeWorkspaceId
      try {
        await activateWorkspace(workspaceId)
        // Entitlements/bootstrap are workspace-scoped (billing payer) — pull
        // fresh session data so plan gates reflect the new workspace.
        await refreshSession({ forceRefresh: true })
        applyActiveWorkspace(workspaceId)
      } catch (nextError) {
        applyActiveWorkspace(previous)
        setError(nextError instanceof Error ? nextError.message : 'Failed to switch workspace')
        throw nextError
      } finally {
        setIsSwitching(false)
      }
    },
    [activeWorkspaceId, applyActiveWorkspace, refreshSession],
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspaceId,
      activeWorkspace: workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
      workspacesEnabled,
      isLoading: isLoading && !bootstrapError,
      isSwitching,
      error: error ?? bootstrapError,
      switchWorkspace,
      refresh,
    }),
    [
      workspaces,
      activeWorkspaceId,
      workspacesEnabled,
      isLoading,
      isSwitching,
      error,
      bootstrapError,
      switchWorkspace,
      refresh,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)

  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }

  return context
}
