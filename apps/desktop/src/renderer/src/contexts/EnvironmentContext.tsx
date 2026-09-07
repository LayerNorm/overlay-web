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
  fetchAgentDirectory,
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
  canCreateAgents: boolean
  error: string | null
  bindingsByEnvironmentId: ReadonlyMap<string, DesktopAgentBinding[]>
  bindingByAgentId: ReadonlyMap<string, DesktopAgentBinding>
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
  const [canCreateAgents, setCanCreateAgents] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (getAuthReadyState() !== true) return
    if (inFlight.current) return
    inFlight.current = true
    setStatus((prev) => (prev === 'ready' ? prev : 'loading'))
    try {
      const [environmentList, bindingList, directory] = await Promise.all([
        listEnvironments(),
        listBindings(),
        fetchAgentDirectory()
      ])
      setEnvironments(environmentList)
      setBindings(bindingList)
      setAgents(directory.agents)
      setCanCreateAgents(directory.canCreate)
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
    setCanCreateAgents(false)
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
    const bindingByAgentId = new Map<string, DesktopAgentBinding>()
    for (const binding of bindings) {
      if (!binding.enabled) continue
      const list = bindingsByEnvironmentId.get(binding.environmentId) ?? []
      list.push(binding)
      bindingsByEnvironmentId.set(binding.environmentId, list)
      if (!bindingByAgentId.has(binding.agentId)) bindingByAgentId.set(binding.agentId, binding)
    }
    return {
      status,
      environments,
      bindings,
      agents,
      canCreateAgents,
      error,
      bindingsByEnvironmentId,
      bindingByAgentId,
      refresh
    }
  }, [status, environments, bindings, agents, canCreateAgents, error, refresh])

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>
}

export function useEnvironments(): EnvironmentContextValue {
  const context = useContext(EnvironmentContext)
  if (!context) throw new Error('useEnvironments must be used within EnvironmentProvider')
  return context
}
