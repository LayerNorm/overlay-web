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
  listAgents,
  listBindings,
  listEnvironments,
  type DesktopAgentBinding,
  type DesktopAgentDirectoryItem,
  type DesktopAgentEnvironment
} from '../services/environment-service'
import { useWorkspace } from './WorkspaceContext'

type EnvironmentStatus = 'idle' | 'loading' | 'ready' | 'error'

interface EnvironmentContextValue {
  status: EnvironmentStatus
  environments: readonly DesktopAgentEnvironment[]
  bindings: readonly DesktopAgentBinding[]
  agents: readonly DesktopAgentDirectoryItem[]
  error: string | null
  bindingsByEnvironmentId: ReadonlyMap<string, DesktopAgentBinding[]>
  refresh(): Promise<void>
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null)

/** Poll faster while an enrollment is in flight so approval appears promptly. */
function pollIntervalMs(environments: readonly DesktopAgentEnvironment[]): number {
  return environments.some((environment) => environment.status === 'pending') ? 3_000 : 15_000
}

export function EnvironmentProvider({ children }: { children: ReactNode }): React.ReactElement<any> {
  const { activeWorkspaceId, status: workspaceStatus } = useWorkspace()
  const [status, setStatus] = useState<EnvironmentStatus>('idle')
  const [environments, setEnvironments] = useState<DesktopAgentEnvironment[]>([])
  const [bindings, setBindings] = useState<DesktopAgentBinding[]>([])
  const [agents, setAgents] = useState<DesktopAgentDirectoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (getAuthReadyState() !== true) return
    if (inFlight.current) return
    inFlight.current = true
    setStatus((prev) => (prev === 'ready' ? prev : 'loading'))
    try {
      const [environmentList, bindingList, agentList] = await Promise.all([
        listEnvironments(),
        listBindings(),
        listAgents()
      ])
      setEnvironments(environmentList)
      setBindings(bindingList)
      setAgents(agentList)
      setError(null)
      setStatus('ready')
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
      setStatus((prev) => (prev === 'ready' ? prev : 'error'))
    } finally {
      inFlight.current = false
    }
  }, [])

  const clear = useCallback(() => {
    inFlight.current = false
    setStatus('idle')
    setEnvironments([])
    setBindings([])
    setAgents([])
    setError(null)
  }, [])

  // Reload whenever the workspace changes: every record here is workspace-scoped.
  useEffect(() => {
    if (getAuthReadyState() !== true) {
      clear()
      return
    }
    if (!activeWorkspaceId || workspaceStatus !== 'ready') return
    void refresh()
  }, [activeWorkspaceId, workspaceStatus, clear, refresh])

  useEffect(() => {
    const handleAuthReady = (event: Event): void => {
      const authed = (event as CustomEvent<{ authed?: boolean }>).detail?.authed === true
      if (!authed) clear()
    }
    window.addEventListener('overlay:auth-ready', handleAuthReady)
    return () => window.removeEventListener('overlay:auth-ready', handleAuthReady)
  }, [clear])

  useEffect(() => {
    if (status !== 'ready' || environments.length === 0) return
    const timer = window.setInterval(() => void refresh(), pollIntervalMs(environments))
    return () => window.clearInterval(timer)
  }, [status, environments, refresh])

  const value = useMemo<EnvironmentContextValue>(() => {
    const bindingsByEnvironmentId = new Map<string, DesktopAgentBinding[]>()
    for (const binding of bindings) {
      const list = bindingsByEnvironmentId.get(binding.environmentId) ?? []
      list.push(binding)
      bindingsByEnvironmentId.set(binding.environmentId, list)
    }
    return { status, environments, bindings, agents, error, bindingsByEnvironmentId, refresh }
  }, [status, environments, bindings, agents, error, refresh])

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>
}

export function useEnvironments(): EnvironmentContextValue {
  const context = useContext(EnvironmentContext)
  if (!context) throw new Error('useEnvironments must be used within EnvironmentProvider')
  return context
}
