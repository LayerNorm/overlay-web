'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { AccountWorkspaceInvitation } from '@overlay/workspace-contracts'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
  type WorkspaceProviderProps,
} from './WorkspaceContext.shared'
import { setActiveChatListWorkspace } from '@/shared/chat/chat-list-cache'
import { dispatchWorkspaceChanged } from '@/shared/workspaces/events'
import {
  readWorkspaceRouteTarget,
  workspaceRouteTargetKey,
  type WorkspaceRouteTarget,
} from '@/shared/workspaces/routing'
import type {
  WorkspaceClient,
  WorkspaceCreateInput,
  WorkspaceLifecycleStatus,
  WorkspaceSummary,
} from '@/shared/workspaces/types'

type WorkspaceListResult = Awaited<ReturnType<WorkspaceClient['list']>>

function shouldSoftReload(
  options: { force?: boolean } | undefined,
  status: WorkspaceLifecycleStatus,
  workspaces: readonly WorkspaceSummary[],
) {
  return !options?.force && status === 'ready' && workspaces.length > 0
}

async function resolveRouteWorkspace(
  routeTarget: WorkspaceRouteTarget | null,
  workspaces: readonly WorkspaceSummary[],
  client: WorkspaceClient,
  signal?: AbortSignal,
): Promise<{ workspaceId: string | null; canonicalHandle: string | null; unavailable: boolean }> {
  if (routeTarget?.kind === 'id') {
    return { workspaceId: routeTarget.value, canonicalHandle: null, unavailable: false }
  }
  if (routeTarget?.kind !== 'handle') {
    return { workspaceId: null, canonicalHandle: null, unavailable: false }
  }

  if (!client.resolveHandle) {
    const workspaceId = workspaces.find((workspace) =>
      workspace.kind === 'organization' && workspace.slug === routeTarget.value)?.id ?? null
    return { workspaceId, canonicalHandle: null, unavailable: !workspaceId }
  }

  try {
    const resolution = await client.resolveHandle(routeTarget.value, signal)
    return {
      workspaceId: resolution.workspaceId,
      canonicalHandle: resolution.canonical ? null : resolution.canonicalHandle,
      unavailable: false,
    }
  } catch {
    return { workspaceId: null, canonicalHandle: null, unavailable: true }
  }
}

async function findRouteWorkspace(
  workspaceId: string | null,
  response: WorkspaceListResult,
  softReload: boolean,
  client: WorkspaceClient,
  signal?: AbortSignal,
  initiallyUnavailable = false,
): Promise<{ response: WorkspaceListResult; workspace: WorkspaceSummary | null; unavailable: boolean }> {
  if (initiallyUnavailable) return { response, workspace: null, unavailable: true }

  let currentResponse = response
  let workspace = workspaceId
    ? currentResponse.workspaces.find((item) => item.id === workspaceId) ?? null
    : null

  if (workspaceId && !workspace && softReload) {
    currentResponse = await client.list(signal)
    workspace = currentResponse.workspaces.find((item) => item.id === workspaceId) ?? null
  }

  return {
    response: currentResponse,
    workspace,
    unavailable: Boolean(workspaceId && !workspace),
  }
}

function routeTargetMatchesCurrentWorkspace(
  routeTarget: WorkspaceRouteTarget | null,
  activeWorkspaceId: string | null,
  currentWorkspace: WorkspaceSummary | undefined,
  resolvedRouteTargetKey: string | null,
): boolean {
  if (routeTarget?.kind === 'id') return routeTarget.value === activeWorkspaceId
  if (routeTarget?.kind === 'handle') {
    return routeTarget.value === currentWorkspace?.slug
      || resolvedRouteTargetKey === workspaceRouteTargetKey(routeTarget)
  }
  return true
}

export function LegacyWorkspaceProvider({
  children,
  enabled = true,
  client,
}: {
  children: WorkspaceProviderProps['children']
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
  const routeGenerationRef = useRef({ pathname, generation: 0 })
  if (routeGenerationRef.current.pathname !== pathname) {
    routeGenerationRef.current = {
      pathname,
      generation: routeGenerationRef.current.generation + 1,
    }
  }
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    statusRef.current = status
    workspacesRef.current = workspaces
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [status, workspaces, activeWorkspaceId])
  useEffect(() => {
    setSwitchingWorkspaceId(null)
  }, [pathname])

  const load = useCallback(async (signal?: AbortSignal, options?: { force?: boolean }) => {
    const generation = routeGenerationRef.current.generation
    const isCurrent = () => mountedRef.current
      && generation === routeGenerationRef.current.generation
      && !signal?.aborted
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
    const targetMatchesCurrent = routeTargetMatchesCurrentWorkspace(
      routeTarget,
      activeWorkspaceIdRef.current,
      currentWorkspace,
      resolvedRouteTargetKey,
    )
    const softReload = shouldSoftReload(options, statusRef.current, workspacesRef.current)
      && targetMatchesCurrent
    if (!softReload) {
      setStatus('loading')
    }
    setError(null)
    try {
      const response: WorkspaceListResult = softReload
        ? {
            workspaces: workspacesRef.current,
            activeWorkspaceId: activeWorkspaceIdRef.current ?? '',
          }
        : await client.list(signal)
      if (!isCurrent()) return
      const routeResolution = await resolveRouteWorkspace(routeTarget, response.workspaces, client, signal)
      if (!isCurrent()) return
      if (routeResolution.canonicalHandle) {
        const canonicalPath = pathname.replace(/^\/w\/[^/]+/, `/w/${encodeURIComponent(routeResolution.canonicalHandle)}`)
        if (canonicalPath !== pathname) {
          const locationSuffix = typeof window === 'undefined'
            ? ''
            : `${window.location.search}${window.location.hash}`
          router.replace(`${canonicalPath}${locationSuffix}`, { scroll: false })
        }
      }
      const locatedWorkspace = await findRouteWorkspace(
        routeResolution.workspaceId,
        response,
        softReload,
        client,
        signal,
        routeResolution.unavailable,
      )
      if (!isCurrent()) return
      if (locatedWorkspace.unavailable) {
        setWorkspaces([])
        setActiveWorkspaceId(null)
        setActiveChatListWorkspace(null)
        setError('Workspace not found or you no longer have access.')
        setStatus('error')
        return
      }
      if (!softReload || locatedWorkspace.response !== response) {
        setInvitations(locatedWorkspace.response.invitations ?? [])
      }

      const nextWorkspaces = [...locatedWorkspace.response.workspaces]
      const nextActiveWorkspaceId = locatedWorkspace.workspace?.id
        ?? locatedWorkspace.response.activeWorkspaceId
        ?? locatedWorkspace.response.workspaces[0]?.id
        ?? null

      setWorkspaces(nextWorkspaces)
      setActiveWorkspaceId(nextActiveWorkspaceId)
      setActiveChatListWorkspace(nextActiveWorkspaceId)
      setResolvedRouteTargetKey(workspaceRouteTargetKey(routeTarget))
      setStatus('ready')
      const previousWorkspaceId = activeWorkspaceIdRef.current
      activeWorkspaceIdRef.current = nextActiveWorkspaceId
      if (nextActiveWorkspaceId && previousWorkspaceId && nextActiveWorkspaceId !== previousWorkspaceId) {
        dispatchWorkspaceChanged({ previousWorkspaceId, workspaceId: nextActiveWorkspaceId })
      }
    } catch (loadError) {
      if (!isCurrent()) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load workspaces.')
      setStatus('error')
    }
  }, [client, enabled, pathname, resolvedRouteTargetKey, router])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    const handleIdentityUpdate = () => {
      void load(undefined, { force: true })
    }
    window.addEventListener('overlay:identity-updated', handleIdentityUpdate)
    return () => window.removeEventListener('overlay:identity-updated', handleIdentityUpdate)
  }, [load])

  const refresh = useCallback(async () => {
    await load(undefined, { force: true })
  }, [load])

  const createWorkspace = useCallback(async (input: WorkspaceCreateInput, options?: { idempotencyKey: string }) => {
    const generation = routeGenerationRef.current.generation
    const response = await client.create(input, options)
    if (!mountedRef.current || generation !== routeGenerationRef.current.generation) {
      throw new Error('Workspace route changed before creation completed.')
    }
    setWorkspaces((current) => {
      const withoutCreated = current.filter((workspace) => workspace.id !== response.workspace.id)
      return [...withoutCreated, response.workspace]
    })
    return response.workspace
  }, [client])

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const generation = routeGenerationRef.current.generation
    if (workspaceId === activeWorkspaceId) {
      const current = workspaces.find((workspace) => workspace.id === workspaceId)
      if (current) return current
    }

    setSwitchingWorkspaceId(workspaceId)
    setError(null)
    try {
      const response = await client.activate(workspaceId)
      if (!mountedRef.current || generation !== routeGenerationRef.current.generation) {
        throw new Error('Workspace route changed before switching completed.')
      }
      setWorkspaces((current) => current.map((workspace) => (
        workspace.id === response.workspace.id ? response.workspace : workspace
      )))
      // Publish the active workspace only after load() resolves the destination route.
      // Until navigation commits, route-scoped requests still address the old workspace.
      return response.workspace
    } catch (switchError) {
      const message = switchError instanceof Error
        ? switchError.message
        : 'Could not switch workspaces.'
      if (mountedRef.current && generation === routeGenerationRef.current.generation) setError(message)
      throw switchError
    } finally {
      if (mountedRef.current && generation === routeGenerationRef.current.generation) {
        setSwitchingWorkspaceId(null)
      }
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
