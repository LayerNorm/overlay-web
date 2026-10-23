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
import { usePathname, useRouter } from 'next/navigation'
import type { AccountWorkspaceInvitation } from '@overlay/workspace-contracts'
import { setActiveChatListWorkspace } from '@/shared/chat/chat-list-cache'
import { dispatchWorkspaceChanged } from '@/shared/workspaces/events'
import { readWorkspaceRouteTarget, workspaceRouteTargetKey } from '@/shared/workspaces/routing'
import type {
  WorkspaceClient,
  WorkspaceCreateInput,
  WorkspaceLifecycleStatus,
  WorkspaceSummary,
} from '@/shared/workspaces/types'

export type WorkspaceContextValue = {
  status: WorkspaceLifecycleStatus
  workspaces: readonly WorkspaceSummary[]
  invitations?: readonly AccountWorkspaceInvitation[]
  activeWorkspace: WorkspaceSummary | null
  activeWorkspaceId: string | null
  error: string | null
  switchingWorkspaceId: string | null
  resolvedRouteTargetKey: string | null
  refresh(): Promise<void>
  createWorkspace(input: WorkspaceCreateInput, options?: { idempotencyKey: string }): Promise<WorkspaceSummary>
  switchWorkspace(workspaceId: string): Promise<WorkspaceSummary>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function shouldSoftReload(
  options: { force?: boolean } | undefined,
  status: WorkspaceLifecycleStatus,
  workspaces: readonly WorkspaceSummary[],
) {
  return !options?.force && status === 'ready' && workspaces.length > 0
}

export function WorkspaceProvider({
  children,
  enabled = true,
  client,
}: {
  children: ReactNode
  enabled?: boolean
  client: WorkspaceClient
}) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const [status, setStatus] = useState<WorkspaceLifecycleStatus>(enabled ? 'loading' : 'idle')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [invitations, setInvitations] = useState<AccountWorkspaceInvitation[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null)
  const [resolvedRouteTargetKey, setResolvedRouteTargetKey] = useState<string | null>(null)
  const statusRef = useRef(status)
  const workspacesRef = useRef(workspaces)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  useEffect(() => {
    statusRef.current = status
    workspacesRef.current = workspaces
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [status, workspaces, activeWorkspaceId])

  const load = useCallback(async (signal?: AbortSignal, options?: { force?: boolean }) => {
    if (!enabled) {
      setStatus('idle')
      setWorkspaces([])
      setInvitations([])
      setActiveWorkspaceId(null)
      setActiveChatListWorkspace(null)
      setResolvedRouteTargetKey(null)
      return
    }

    // Soft path changes (chat ↔ files within the same workspace, or query-only
    // chat switches that still change Next's pathname) must not unmount the
    // entire app shell with the "Opening workspace…" gate.
    const routeTarget = readWorkspaceRouteTarget(pathname)
    const currentWorkspace = workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceIdRef.current)
    const targetMatchesCurrent = routeTarget?.kind === 'id'
      ? routeTarget.value === activeWorkspaceIdRef.current
      : routeTarget?.kind === 'handle'
        ? routeTarget.value === currentWorkspace?.slug
          || resolvedRouteTargetKey === workspaceRouteTargetKey(routeTarget)
        : true
    const softReload = shouldSoftReload(options, statusRef.current, workspacesRef.current)
      && targetMatchesCurrent
    if (!softReload) {
      setStatus('loading')
    }
    setError(null)
    try {
      const response: Awaited<ReturnType<WorkspaceClient['list']>> = softReload
        ? {
            workspaces: workspacesRef.current,
            activeWorkspaceId: activeWorkspaceIdRef.current ?? '',
          }
        : await client.list(signal)
      if (signal?.aborted) return
      let desiredWorkspaceId = routeTarget?.kind === 'id' ? routeTarget.value : null
      let canonicalHandle: string | null = null
      let handleResolutionFailed = false
      if (routeTarget?.kind === 'handle') {
        if (client.resolveHandle) {
          try {
            const resolution = await client.resolveHandle(routeTarget.value, signal)
            if (signal?.aborted) return
            desiredWorkspaceId = resolution.workspaceId
            if (!resolution.canonical) canonicalHandle = resolution.canonicalHandle
          } catch {
            if (signal?.aborted) return
            desiredWorkspaceId = null
            handleResolutionFailed = true
          }
        } else {
          desiredWorkspaceId = response.workspaces.find((workspace) => workspace.slug === routeTarget.value)?.id ?? null
          handleResolutionFailed = !desiredWorkspaceId
        }
      }
      if (handleResolutionFailed) {
        setWorkspaces([])
        setActiveWorkspaceId(null)
        setActiveChatListWorkspace(null)
        setError('Workspace not found or you no longer have access.')
        setStatus('error')
        return
      }
      if (canonicalHandle) {
        const canonicalPath = pathname.replace(/^\/w\/[^/]+/, `/w/${encodeURIComponent(canonicalHandle)}`)
        if (canonicalPath !== pathname) {
          const locationSuffix = typeof window === 'undefined'
            ? ''
            : `${window.location.search}${window.location.hash}`
          router.replace(`${canonicalPath}${locationSuffix}`, { scroll: false })
        }
      }
      if (!softReload) setInvitations(response.invitations ?? [])
      const desiredWorkspace = desiredWorkspaceId
        ? response.workspaces.find((workspace) => workspace.id === desiredWorkspaceId)
        : null
      if (desiredWorkspaceId && !desiredWorkspace) {
        // Path named a workspace we do not have — re-list hard before failing.
        if (softReload) {
          const fresh = await client.list(signal)
          if (signal?.aborted) return
          setInvitations(fresh.invitations ?? [])
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
          setActiveWorkspaceId(found.id)
          setActiveChatListWorkspace(found.id)
          setResolvedRouteTargetKey(workspaceRouteTargetKey(routeTarget))
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

      const nextWorkspaces = [...response.workspaces]
      const nextActiveWorkspaceId = desiredWorkspace?.id
        ?? response.activeWorkspaceId
        ?? response.workspaces[0]?.id
        ?? null

      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveWorkspaceId)
      setActiveChatListWorkspace(nextActiveWorkspaceId)
      setResolvedRouteTargetKey(workspaceRouteTargetKey(routeTarget))
      setStatus('ready')
    } catch (loadError) {
      if (signal?.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load workspaces.')
      setStatus('error')
    }
  }, [client, enabled, pathname, resolvedRouteTargetKey, router])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const refresh = useCallback(async () => {
    await load(undefined, { force: true })
  }, [load])

  const createWorkspace = useCallback(async (input: WorkspaceCreateInput, options?: { idempotencyKey: string }) => {
    const response = await client.create(input, options)
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
    invitations,
    activeWorkspace,
    activeWorkspaceId,
    error,
    switchingWorkspaceId,
    refresh,
    resolvedRouteTargetKey,
    createWorkspace,
    switchWorkspace,
  }), [
    activeWorkspace,
    activeWorkspaceId,
    createWorkspace,
    error,
    refresh,
    resolvedRouteTargetKey,
    status,
    switchWorkspace,
    switchingWorkspaceId,
    workspaces,
    invitations,
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

/** The workspace context where one may be absent (tests, the public showcase); null outside a provider. */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}
