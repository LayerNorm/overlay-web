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
import { useConvex, useConvexAuth, useQuery } from 'convex/react'
import type { AccountWorkspaceInvitation } from '@overlay/workspace-contracts'
import { dispatchWorkspaceChanged } from '@/shared/workspaces/events'
import {
  readWorkspaceRouteTarget,
  workspaceRouteTargetKey,
  type WorkspaceRouteTarget,
} from '@/shared/workspaces/routing'
import { api } from '../../convex/_generated/api'
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

type LiveDirectory = {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string
  invitations: AccountWorkspaceInvitation[]
}
type HandleResolver = (handle: string) => Promise<{ workspaceId: string; canonicalHandle: string; canonical: boolean } | null>

async function resolveRouteWorkspace(
  routeTarget: WorkspaceRouteTarget | null,
  resolveHandle: HandleResolver,
): Promise<{ workspaceId: string | null; canonicalHandle: string | null; unavailable: boolean }> {
  if (routeTarget?.kind === 'id') {
    return { workspaceId: routeTarget.value, canonicalHandle: null, unavailable: false }
  }
  if (routeTarget?.kind !== 'handle') {
    return { workspaceId: null, canonicalHandle: null, unavailable: false }
  }
  try {
    const resolution = await resolveHandle(routeTarget.value)
    if (!resolution) return { workspaceId: null, canonicalHandle: null, unavailable: true }
    return {
      workspaceId: resolution.workspaceId,
      canonicalHandle: resolution.canonical ? null : resolution.canonicalHandle,
      unavailable: false,
    }
  } catch {
    return { workspaceId: null, canonicalHandle: null, unavailable: true }
  }
}

/** The live list plus workspaces this tab just created that the subscription has not delivered yet. */
function withCreated(live: readonly WorkspaceSummary[], created: ReadonlyMap<string, WorkspaceSummary>): WorkspaceSummary[] {
  const pending = [...created.values()].filter((workspace) => !live.some((item) => item.id === workspace.id))
  return [...live, ...pending]
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
  const convex = useConvex()
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth()
  // Live: renames, icons, handles, member counts, invitations and lost access reach every tab without a reload.
  const live = useQuery(
    api.collaboration.directory.workspaces,
    enabled && isAuthenticated && !convexAuthLoading ? {} : 'skip',
  ) as LiveDirectory | null | undefined
  const [status, setStatus] = useState<WorkspaceLifecycleStatus>(enabled ? 'loading' : 'idle')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [invitations, setInvitations] = useState<AccountWorkspaceInvitation[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null)
  const [resolvedRouteTargetKey, setResolvedRouteTargetKey] = useState<string | null>(null)
  const statusRef = useRef(status)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  const workspacesRef = useRef(workspaces)
  const liveRef = useRef(live)
  const createdRef = useRef(new Map<string, WorkspaceSummary>())
  const liveReady = Boolean(live)
  useEffect(() => {
    statusRef.current = status
    activeWorkspaceIdRef.current = activeWorkspaceId
    workspacesRef.current = workspaces
    liveRef.current = live
  }, [status, activeWorkspaceId, live, workspaces])

  const resolveHandle = useCallback<HandleResolver>(
    (handle) => convex.query(api.collaboration.directory.resolveHandle, { handle }),
    [convex],
  )

  const load = useCallback(async (options?: { force?: boolean; cancelled?: () => boolean }) => {
    const cancelled = options?.cancelled ?? (() => false)
    if (!enabled) {
      setStatus('idle')
      setWorkspaces([])
      setInvitations([])
      setActiveWorkspaceId(null)
      setResolvedRouteTargetKey(null)
      return
    }
    const directory = liveRef.current
    // The live directory has not arrived yet; this runs again when it does.
    if (!directory) return
    const listed = withCreated(directory.workspaces, createdRef.current)

    // Soft path changes (chat ↔ files within the same workspace, or query-only
    // chat switches that still change Next's pathname) must not unmount the
    // entire app shell with the "Opening workspace…" gate.
    const routeTarget = readWorkspaceRouteTarget(pathname)
    const currentWorkspace = listed.find((workspace) => workspace.id === activeWorkspaceIdRef.current)
    const targetMatchesCurrent = routeTargetMatchesCurrentWorkspace(
      routeTarget,
      activeWorkspaceIdRef.current,
      currentWorkspace,
      resolvedRouteTargetKey,
    )
    const softReload = !options?.force && statusRef.current === 'ready' && targetMatchesCurrent
    if (!softReload) setStatus('loading')
    setError(null)
    const routeResolution = await resolveRouteWorkspace(routeTarget, resolveHandle)
    if (cancelled()) return
    if (routeResolution.canonicalHandle) {
      const canonicalPath = pathname.replace(/^\/w\/[^/]+/, `/w/${encodeURIComponent(routeResolution.canonicalHandle)}`)
      if (canonicalPath !== pathname) {
        const locationSuffix = typeof window === 'undefined'
          ? ''
          : `${window.location.search}${window.location.hash}`
        router.replace(`${canonicalPath}${locationSuffix}`, { scroll: false })
      }
    }
    const routeWorkspace = routeResolution.workspaceId
      ? listed.find((item) => item.id === routeResolution.workspaceId) ?? null
      : null
    if (routeResolution.unavailable || (routeResolution.workspaceId && !routeWorkspace)) {
      setWorkspaces([])
      setActiveWorkspaceId(null)
      setError('Workspace not found or you no longer have access.')
      setStatus('error')
      return
    }

    const nextActiveWorkspaceId = routeWorkspace?.id
      ?? (directory.activeWorkspaceId || null)
      ?? listed[0]?.id
      ?? null
    setWorkspaces(listed)
    setInvitations(directory.invitations)
    setActiveWorkspaceId(nextActiveWorkspaceId)
    setResolvedRouteTargetKey(workspaceRouteTargetKey(routeTarget))
    setStatus('ready')
    const previousWorkspaceId = activeWorkspaceIdRef.current
    activeWorkspaceIdRef.current = nextActiveWorkspaceId
    if (nextActiveWorkspaceId && previousWorkspaceId && nextActiveWorkspaceId !== previousWorkspaceId) {
      dispatchWorkspaceChanged({ previousWorkspaceId, workspaceId: nextActiveWorkspaceId })
    }
  }, [enabled, pathname, resolveHandle, resolvedRouteTargetKey, router])

  useEffect(() => {
    let cancelled = false
    void load({ cancelled: () => cancelled })
    return () => { cancelled = true }
  }, [load, liveReady])

  // The directory effect below runs only when the directory changes, not on every navigation.
  const loadRef = useRef(load)
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    loadRef.current = load
    pathnameRef.current = pathname
  }, [load, pathname])

  // Later directory changes apply in place. Losing access to the open workspace shows the unavailable screen;
  // another tab choosing a different workspace changes nothing here, because the route decides this tab's workspace.
  useEffect(() => {
    if (!live) return
    // A membership that arrives after the route was judged unavailable (an invitation accepted over HTTP before the
    // subscription caught up) opens the workspace instead of leaving the unavailable screen up.
    // Each directory-triggered reload is dropped if the address changes before it finishes, so it can never pull
    // the person back to a page they left.
    const address = pathnameRef.current
    const cancelled = () => pathnameRef.current !== address
    if (statusRef.current === 'error') {
      void loadRef.current({ force: true, cancelled })
      return
    }
    if (statusRef.current !== 'ready') return
    for (const id of createdRef.current.keys()) {
      if (live.workspaces.some((workspace) => workspace.id === id)) createdRef.current.delete(id)
    }
    const listed = withCreated(live.workspaces, createdRef.current)
    const activeId = activeWorkspaceIdRef.current
    if (activeId && !listed.some((workspace) => workspace.id === activeId)) {
      setWorkspaces([])
      setActiveWorkspaceId(null)
      setError('Workspace not found or you no longer have access.')
      setStatus('error')
      return
    }
    const handleChanged = Boolean(activeId) && readWorkspaceRouteTarget(pathnameRef.current)?.kind === 'handle'
      && listed.find((workspace) => workspace.id === activeId)?.slug
        !== workspacesRef.current.find((workspace) => workspace.id === activeId)?.slug
    setWorkspaces(listed)
    setInvitations(live.invitations)
    // The open workspace's handle changed elsewhere: resolve this address again, which moves it to the new handle.
    if (handleChanged) void loadRef.current({ cancelled })
  }, [live])

  const refresh = useCallback(async () => {
    await load({ force: true })
  }, [load])

  const createWorkspace = useCallback(async (input: WorkspaceCreateInput, options?: { idempotencyKey: string }) => {
    const response = await client.create(input, options)
    createdRef.current.set(response.workspace.id, response.workspace)
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

/** The workspace context where one may be absent (such as tests); null outside a provider. */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}
