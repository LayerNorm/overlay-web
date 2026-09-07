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
  activateWorkspace,
  adoptServerActiveWorkspace,
  invalidateWorkspaceCaches,
  listWorkspaces,
  type DesktopWorkspaceSummary
} from '../services/workspace-service'
import { clearActiveWorkspaceId, getActiveWorkspaceId } from '../services/workspace-store'

type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Panel windows (chat, notebook, browser) mount the same provider tree but
 * never render workspace UI. They skip eager loading to avoid N× fan-out
 * against the main-process IPC concurrency limit at startup; the workspace
 * header they need comes from the persisted store, not this context.
 */
function isMainAppWindow(): boolean {
  try {
    return (new URLSearchParams(window.location.search).get('window') || 'overlay') === 'main'
  } catch {
    return true
  }
}

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
      const message =
        refreshError instanceof Error ? refreshError.message : String(refreshError)
      // Keep a previously resolved workspace instead of signing the shell out;
      // scoped fetches still fail closed per-request on 401.
      setError(message)
      if (statusRef.current === 'ready') return
      setStatusTracked('error')
      // Startup bursts across windows can trip the IPC concurrency limit;
      // retry once shortly after instead of parking in an error state.
      clearRetry()
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null
        inFlight.current = false
        void refresh()
      }, 1_500)
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
        setError(
          switchError instanceof Error ? switchError.message : String(switchError)
        )
        throw switchError
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
