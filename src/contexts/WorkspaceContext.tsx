'use client'

import {
  Component,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { NativeWorkspaceHeadcounts } from './NativeWorkspaceHeadcounts'
import { LegacyWorkspaceProvider } from './WorkspaceContextLegacy'
import {
  EMPTY_WORKSPACES,
  WorkspaceContext,
  type WorkspaceContextValue,
  type WorkspaceProviderProps,
} from './WorkspaceContext.shared'
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
  WorkspaceCreateInput,
  WorkspaceLifecycleStatus,
  WorkspaceSummary,
} from '@/shared/workspaces/types'

export type { WorkspaceContextValue } from './WorkspaceContext.shared'

type NativeWorkspaceOperations = Pick<WorkspaceContextValue, 'refresh' | 'createWorkspace' | 'switchWorkspace'>
type WorkspaceRouteScope = { pathname: string; generation: number }
type HandleResolution = { workspaceId: string; canonicalHandle: string; canonical: boolean } | null | undefined

function useWorkspaceRouteScope(pathname: string) {
  const scopeRef = useRef<WorkspaceRouteScope>({ pathname, generation: 0 })
  useEffect(() => {
    if (scopeRef.current.pathname === pathname) return
    scopeRef.current = { pathname, generation: scopeRef.current.generation + 1 }
  }, [pathname])
  return scopeRef
}

function getNativeRouteError(
  routeTarget: WorkspaceRouteTarget | null,
  handleResolution: HandleResolution,
  directoryDone: boolean,
  routeWorkspace: WorkspaceSummary | null,
) {
  if (routeTarget?.kind === 'handle' && handleResolution === null) {
    return 'Workspace not found or you no longer have access.'
  }
  if (routeTarget?.kind === 'id' && directoryDone && !routeWorkspace) {
    return 'Workspace not found or you no longer have access.'
  }
  if (routeTarget?.kind === 'handle' && directoryDone && handleResolution && !routeWorkspace) {
    return 'Workspace not found or you no longer have access.'
  }
  return null
}

function isNativeRouteUnresolved(
  routeTarget: WorkspaceRouteTarget | null,
  handleResolution: HandleResolution,
  routeWorkspace: WorkspaceSummary | null,
  directoryDone: boolean,
) {
  if (routeTarget?.kind === 'id') return !routeWorkspace && !directoryDone
  if (routeTarget?.kind === 'handle') {
    return handleResolution === undefined
      || (handleResolution !== null && !routeWorkspace && !directoryDone)
  }
  return false
}

function getNativeRouteState(
  routeTarget: WorkspaceRouteTarget | null,
  handleResolution: HandleResolution,
  workspaces: readonly WorkspaceSummary[],
  directoryDone: boolean,
) {
  const routeWorkspaceId = routeTarget?.kind === 'id'
    ? routeTarget.value
    : routeTarget?.kind === 'handle'
      ? handleResolution?.workspaceId ?? null
      : null
  const routeWorkspace = routeWorkspaceId
    ? workspaces.find(workspace => workspace.id === routeWorkspaceId) ?? null
    : null
  return {
    routeWorkspace,
    desiredUnresolved: isNativeRouteUnresolved(routeTarget, handleResolution, routeWorkspace, directoryDone),
    routeError: getNativeRouteError(routeTarget, handleResolution, directoryDone, routeWorkspace),
    resolvedRouteTargetKey: routeTarget && routeWorkspace
      ? workspaceRouteTargetKey(routeTarget)
      : null,
  }
}

function getNativeWorkspaceStatus({
  enabled,
  authLoading,
  isAuthenticated,
  workspaces,
  directoryStatus,
  directoryDone,
  preferenceCaptured,
  routeUnresolved,
  initialHintUnresolved,
  routeError,
}: {
  enabled: boolean
  authLoading: boolean
  isAuthenticated: boolean
  workspaces: readonly WorkspaceSummary[]
  directoryStatus: string
  directoryDone: boolean
  preferenceCaptured: boolean
  routeUnresolved: boolean
  initialHintUnresolved: boolean
  routeError: string | null
}) {
  const queryLoading = directoryStatus === 'LoadingFirstPage'
    || (workspaces.length === 0 && !directoryDone)
  const waitingForWorkspace = queryLoading
    || !preferenceCaptured
    || routeUnresolved
    || initialHintUnresolved
  const status: WorkspaceLifecycleStatus = !enabled
    ? 'idle'
    : authLoading
      ? 'loading'
      : !isAuthenticated
        ? 'error'
        : waitingForWorkspace
          ? 'loading'
          : routeError
            ? 'error'
            : 'ready'
  const error = !enabled || status !== 'error'
    ? null
    : routeError ?? (!isAuthenticated ? 'Native workspace authentication is unavailable.' : null)
  return { status, error }
}

class WorkspaceQueryErrorBoundary extends Component<{
  children: ReactNode
  resetKey: string
  renderError(error: Error, retry: () => void): ReactNode
}, { error: Error | null; resetKey: string }> {
  state: { error: Error | null; resetKey: string } = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { resetKey: string },
  ) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return this.props.renderError(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}

function NativeWorkspaceProvider(props: WorkspaceProviderProps & { identityKey: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const pathname = usePathname() ?? ''
  const [localWorkspaceId, setLocalWorkspaceId] = useState<string | null>(null)
  if (props.enabled === false || isLoading || !isAuthenticated) {
    return <UnavailableNativeWorkspaceProvider {...props} loading={isLoading} />
  }
  return (
    <WorkspaceQueryErrorBoundary
      resetKey={`${props.identityKey}:${pathname}`}
      renderError={(error, retry) => (
        <UnavailableNativeWorkspaceProvider {...props} queryError={error.message} retry={retry} />
      )}
    >
      <NativeWorkspaceDataProvider {...props} localWorkspaceId={localWorkspaceId} setLocalWorkspaceId={setLocalWorkspaceId} />
    </WorkspaceQueryErrorBoundary>
  )
}

function NativeWorkspaceDataProvider({
  children,
  enabled = true,
  client,
  identityKey,
  localWorkspaceId,
  setLocalWorkspaceId,
}: WorkspaceProviderProps & {
  identityKey: string
  localWorkspaceId: string | null
  setLocalWorkspaceId(id: string): void
}) {
  const pathname = usePathname() ?? ''
  const scopeKey = `${identityKey}:${pathname}`
  const scopeRef = useWorkspaceRouteScope(pathname)
  const mountedRef = useRef(false)
  const activeWorkspaceRef = useRef<WorkspaceSummary | null>(null)
  const [switching, setSwitching] = useState<{ id: string; scopeKey: string } | null>(null)
  const [operationError, setOperationError] = useState<{ message: string; scopeKey: string } | null>(null)
  const [invitations, setInvitations] = useState<AccountWorkspaceInvitation[]>([])
  const [invitationRefresh, setInvitationRefresh] = useState(0)

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
    setInvitationRefresh(current => current + 1)
  }, [])

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

  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
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
  const routeState = getNativeRouteState(routeTarget, handleResolution, workspaces, directoryDone)

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
  const initialHintUnresolved = !routeTarget
    && !localWorkspace
    && Boolean(preferenceSnapshot.id && !preferredWorkspace && !directoryDone)
  const activeWorkspace = routeTarget
    ? routeState.routeWorkspace
    : localWorkspace ?? preferredWorkspace ?? (directoryDone ? workspaces[0] ?? null : null)
  const { status, error } = getNativeWorkspaceStatus({
    enabled,
    authLoading,
    isAuthenticated,
    workspaces,
    directoryStatus: directory.status,
    directoryDone,
    preferenceCaptured: preferenceSnapshot.captured,
    routeUnresolved: routeState.desiredUnresolved,
    initialHintUnresolved,
    routeError: routeState.routeError,
  })
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
    resolvedRouteTargetKey: routeState.resolvedRouteTargetKey,
    ...operations,
  }), [
    activeWorkspace,
    currentOperationError,
    error,
    invitations,
    operations,
    routeState.resolvedRouteTargetKey,
    status,
    switchingWorkspaceId,
    workspaces,
  ])

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace
    if (activeWorkspace) setLocalWorkspaceId(activeWorkspace.id)
  }, [activeWorkspace, setLocalWorkspaceId])

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
  }, [canQuery, client, invitationRefresh, mountedRef, pathname, scopeRef, status, workspaces.length])

  return (
    <NativeWorkspaceHeadcounts workspaces={workspaces}>
      {(countedWorkspaces) => {
        const countedActive = countedWorkspaces.find(workspace => workspace.id === activeWorkspace?.id) ?? null
        return (
          <WorkspaceContext.Provider value={{
            ...value,
            workspaces: countedWorkspaces,
            activeWorkspace: countedActive,
          }}>
            {children}
          </WorkspaceContext.Provider>
        )
      }}
    </NativeWorkspaceHeadcounts>
  )
}

function UnavailableNativeWorkspaceProvider({
  children,
  enabled = true,
  client,
  loading = false,
  queryError,
  retry,
}: WorkspaceProviderProps & { loading?: boolean; queryError?: string; retry?: () => void }) {
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
    status: !enabled ? 'idle' : loading ? 'loading' : 'error',
    workspaces: [],
    invitations: [],
    activeWorkspace: null,
    activeWorkspaceId: null,
    error: enabled && !loading ? queryError ?? 'Native workspace directory is unavailable.' : null,
    switchingWorkspaceId: null,
    resolvedRouteTargetKey: null,
    async refresh() { retry?.() },
    createWorkspace,
    switchWorkspace,
  }), [createWorkspace, enabled, loading, queryError, retry, switchWorkspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
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

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return value
}

/** The workspace context where one may be absent (such as tests); null outside a provider. */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext)
}
