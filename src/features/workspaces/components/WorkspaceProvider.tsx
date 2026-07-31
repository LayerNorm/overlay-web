'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { setActiveChatListWorkspace } from '@/shared/chat/chat-list-cache'
import { dispatchWorkspaceChanged } from '../lib/workspace-events'
import { workspaceClient } from '../lib/workspace-client'
import { readWorkspaceIdFromPath } from '../lib/workspace-routing'
import type {
  WorkspaceClient,
  WorkspaceCreateInput,
  WorkspaceLifecycleStatus,
  WorkspaceSummary,
} from '../types'

type WorkspaceContextValue = {
  status: WorkspaceLifecycleStatus
  workspaces: readonly WorkspaceSummary[]
  activeWorkspace: WorkspaceSummary | null
  activeWorkspaceId: string | null
  error: string | null
  switchingWorkspaceId: string | null
  refresh(): Promise<void>
  createWorkspace(input: WorkspaceCreateInput): Promise<WorkspaceSummary>
  switchWorkspace(workspaceId: string): Promise<WorkspaceSummary>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  children,
  enabled = true,
  client = workspaceClient,
}: {
  children: ReactNode
  enabled?: boolean
  client?: WorkspaceClient
}) {
  const pathname = usePathname() ?? ''
  const [status, setStatus] = useState<WorkspaceLifecycleStatus>(enabled ? 'loading' : 'idle')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null)
  const statusRef = useRef(status)
  const workspacesRef = useRef(workspaces)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  statusRef.current = status
  workspacesRef.current = workspaces
  activeWorkspaceIdRef.current = activeWorkspaceId

  const load = useCallback(async (signal?: AbortSignal, options?: { force?: boolean }) => {
    if (!enabled) {
      setStatus('idle')
      setWorkspaces([])
      setActiveWorkspaceId(null)
      setActiveChatListWorkspace(null)
      return
    }

    // Soft path changes (chat ↔ files within the same workspace, or query-only
    // chat switches that still change Next's pathname) must not unmount the
    // entire app shell with the "Opening workspace…" gate.
    const softReload = !options?.force
      && statusRef.current === 'ready'
      && workspacesRef.current.length > 0
    if (!softReload) {
      setStatus('loading')
    }
    setError(null)
    try {
      const response = softReload
        ? {
            workspaces: workspacesRef.current,
            activeWorkspaceId: activeWorkspaceIdRef.current,
          }
        : await client.list(signal)
      if (signal?.aborted) return
      const desiredWorkspaceId = readWorkspaceIdFromPath(pathname)
      const desiredWorkspace = desiredWorkspaceId
        ? response.workspaces.find((workspace) => workspace.id === desiredWorkspaceId)
        : null
      if (desiredWorkspaceId && !desiredWorkspace) {
        // Path named a workspace we do not have — re-list hard before failing.
        if (softReload) {
          const fresh = await client.list(signal)
          if (signal?.aborted) return
          const found = fresh.workspaces.find((workspace) => workspace.id === desiredWorkspaceId)
          if (!found) {
            setWorkspaces([])
            setActiveWorkspaceId(null)
            setActiveChatListWorkspace(null)
            setError('Workspace not found or you no longer have access.')
            setStatus('error')
            return
          }
          setWorkspaces(fresh.workspaces)
          if (found.id !== fresh.activeWorkspaceId) {
            const activated = await client.activate(found.id)
            if (signal?.aborted) return
            setActiveWorkspaceId(activated.activeWorkspaceId)
            setActiveChatListWorkspace(activated.activeWorkspaceId)
            setWorkspaces((current) => current.map((workspace) => (
              workspace.id === activated.workspace.id ? activated.workspace : workspace
            )))
          } else {
            setActiveWorkspaceId(found.id)
            setActiveChatListWorkspace(found.id)
          }
          setStatus('ready')
          return
        }
        setWorkspaces([])
        setActiveWorkspaceId(null)
        setActiveChatListWorkspace(null)
        setError('Workspace not found or you no longer have access.')
        setStatus('error')
        return
      }

      let nextWorkspaces = [...response.workspaces]
      let nextActiveWorkspaceId = response.activeWorkspaceId ?? response.workspaces[0]?.id ?? null
      if (desiredWorkspace && desiredWorkspace.id !== nextActiveWorkspaceId) {
        const activated = await client.activate(desiredWorkspace.id)
        if (signal?.aborted) return
        nextActiveWorkspaceId = activated.activeWorkspaceId
        nextWorkspaces = nextWorkspaces.map((workspace) => (
          workspace.id === activated.workspace.id ? activated.workspace : workspace
        ))
      }

      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveWorkspaceId)
      setActiveChatListWorkspace(nextActiveWorkspaceId)
      setStatus('ready')
    } catch (loadError) {
      if (signal?.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load workspaces.')
      setStatus('error')
    }
  }, [client, enabled, pathname])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(async () => {
    await load(undefined, { force: true })
  }, [load])

  const createWorkspace = useCallback(async (input: WorkspaceCreateInput) => {
    const response = await client.create(input)
    setWorkspaces((current) => {
      const withoutCreated = current.filter((workspace) => workspace.id !== response.workspace.id)
      return [...withoutCreated, response.workspace]
    })
    return response.workspace
  }, [client])

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) {
      const current = workspaces.find((workspace) => workspace.id === workspaceId)
      if (current) return current
    }

    setSwitchingWorkspaceId(workspaceId)
    setError(null)
    try {
      const response = await client.activate(workspaceId)
      const previousWorkspaceId = activeWorkspaceId
      setWorkspaces((current) => current.map((workspace) => (
        workspace.id === response.workspace.id ? response.workspace : workspace
      )))
      setActiveWorkspaceId(response.activeWorkspaceId)
      setActiveChatListWorkspace(response.activeWorkspaceId)
      dispatchWorkspaceChanged({
        previousWorkspaceId,
        workspaceId: response.activeWorkspaceId,
      })
      return response.workspace
    } catch (switchError) {
      const message = switchError instanceof Error
        ? switchError.message
        : 'Could not switch workspaces.'
      setError(message)
      throw switchError
    } finally {
      setSwitchingWorkspaceId(null)
    }
  }, [activeWorkspaceId, client, workspaces])

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  )

  const value = useMemo<WorkspaceContextValue>(() => ({
    status,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    error,
    switchingWorkspaceId,
    refresh,
    createWorkspace,
    switchWorkspace,
  }), [
    activeWorkspace,
    activeWorkspaceId,
    createWorkspace,
    error,
    refresh,
    status,
    switchWorkspace,
    switchingWorkspaceId,
    workspaces,
  ])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return value
}
