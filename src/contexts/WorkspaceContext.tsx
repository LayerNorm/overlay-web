'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useConvex, useConvexAuth, useQuery } from 'convex/react'
import { toast } from '@overlay/ui/primitives'
import type { AccountWorkspaceInvitation } from '@overlay/workspace-contracts'
import { isWorkspaceSwitchSupersededError, WorkspaceSwitchSupersededError } from '@/shared/workspaces/workspace-switch-error'
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
  beginWorkspaceNavigation(workspaceId: string): void
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
type WorkspaceHistoryTarget = { pathname: string; generation: number }
type RouteLoadSnapshot = {
  pathname: string
  routePathGeneration: number
  loadGeneration: number
  navigationGeneration: number
  historyGeneration: number | null
}

async function resolveRouteWorkspace(
  routeTarget: WorkspaceRouteTarget | null,
  resolveHandle: HandleResolver,
  liveWorkspaces: readonly WorkspaceSummary[],
): Promise<{ workspaceId: string | null; canonicalHandle: string | null; unavailable: boolean }> {
  if (routeTarget?.kind === 'id') {
    return { workspaceId: routeTarget.value, canonicalHandle: null, unavailable: false }
  }
  if (routeTarget?.kind !== 'handle') {
    return { workspaceId: null, canonicalHandle: null, unavailable: false }
  }
  const known = liveWorkspaces.find(workspace => workspace.status === 'active'
    && workspace.routingHandle === routeTarget.value)
  if (known) return { workspaceId: known.id, canonicalHandle: null, unavailable: false }
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

function isRouteLoadObsolete(
  snapshot: RouteLoadSnapshot,
  current: RouteLoadSnapshot,
  cancelled: () => boolean,
  lastResolvedPathname: string | null,
  historyTargetPathname: string | null,
): boolean {
  return cancelled()
    || snapshot.pathname !== current.pathname
    || snapshot.routePathGeneration !== current.routePathGeneration
    || snapshot.loadGeneration !== current.loadGeneration
    || snapshot.navigationGeneration !== current.navigationGeneration
    || snapshot.historyGeneration !== current.historyGeneration
    || (historyTargetPathname !== null
      && historyTargetPathname !== snapshot.pathname
      && lastResolvedPathname === snapshot.pathname)
}

function replaceCanonicalWorkspaceRoute(
  pathname: string,
  canonicalHandle: string | null,
  router: ReturnType<typeof useRouter>,
): void {
  if (!canonicalHandle) return
  const canonicalPath = pathname.replace(/^\/w\/[^/]+/, `/w/${encodeURIComponent(canonicalHandle)}`)
  if (canonicalPath === pathname) return
  const locationSuffix = typeof window === 'undefined'
    ? ''
    : `${window.location.search}${window.location.hash}`
  router.replace(`${canonicalPath}${locationSuffix}`, { scroll: false })
}

function isRouteWorkspaceUnavailable(
  resolution: { workspaceId: string | null; unavailable: boolean },
  routeWorkspace: WorkspaceSummary | null,
): boolean {
  return resolution.unavailable || Boolean(resolution.workspaceId && !routeWorkspace)
}

function workspacePreferenceForRouteChange(
  authoritativeRouteChange: boolean,
  pathChanged: boolean,
  routeWorkspace: WorkspaceSummary | null,
  latestActivationRequest: { workspaceId: string } | null,
  previousWorkspaceId: string | null,
): WorkspaceSummary | null {
  if (!authoritativeRouteChange || !routeWorkspace) return null
  if (latestActivationRequest) {
    return latestActivationRequest.workspaceId !== routeWorkspace.id ? routeWorkspace : null
  }
  return pathChanged && routeWorkspace.id !== previousWorkspaceId ? routeWorkspace : null
}

function resolveNextActiveWorkspaceId(
  routeWorkspace: WorkspaceSummary | null,
  directory: LiveDirectory,
  listed: readonly WorkspaceSummary[],
): string | null {
  return routeWorkspace?.id
    ?? (directory.activeWorkspaceId || null)
    ?? listed[0]?.id
    ?? null
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
  const pathnameRef = useRef(pathname)
  const routePathGenerationRef = useRef(0)
  useLayoutEffect(() => {
    if (pathnameRef.current === pathname) return
    pathnameRef.current = pathname
    routePathGenerationRef.current += 1
  }, [pathname])
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
  const activationGenerationRef = useRef(0)
  const routeLoadGenerationRef = useRef(0)
  const navigationGenerationRef = useRef(0)
  const historyTargetRef = useRef<WorkspaceHistoryTarget | null>(null)
  const lastResolvedPathnameRef = useRef<string | null>(null)
  const activationPendingCountRef = useRef(0)
  const activationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const latestActivationRequestRef = useRef<{
    workspaceId: string
    generation: number
    promise: Promise<WorkspaceSummary>
  } | null>(null)
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

  const queueWorkspaceActivation = useCallback((workspace: WorkspaceSummary) => {
    const generation = ++activationGenerationRef.current
    const snapshot = workspacesRef.current.find((item) => item.id === workspace.id)
      ?? createdRef.current.get(workspace.id)
      ?? workspace
    activationPendingCountRef.current += 1
    const promise = activationQueueRef.current.catch(() => undefined).then(async () => {
      try {
        const isLatestRequest = () => latestActivationRequestRef.current?.generation === generation
        if (!isLatestRequest()) throw new WorkspaceSwitchSupersededError()
        try {
          await client.activate(workspace.id)
        } catch (activationError) {
          if (!isLatestRequest()) throw new WorkspaceSwitchSupersededError()
          throw activationError
        }
        if (!isLatestRequest()) throw new WorkspaceSwitchSupersededError()
        return workspacesRef.current.find((item) => item.id === workspace.id)
          ?? createdRef.current.get(workspace.id)
          ?? snapshot
      } finally {
        activationPendingCountRef.current -= 1
      }
    })
    activationQueueRef.current = promise.then(() => undefined, () => undefined)
    latestActivationRequestRef.current = { workspaceId: workspace.id, generation, promise }
    return promise
  }, [client])

  const beginWorkspaceNavigation = useCallback((workspaceId: string) => {
    navigationGenerationRef.current += 1
    routeLoadGenerationRef.current += 1
    historyTargetRef.current = null
    if (activeWorkspaceIdRef.current === workspaceId) {
      setSwitchingWorkspaceId(null)
    } else {
      setSwitchingWorkspaceId(workspaceId)
    }
    setError(null)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    function handlePopState() {
      const pathname = window.location.pathname
      const generation = ++navigationGenerationRef.current
      historyTargetRef.current = { pathname, generation }
      routeLoadGenerationRef.current += 1
      setSwitchingWorkspaceId(null)

      const routeTarget = readWorkspaceRouteTarget(pathname)
      const activeWorkspaceId = activeWorkspaceIdRef.current
      const currentWorkspace = workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceId)
      if (!routeTarget || statusRef.current !== 'ready' || !currentWorkspace) {
        return
      }
      if (!routeTargetMatchesCurrentWorkspace(routeTarget, activeWorkspaceId, currentWorkspace, resolvedRouteTargetKey)) return

      historyTargetRef.current = null
      const latestActivationRequest = latestActivationRequestRef.current
      if (latestActivationRequest && latestActivationRequest.workspaceId !== currentWorkspace.id) {
        void queueWorkspaceActivation(currentWorkspace).catch((activationError) => {
          if (isWorkspaceSwitchSupersededError(activationError)) return
          toast.error(activationError instanceof Error ? activationError.message : 'Could not switch workspaces.')
        })
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [queueWorkspaceActivation, resolvedRouteTargetKey])

  const load = useCallback(async (options?: { force?: boolean; cancelled?: () => boolean }) => {
    const loadGeneration = ++routeLoadGenerationRef.current
    const cancelled = options?.cancelled ?? (() => false)
    if (!enabled) {
      historyTargetRef.current = null
      setStatus('idle')
      setWorkspaces([])
      setInvitations([])
      setActiveWorkspaceId(null)
      setSwitchingWorkspaceId(null)
      setResolvedRouteTargetKey(null)
      return
    }
    const directory = liveRef.current
    // The live directory has not arrived yet; this runs again when it does.
    if (!directory) return
    const routePathGeneration = routePathGenerationRef.current
    const navigationGeneration = navigationGenerationRef.current
    const historyGeneration = historyTargetRef.current?.generation ?? null
    const routeLoadSnapshot = {
      pathname,
      routePathGeneration,
      loadGeneration,
      navigationGeneration,
      historyGeneration,
    }
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
    const routeResolution = await resolveRouteWorkspace(routeTarget, resolveHandle, directory.workspaces)
    if (isRouteLoadObsolete(
      routeLoadSnapshot,
      {
        pathname: pathnameRef.current,
        routePathGeneration: routePathGenerationRef.current,
        loadGeneration: routeLoadGenerationRef.current,
        navigationGeneration: navigationGenerationRef.current,
        historyGeneration: historyTargetRef.current?.generation ?? null,
      },
      cancelled,
      lastResolvedPathnameRef.current,
      historyTargetRef.current?.pathname ?? null,
    )) return
    const currentDirectory = liveRef.current ?? directory
    const currentListed = withCreated(currentDirectory.workspaces, createdRef.current)
    const liveRouteWorkspace = routeTarget?.kind === 'handle'
      ? currentDirectory.workspaces.find((workspace) => workspace.status === 'active'
        && workspace.routingHandle === routeTarget.value)
      : undefined
    const currentRouteResolution = liveRouteWorkspace
      ? { workspaceId: liveRouteWorkspace.id, canonicalHandle: null, unavailable: false }
      : routeResolution
    replaceCanonicalWorkspaceRoute(pathname, currentRouteResolution.canonicalHandle, router)
    const routeWorkspace = currentRouteResolution.workspaceId
      ? currentListed.find((item) => item.id === currentRouteResolution.workspaceId) ?? null
      : null
    if (isRouteWorkspaceUnavailable(currentRouteResolution, routeWorkspace)) {
      setWorkspaces([])
      setActiveWorkspaceId(null)
      setSwitchingWorkspaceId(null)
      historyTargetRef.current = null
      setError('Workspace not found or you no longer have access.')
      setStatus('error')
      return
    }

    const pathChanged = lastResolvedPathnameRef.current !== null
      && lastResolvedPathnameRef.current !== pathname
    const previousWorkspaceId = activeWorkspaceIdRef.current
    const historyOwnsRoute = historyTargetRef.current?.pathname === pathname
    const authoritativeRouteChange = pathChanged || historyOwnsRoute
    const preferenceWorkspace = workspacePreferenceForRouteChange(
      authoritativeRouteChange,
      pathChanged,
      routeWorkspace,
      latestActivationRequestRef.current,
      previousWorkspaceId,
    )

    if (authoritativeRouteChange) {
      historyTargetRef.current = null
      setSwitchingWorkspaceId(null)
    }

    const nextActiveWorkspaceId = resolveNextActiveWorkspaceId(routeWorkspace, currentDirectory, currentListed)
    setWorkspaces(currentListed)
    setInvitations(currentDirectory.invitations)
    setActiveWorkspaceId(nextActiveWorkspaceId)
    setResolvedRouteTargetKey(workspaceRouteTargetKey(routeTarget))
    setStatus('ready')
    activeWorkspaceIdRef.current = nextActiveWorkspaceId
    lastResolvedPathnameRef.current = pathname
    if (nextActiveWorkspaceId && previousWorkspaceId && nextActiveWorkspaceId !== previousWorkspaceId) {
      dispatchWorkspaceChanged({ previousWorkspaceId, workspaceId: nextActiveWorkspaceId })
    }
    if (preferenceWorkspace) {
      void queueWorkspaceActivation(preferenceWorkspace).catch((activationError) => {
        if (isWorkspaceSwitchSupersededError(activationError)) return
        toast.error(activationError instanceof Error ? activationError.message : 'Could not switch workspaces.')
      })
    }
  }, [enabled, pathname, queueWorkspaceActivation, resolveHandle, resolvedRouteTargetKey, router])

  useEffect(() => {
    let cancelled = false
    void load({ cancelled: () => cancelled })
    return () => { cancelled = true }
  }, [load, liveReady])

  // The directory effect below runs only when the directory changes, not on every navigation.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
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

  const switchWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspacesRef.current.find((item) => item.id === workspaceId)
      ?? createdRef.current.get(workspaceId)
    if (!workspace) return Promise.reject(new Error('Could not switch workspaces.'))

    const latest = latestActivationRequestRef.current
    if (latest?.workspaceId === workspaceId && activationPendingCountRef.current > 0) return latest.promise
    if (activeWorkspaceIdRef.current === workspaceId
      && activationPendingCountRef.current === 0
      && (!latest || latest.workspaceId === workspaceId)) {
      return Promise.resolve(workspace)
    }
    return queueWorkspaceActivation(workspace)
  }, [queueWorkspaceActivation])

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
    beginWorkspaceNavigation,
    refresh,
    resolvedRouteTargetKey,
    createWorkspace,
    switchWorkspace,
  }), [
    activeWorkspace,
    activeWorkspaceId,
    beginWorkspaceNavigation,
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
