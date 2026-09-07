/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { getAuthReadyState } from '../services/auth-service'
import {
  friendlyErrorMessage,
  isRetryableError,
  retryAfterMsFromError
} from '../services/request-backoff'
import { isMainAppWindow } from '../services/window-type'
import {
  activateWorkspace,
  adoptServerActiveWorkspace,
  invalidateWorkspaceCaches,
  listWorkspaces,
  type DesktopWorkspaceSummary
} from '../services/workspace-service'
import { clearActiveWorkspaceId, getActiveWorkspaceId } from '../services/workspace-store'

type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error'

interface WorkspaceContextValue {
  status: WorkspaceStatus
  workspaces: readonly DesktopWorkspaceSummary[]
  activeWorkspaceId: string | null
  activeWorkspace: DesktopWorkspaceSummary | null
  error: string | null
  switchingWorkspaceId: string | null
  refresh(): Promise<void>
  switchWorkspace(workspaceId: string): Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }): React.ReactElement<any> {
  const [status, setStatus] = useState<WorkspaceStatus>('idle')
  const [workspaces, setWorkspaces] = useState<DesktopWorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    getActiveWorkspaceId()
  )
  const [error, setError] = useState<string | null>(null)
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null)
  const inFlight = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef<WorkspaceStatus>('idle')

  const clearRetry = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
  }, [])

  const setStatusTracked = useCallback((next: WorkspaceStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (getAuthReadyState() !== true) return
    if (inFlight.current) return
    inFlight.current = true
    if (statusRef.current !== 'ready') setStatusTracked('loading')
    setError(null)
    try {
      const response = await listWorkspaces()
      // Adopt the server truth before any scoped fetch runs against a stale id.
      const changed = adoptServerActiveWorkspace(response.activeWorkspaceId || null)
      const resolvedId =
        response.activeWorkspaceId ||
        response.workspaces[0]?.id ||
        getActiveWorkspaceId()
      if (changed) {
        window.dispatchEvent(
          new CustomEvent('overlay:workspace-changed', {
            detail: { workspaceId: resolvedId }
          })
        )
      }
      clearRetry()
      setWorkspaces(response.workspaces)
      setActiveWorkspaceId(resolvedId)
      setStatusTracked('ready')
    } catch (refreshError) {
      // Keep a previously resolved workspace instead of signing the shell out;
      // scoped fetches still fail closed per-request on 401.
      setError(friendlyErrorMessage(refreshError))
      if (statusRef.current === 'ready') return
      setStatusTracked('error')
      // Honor the server's retry hint (429s) so a throttled burst backs off
      // instead of retry-storming the rate limiter. Persistent failures
      // (404s, gated features) park with a manual Retry instead.
      if (!isRetryableError(refreshError)) return
      clearRetry()
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null
        inFlight.current = false
        void refresh()
      }, retryAfterMsFromError(refreshError, 1_500))
    } finally {
      inFlight.current = false
    }
  }, [clearRetry, setStatusTracked])

  const switchWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (!workspaceId || workspaceId === activeWorkspaceId) return
      setSwitchingWorkspaceId(workspaceId)
      setError(null)
      try {
        const response = await activateWorkspace(workspaceId)
        setActiveWorkspaceId(response.activeWorkspaceId)
        await refresh()
      } catch (switchError) {
        const friendly = friendlyErrorMessage(switchError)
        setError(friendly)
        throw new Error(friendly)
      } finally {
        setSwitchingWorkspaceId(null)
      }
    },
    [activeWorkspaceId, refresh]
  )

  useEffect(() => {
    const handleAuthReady = (event: Event): void => {
      const authed =
        (event as CustomEvent<{ authed?: boolean }>).detail?.authed === true
      if (authed) {
        if (isMainAppWindow()) void refresh()
      } else {
        clearRetry()
        inFlight.current = false
        setStatusTracked('idle')
        setWorkspaces([])
        setActiveWorkspaceId(null)
        setError(null)
        setSwitchingWorkspaceId(null)
        clearActiveWorkspaceId()
        invalidateWorkspaceCaches()
      }
    }
    window.addEventListener('overlay:auth-ready', handleAuthReady)
    if (getAuthReadyState() === true && isMainAppWindow()) void refresh()
    return () => {
      window.removeEventListener('overlay:auth-ready', handleAuthReady)
      clearRetry()
    }
  }, [refresh, clearRetry, setStatusTracked])

  const value = useMemo<WorkspaceContextValue>(() => {
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    return {
      status,
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      error,
      switchingWorkspaceId,
      refresh,
      switchWorkspace
    }
  }, [status, workspaces, activeWorkspaceId, error, switchingWorkspaceId, refresh, switchWorkspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}
