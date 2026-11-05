'use client'

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { AccountWorkspaceInvitation } from '@overlay/workspace-contracts'
import { useAuth } from '@/contexts/AuthContext'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
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
const EMPTY_WORKSPACES: WorkspaceSummary[] = []

function shouldSoftReload(
  options: { force?: boolean } | undefined,
  status: WorkspaceLifecycleStatus,
  workspaces: readonly WorkspaceSummary[],
) {
  return !options?.force && status === 'ready' && workspaces.length > 0
}

type WorkspaceListResult = Awaited<ReturnType<WorkspaceClient['list']>>

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

function LegacyWorkspaceProvider({
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
      const response: Awaited<ReturnType<WorkspaceClient['list']>> = softReload
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

type WorkspaceProviderProps = {
  children: ReactNode
  enabled?: boolean
  client: WorkspaceClient
}

export function WorkspaceProvider(props: WorkspaceProviderProps) {
  const configuration = useConvexAuthConfiguration()
  const { user } = useAuth()
  const identityKey = user?.id ?? 'anonymous'

  if (!configuration.nativeAuthConfigured) {
    return <LegacyWorkspaceProvider key={identityKey} {...props} />
  }
  if (!configuration.hasConvexClient) {
    return <UnavailableNativeWorkspaceProvider key={identityKey} {...props} />
  }
  return <NativeWorkspaceProvider key={identityKey} identityKey={identityKey} {...props} />
}

type NativeWorkspaceOperations = Pick<WorkspaceContextValue, 'refresh' | 'createWorkspace' | 'switchWorkspace'>
type WorkspaceRouteScope = { pathname: string; generation: number }

function useWorkspaceRouteScope(pathname: string) {
  const scopeRef = useRef<WorkspaceRouteScope>({ pathname, generation: 0 })
  useEffect(() => {
    if (scopeRef.current.pathname === pathname) return
    scopeRef.current = { pathname, generation: scopeRef.current.generation + 1 }
  }, [pathname])
  return scopeRef
}

class WorkspaceQueryErrorBoundary extends Component<{
  children: ReactNode
  renderError(error: Error, retry: () => void): ReactNode
  onCaught(error: Error): void
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onCaught(error)
  }

  render() {
    if (this.state.error) {
      return this.props.renderError(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}

function NativeWorkspaceProvider({
  children,
  enabled = true,
  client,
  identityKey,
}: WorkspaceProviderProps & { identityKey: string }) {
  const pathname = usePathname() ?? ''
  const scopeKey = `${identityKey}:${pathname}`
  const scopeRef = useWorkspaceRouteScope(pathname)
  const mountedRef = useRef(false)
  const activeWorkspaceRef = useRef<WorkspaceSummary | null>(null)
  const [localWorkspaceId, setLocalWorkspaceId] = useState<string | null>(null)
  const [switching, setSwitching] = useState<{ id: string; scopeKey: string } | null>(null)
  const [operationError, setOperationError] = useState<{ message: string; scopeKey: string } | null>(null)
  const [invitations, setInvitations] = useState<AccountWorkspaceInvitation[]>([])
  const [invitationRefresh, setInvitationRefresh] = useState(0)
  const [dataSnapshot, setDataSnapshot] = useState<{
    scopeKey: string
    value: WorkspaceContextValue
  } | null>(null)
  const [queryFailure, setQueryFailure] = useState<{ scopeKey: string; message: string } | null>(null)
  const queryRetryRef = useRef<{ scopeKey: string; retry: () => void } | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      setActiveChatListWorkspace(null)
    }
  }, [])

  useEffect(() => {
    setSwitching(null)
    setOperationError(null)
    setInvitations([])
  }, [identityKey, pathname])

  const isCurrent = useCallback((generation: number) => (
    mountedRef.current && generation === scopeRef.current.generation
  ), [scopeRef])

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return
    setDataSnapshot(null)
    setQueryFailure(null)
    setInvitationRefresh(current => current + 1)
    if (queryRetryRef.current?.scopeKey === scopeKey) queryRetryRef.current.retry()
  }, [scopeKey])

  const createWorkspace = useCallback(async (
    input: WorkspaceCreateInput,
    options?: { idempotencyKey: string },
  ) => {
    const generation = scopeRef.current.generation
    const result = await client.create(input, options)
    if (!isCurrent(generation)) throw new Error('Workspace route changed before creation completed.')
    return result.workspace
  }, [client, isCurrent, scopeRef])

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const generation = scopeRef.current.generation
    if (activeWorkspaceRef.current?.id === workspaceId) return activeWorkspaceRef.current
    setSwitching({ id: workspaceId, scopeKey })
    setOperationError(null)
    try {
      const result = await client.activate(workspaceId)
      if (!isCurrent(generation)) throw new Error('Workspace route changed before switching completed.')
      return result.workspace
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not switch workspaces.'
      if (isCurrent(generation)) setOperationError({ message, scopeKey })
      throw caught
    } finally {
      if (isCurrent(generation)) setSwitching(null)
    }
  }, [client, isCurrent, scopeKey, scopeRef])

  const operations = useMemo<NativeWorkspaceOperations>(() => ({
    refresh,
    createWorkspace,
    switchWorkspace,
  }), [createWorkspace, refresh, switchWorkspace])

  const onDataValue = useCallback((value: WorkspaceContextValue) => {
    activeWorkspaceRef.current = value.activeWorkspace
    if (value.activeWorkspace) setLocalWorkspaceId(value.activeWorkspace.id)
    setDataSnapshot({ scopeKey, value })
  }, [scopeKey])
  const currentValue = dataSnapshot?.scopeKey === scopeKey ? dataSnapshot.value : null
  const currentFailure = queryFailure?.scopeKey === scopeKey ? queryFailure.message : null
  const contextValue = useMemo<WorkspaceContextValue>(() => ({
    status: !enabled ? 'idle' : currentFailure ? 'error' : currentValue?.status ?? 'loading',
    workspaces: currentFailure ? [] : currentValue?.workspaces ?? [],
    invitations: currentFailure ? [] : currentValue?.invitations ?? invitations,
    activeWorkspace: currentFailure ? null : currentValue?.activeWorkspace ?? null,
    activeWorkspaceId: currentFailure ? null : currentValue?.activeWorkspaceId ?? null,
    error: currentFailure ? currentFailure : currentValue?.error ?? null,
    switchingWorkspaceId: currentFailure ? null : currentValue?.switchingWorkspaceId ?? null,
    resolvedRouteTargetKey: currentFailure ? null : currentValue?.resolvedRouteTargetKey ?? null,
    ...operations,
  }), [currentFailure, currentValue, enabled, invitations, operations])

  return (
    <>
      <WorkspaceQueryErrorBoundary
        key={scopeKey}
        onCaught={(error) => {
          setDataSnapshot(null)
          setQueryFailure({ scopeKey, message: error.message })
        }}
        renderError={(_error, retry) => {
          queryRetryRef.current = { scopeKey, retry }
          return null
        }}
      >
        <NativeWorkspaceDataProvider
          enabled={enabled}
          client={client}
          scopeKey={scopeKey}
          scopeRef={scopeRef}
          mountedRef={mountedRef}
          localWorkspaceId={localWorkspaceId}
          switching={switching}
          operationError={operationError}
          invitations={invitations}
          invitationRefresh={invitationRefresh}
          setInvitations={setInvitations}
          operations={operations}
          onValue={onDataValue}
        />
      </WorkspaceQueryErrorBoundary>
      <WorkspaceContext.Provider value={contextValue}>
        {children}
      </WorkspaceContext.Provider>
    </>
  )
}

function NativeWorkspaceDataProvider({
  enabled,
  client,
  scopeKey,
  scopeRef,
  mountedRef,
  localWorkspaceId,
  switching,
  operationError,
  invitations,
  invitationRefresh,
  setInvitations,
  operations,
  onValue,
}: Omit<WorkspaceProviderProps, 'children'> & {
  scopeRef: MutableRefObject<WorkspaceRouteScope>
  scopeKey: string
  mountedRef: MutableRefObject<boolean>
  localWorkspaceId: string | null
  switching: { id: string; scopeKey: string } | null
  operationError: { message: string; scopeKey: string } | null
  invitations: AccountWorkspaceInvitation[]
  invitationRefresh: number
  setInvitations(value: AccountWorkspaceInvitation[]): void
  operations: NativeWorkspaceOperations
  onValue(value: WorkspaceContextValue): void
}) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const routeTarget = readWorkspaceRouteTarget(pathname)
  const canQuery = Boolean(enabled && !authLoading && isAuthenticated)
  const directory = usePaginatedQuery(
    api.collaboration.nativeWorkspaces.listDirectory,
    canQuery ? {} : 'skip',
    { initialNumItems: 50 },
  )
  const initialWorkspaceHint = useQuery(
    api.collaboration.nativeWorkspaces.getInitialWorkspaceHint,
    canQuery ? {} : 'skip',
  )
  const handleResolution = useQuery(
    api.collaboration.nativeWorkspaces.resolveHandle,
    canQuery && routeTarget?.kind === 'handle' ? { handle: routeTarget.value } : 'skip',
  )
  const [preferenceSnapshot, setPreferenceSnapshot] = useState<{ captured: boolean; id: string | null }>({
    captured: false,
    id: null,
  })
  const loadMore = directory.loadMore

  useEffect(() => {
    if (canQuery && directory.status === 'CanLoadMore') loadMore(50)
  }, [canQuery, directory.status, loadMore])

  useEffect(() => {
    if (!canQuery || initialWorkspaceHint === undefined || preferenceSnapshot.captured) return
    queueMicrotask(() => setPreferenceSnapshot({ captured: true, id: initialWorkspaceHint }))
  }, [canQuery, initialWorkspaceHint, preferenceSnapshot.captured])

  const workspaces = canQuery ? directory.results : EMPTY_WORKSPACES
  const directoryDone = directory.status === 'Exhausted'
  const routeWorkspaceId = routeTarget?.kind === 'id'
    ? routeTarget.value
    : routeTarget?.kind === 'handle'
      ? handleResolution?.workspaceId ?? null
      : null
  const routeWorkspace = routeWorkspaceId
    ? workspaces.find(workspace => workspace.id === routeWorkspaceId) ?? null
    : null
  const desiredUnresolved = routeTarget?.kind === 'id'
    ? !routeWorkspace && !directoryDone
    : routeTarget?.kind === 'handle'
      ? handleResolution === undefined
        || (handleResolution !== null && !routeWorkspace && !directoryDone)
      : false
  const routeError = routeTarget?.kind === 'handle' && handleResolution === null
    ? 'Workspace not found or you no longer have access.'
    : routeTarget?.kind === 'id' && directoryDone && !routeWorkspace
      ? 'Workspace not found or you no longer have access.'
      : routeTarget?.kind === 'handle' && directoryDone && handleResolution && !routeWorkspace
        ? 'Workspace not found or you no longer have access.'
        : null

  useEffect(() => {
    if (routeTarget?.kind !== 'handle' || !handleResolution || handleResolution.canonical) return
    const canonicalPath = pathname.replace(
      /^\/w\/[^/]+/,
      `/w/${encodeURIComponent(handleResolution.canonicalHandle)}`,
    )
    if (canonicalPath === pathname) return
    const locationSuffix = typeof window === 'undefined'
      ? ''
      : `${window.location.search}${window.location.hash}`
    router.replace(`${canonicalPath}${locationSuffix}`, { scroll: false })
  }, [handleResolution, pathname, routeTarget, router])

  const localWorkspace = localWorkspaceId
    ? workspaces.find(workspace => workspace.id === localWorkspaceId) ?? null
    : null
  const preferredWorkspace = preferenceSnapshot.id
    ? workspaces.find(workspace => workspace.id === preferenceSnapshot.id) ?? null
    : null
  const unresolvedInitialHint = !routeTarget
    && !localWorkspace
    && Boolean(preferenceSnapshot.id && !preferredWorkspace && !directoryDone)
  const activeWorkspace = routeTarget
    ? routeWorkspace
    : localWorkspace ?? preferredWorkspace ?? (directoryDone ? workspaces[0] ?? null : null)

  const resolvedRouteTargetKey = routeTarget && routeWorkspace
    ? workspaceRouteTargetKey(routeTarget)
    : null
  const queryLoading = directory.status === 'LoadingFirstPage'
    || (workspaces.length === 0 && !directoryDone)
  const status: WorkspaceLifecycleStatus = !enabled
    ? 'idle'
    : authLoading
      ? 'loading'
      : !isAuthenticated
        ? 'error'
        : queryLoading || !preferenceSnapshot.captured || desiredUnresolved || unresolvedInitialHint
          ? 'loading'
          : routeError
            ? 'error'
            : 'ready'
  const error = !enabled || status !== 'error'
    ? null
    : routeError ?? (!isAuthenticated ? 'Native workspace authentication is unavailable.' : null)
  const switchingWorkspaceId = switching?.scopeKey === scopeKey ? switching.id : null
  const currentOperationError = operationError?.scopeKey === scopeKey ? operationError.message : null
  const value = useMemo<WorkspaceContextValue>(() => ({
    status,
    workspaces,
    invitations,
    activeWorkspace,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    error: error ?? currentOperationError,
    switchingWorkspaceId,
    resolvedRouteTargetKey,
    ...operations,
  }), [
    activeWorkspace,
    currentOperationError,
    error,
    invitations,
    operations,
    resolvedRouteTargetKey,
    status,
    switchingWorkspaceId,
    workspaces,
  ])

  useEffect(() => {
    onValue(value)
  }, [onValue, value])

  const previousWorkspaceIdRef = useRef<string | null>(null)
  useEffect(() => {
    setActiveChatListWorkspace(activeWorkspace?.id ?? null)
    const previousWorkspaceId = previousWorkspaceIdRef.current
    if (previousWorkspaceId && activeWorkspace?.id && previousWorkspaceId !== activeWorkspace.id) {
      dispatchWorkspaceChanged({ previousWorkspaceId, workspaceId: activeWorkspace.id })
    }
    previousWorkspaceIdRef.current = activeWorkspace?.id ?? null
    return () => setActiveChatListWorkspace(null)
  }, [activeWorkspace?.id])

  useEffect(() => {
    const shouldLoadInvitations = canQuery
      && status === 'ready'
      && (pathname === '/app/workspaces' || workspaces.length === 0)
    if (!shouldLoadInvitations) return
    const controller = new AbortController()
    const currentGeneration = scopeRef.current.generation
    void client.list(controller.signal).then(result => {
      if (!controller.signal.aborted && mountedRef.current
        && currentGeneration === scopeRef.current.generation) {
        setInvitations(result.invitations ?? [])
      }
    }).catch(() => {
      if (!controller.signal.aborted && mountedRef.current
        && currentGeneration === scopeRef.current.generation) {
        setInvitations([])
      }
    })
    return () => controller.abort()
  }, [canQuery, client, invitationRefresh, mountedRef, pathname, scopeRef, setInvitations, status, workspaces.length])

  return null
}

function UnavailableNativeWorkspaceProvider({
  children,
  enabled = true,
  client,
}: WorkspaceProviderProps) {
  const pathname = usePathname() ?? ''
  const scopeRef = useWorkspaceRouteScope(pathname)
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const createWorkspace = useCallback(async (input: WorkspaceCreateInput, options?: { idempotencyKey: string }) => {
    const generation = scopeRef.current.generation
    const result = await client.create(input, options)
    if (!mountedRef.current || generation !== scopeRef.current.generation) {
      throw new Error('Workspace route changed before creation completed.')
    }
    return result.workspace
  }, [client, scopeRef])
  const switchWorkspace = useCallback(async (workspaceId: string) => {
    const generation = scopeRef.current.generation
    const result = await client.activate(workspaceId)
    if (!mountedRef.current || generation !== scopeRef.current.generation) {
      throw new Error('Workspace route changed before switching completed.')
    }
    return result.workspace
  }, [client, scopeRef])
  const value = useMemo<WorkspaceContextValue>(() => ({
    status: enabled ? 'error' : 'idle',
    workspaces: [],
    invitations: [],
    activeWorkspace: null,
    activeWorkspaceId: null,
    error: enabled ? 'Native workspace directory is unavailable.' : null,
    switchingWorkspaceId: null,
    resolvedRouteTargetKey: null,
    async refresh() {},
    createWorkspace,
    switchWorkspace,
  }), [createWorkspace, enabled, switchWorkspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
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
