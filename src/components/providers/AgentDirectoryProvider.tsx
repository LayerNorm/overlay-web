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
} from 'react'
import { useConvex, useMutation, usePaginatedQuery, useQuery, useConvexAuth } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../../convex/_generated/api'
import { Button } from '@overlay/ui/primitives'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentUpdateInput,
} from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'

export type NativeAgent = Omit<WorkspaceAgentDirectoryItem, 'canEdit'> & {
  canEdit: boolean
  revision: string
}
type NativeList = NativeAgent[]
type NativeAgentPage = { page: NativeList; continueCursor: string; isDone: boolean }
type NativeHarness = Extract<WorkspaceAgentUpdateInput['harness'], 'overlay' | 'claude-code' | 'codex'>
type NativeUpdatePatch = Omit<WorkspaceAgentUpdateInput, 'isDefault' | 'harness'> & { harness?: NativeHarness }
type AgentMutationPatch = Omit<WorkspaceAgentUpdateInput, 'isDefault'>

type AgentDirectoryMode = 'legacy' | 'native' | 'unavailable'

type AgentDirectoryValue = {
  configured: boolean
  mode: AgentDirectoryMode
  workspaceId: string | null
  directory: NativeList | null
  viewerPrincipalId: string | null
  canCreate: boolean
  canBootstrapChiefs: boolean
  loading: boolean
  error: string | null
  detail: NativeAgent | null | undefined
  pendingAgentIds: ReadonlySet<string>
  pendingArchiveIds: ReadonlySet<string>
  setDetailAgentId(agentId: string | null): void
  create(input: WorkspaceAgentCreateInput, requestId: string): Promise<NativeAgent>
  update(agentId: string, patch: AgentMutationPatch, expectedRevision: string): Promise<NativeAgent>
  restore(agentId: string, expectedRevision?: string): Promise<NativeAgent>
  archive(agentId: string): Promise<void>
  retry(): void
}

const noOp = () => {}
const unavailableAction = async (): Promise<never> => {
  throw new Error('Native agent directory is unavailable')
}

function isNativeHarness(value: WorkspaceAgentUpdateInput['harness']): value is NativeHarness {
  return value === 'overlay' || value === 'claude-code' || value === 'codex'
}

const defaultValue: AgentDirectoryValue = {
  configured: false,
  mode: 'legacy',
  workspaceId: null,
  directory: null,
  viewerPrincipalId: null,
  canCreate: false,
  canBootstrapChiefs: false,
  loading: false,
  error: null,
  detail: undefined,
  pendingAgentIds: new Set(),
  pendingArchiveIds: new Set(),
  setDetailAgentId: noOp,
  create: unavailableAction,
  update: unavailableAction,
  restore: unavailableAction,
  archive: unavailableAction,
  retry: noOp,
}

const AgentDirectoryContext = createContext(defaultValue)

export function AgentDirectoryProvider({ children }: { children: ReactNode }) {
  const parent = useContext(AgentDirectoryContext)
  if (parent.mode !== 'legacy' || parent.workspaceId !== null) return <>{children}</>
  return <AgentDirectoryProviderRoot>{children}</AgentDirectoryProviderRoot>
}

function AgentDirectoryProviderRoot({ children }: { children: ReactNode }) {
  const authConfiguration = useConvexAuthConfiguration()
  const { user, isLoading: authLoading } = useAuth()
  const workspace = useWorkspace()
  const workspaceId = workspace.switchingWorkspaceId ? null : workspace.activeWorkspaceId
  const workspaceReady = workspace.status === 'ready' && !workspace.switchingWorkspaceId
  const nativeConfigured = authConfiguration.nativeAuthConfigured
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null)
  const [pendingAgentIds, setPendingAgentIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingArchiveIds, setPendingArchiveIds] = useState<ReadonlySet<string>>(new Set())
  const [retryVersion, setRetryVersion] = useState(0)
  const retry = useCallback(() => setRetryVersion((value) => value + 1), [])
  const baseValue = useMemo<AgentDirectoryValue>(() => ({
    ...defaultValue,
    configured: nativeConfigured,
    mode: nativeConfigured ? 'unavailable' : 'legacy',
    workspaceId,
    loading: nativeConfigured && (
      authLoading || Boolean(user?.id && authConfiguration.hasConvexClient && !workspaceReady)
    ),
    error: nativeConfigured
      ? !authConfiguration.hasConvexClient
        ? 'Native agent directory is unavailable.'
        : !authLoading && !user?.id
          ? 'Sign in to load your agents.'
          : null
      : null,
    pendingAgentIds,
    pendingArchiveIds,
    setDetailAgentId,
    retry,
  }), [
    authLoading, authConfiguration.hasConvexClient, nativeConfigured, pendingAgentIds, pendingArchiveIds,
    retry, user?.id, workspaceId, workspaceReady,
  ])

  if (!nativeConfigured) {
    return <AgentDirectoryContext.Provider value={baseValue}>{children}</AgentDirectoryContext.Provider>
  }
  if (!authConfiguration.hasConvexClient) {
    return <AgentDirectoryContext.Provider value={baseValue}>{children}</AgentDirectoryContext.Provider>
  }

  const identityScope = `${user?.id ?? 'anonymous'}:${workspaceId ?? 'none'}`
  return (
    <AgentDirectoryErrorBoundary
      key={`${identityScope}:${retryVersion}`}
      fallback={(
        <AgentDirectoryErrorFallback onRetry={retry} />
      )}
    >
      <NativeAgentDirectoryScope
        key={identityScope}
        workspaceId={workspaceId}
        workspaceReady={workspaceReady}
        identityReady={!authLoading && Boolean(user?.id)}
        identityPending={authLoading}
        detailAgentId={detailAgentId}
        setDetailAgentId={setDetailAgentId}
        pendingAgentIds={pendingAgentIds}
        setPendingAgentIds={setPendingAgentIds}
        pendingArchiveIds={pendingArchiveIds}
        setPendingArchiveIds={setPendingArchiveIds}
        retry={retry}
      >
        {children}
      </NativeAgentDirectoryScope>
    </AgentDirectoryErrorBoundary>
  )
}

class AgentDirectoryErrorBoundary extends Component<{
  children: ReactNode
  fallback: ReactNode
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function waitForArchivedRevision(convex: ReturnType<typeof useConvex>, workspaceId: string, agentId: string, signal: AbortSignal): Promise<string> {
  const watch = convex.watchQuery(api.agents.nativeDirectory.get, { workspaceId, agentId, includeArchived: true })
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const finish = (revision?: string, error?: unknown) => {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (revision) resolve(revision)
      else reject(error)
    }
    const abort = () => finish(undefined, new Error('Native agent directory is unavailable'))
    const timer = setTimeout(() => finish(undefined, new Error('Agent archive is still syncing. Retry Undo.')), 10_000)
    const read = () => {
      try {
        const agent = watch.localQueryResult()
        if (agent === null || (agent && (agent.id !== agentId || agent.workspaceId !== workspaceId))) {
          finish(undefined, new Error('The archived agent is no longer available'))
        } else if (agent?.archivedAt !== undefined) {
          finish(agent.revision)
        }
      } catch (error) { finish(undefined, error) }
    }
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    unsubscribe = watch.onUpdate(read)
    read()
  })
}

function AgentDirectoryErrorFallback({ onRetry }: { onRetry(): void }) {
  return (
    <div role="alert" className="space-y-2 p-3 text-sm text-(--muted)">
      <p>Could not load your agents. Check your connection and retry.</p>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}

function NativeAgentDirectoryScope({
  children,
  workspaceId,
  workspaceReady,
  identityReady,
  identityPending,
  detailAgentId,
  setDetailAgentId,
  pendingAgentIds,
  setPendingAgentIds,
  pendingArchiveIds,
  setPendingArchiveIds,
  retry,
}: {
  children: ReactNode
  workspaceId: string | null
  workspaceReady: boolean
  identityReady: boolean
  identityPending: boolean
  detailAgentId: string | null
  setDetailAgentId(agentId: string | null): void
  pendingAgentIds: ReadonlySet<string>
  setPendingAgentIds: (next: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) => void
  pendingArchiveIds: ReadonlySet<string>
  setPendingArchiveIds: (next: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) => void
  retry(): void
}) {
  const convex = useConvex()
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const canQuery = Boolean(workspaceId && workspaceReady && identityReady && !authLoading && isAuthenticated)
  const restoreScope = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    restoreScope.current = controller
    return () => controller.abort()
  }, [canQuery])
  const settledAuthFailure = !identityPending && (!identityReady || (!authLoading && !isAuthenticated))
  const listQuery = usePaginatedQuery(
    api.agents.nativeDirectory.list,
    canQuery ? { workspaceId: workspaceId! } : 'skip',
    { initialNumItems: 100 },
  )
  const { status: listStatus, loadMore } = listQuery
  const contextQuery = useQuery(
    api.agents.nativeDirectory.context,
    canQuery ? { workspaceId: workspaceId! } : 'skip',
  )
  const detailQuery = useQuery(
    api.agents.nativeDirectory.get,
    canQuery && workspaceId && detailAgentId
      ? { workspaceId, agentId: detailAgentId, includeArchived: true }
      : 'skip',
  )
  const createMutation = useMutation(api.agents.nativeDirectory.create).withOptimisticUpdate((store, args) => {
    const now = Date.now()
    const agentId = `native-agent:${args.workspaceId}:${contextQuery?.viewerPrincipalId ?? ''}:${args.requestId}`
    const provisional: NativeAgent = {
      id: agentId,
      workspaceId: args.workspaceId,
      principalId: `${agentId}:principal`,
      name: args.name,
      ...(args.description === undefined ? {} : { description: args.description }),
      instructions: args.instructions,
      harness: args.harness ?? 'overlay',
      modelId: args.modelId,
      ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
      ...(args.permissionMode === undefined ? {} : { permissionMode: args.permissionMode }),
      ...(args.effort === undefined ? {} : { effort: args.effort }),
      ...(args.avatarColor === undefined ? {} : { avatarColor: args.avatarColor }),
      ...(args.avatarShape === undefined ? {} : { avatarShape: args.avatarShape }),
      allowedToolIds: args.allowedToolIds ?? [],
      invocationPolicy: 'mention',
      visibility: args.visibility ?? 'workspace',
      createdByPrincipalId: contextQuery?.viewerPrincipalId ?? '',
      createdAt: now,
      updatedAt: now,
      teamIds: args.teamIds ?? [],
      roomCount: 0,
      canEdit: true,
      revision: 'pending',
    }
    updateDirectoryLists(store, args.workspaceId, (query, value) => {
      if (query.args.includeArchived || query.args.paginationOpts.cursor !== null) return value
      if (value.page.some((row) => row.id === agentId)) return value
      return { ...value, page: [provisional, ...value.page] }
    })
  })
  const updateMutation = useMutation(api.agents.nativeDirectory.update).withOptimisticUpdate((store, args) => {
    updateAgentCaches(store, args.workspaceId, args.agentId, (agent) => {
      if (agent.agentRole === 'personal_chief') return agent
      return { ...agent, ...args.patch, revision: agent.revision }
    })
  })
  const restoreMutation = useMutation(api.agents.nativeDirectory.restore).withOptimisticUpdate((store, args) => {
    restoreAgentCaches(store, args.workspaceId, args.agentId)
  })
  const bootstrapChiefsMutation = useMutation(api.agents.nativeDirectory.bootstrapChiefs)
  const bootstrapAttempt = useRef<string | null>(null)

  useEffect(() => {
    if (listStatus === 'CanLoadMore') loadMore(100)
  }, [listStatus, loadMore])

  useEffect(() => {
    if (
      !canQuery
      || !contextQuery?.canBootstrapChiefs
      || listStatus !== 'Exhausted'
      || (listQuery.results.some((agent) => agent.agentRole === 'workspace_chief')
        && listQuery.results.some((agent) => agent.agentRole === 'personal_chief'))
    ) return
    const key = `${workspaceId}:${contextQuery.viewerPrincipalId}`
    if (bootstrapAttempt.current === key) return
    bootstrapAttempt.current = key
    void bootstrapChiefsMutation({ workspaceId: workspaceId! }).catch(() => {
      if (bootstrapAttempt.current === key) bootstrapAttempt.current = null
    })
  }, [
    bootstrapChiefsMutation,
    canQuery,
    contextQuery,
    listQuery.results,
    listStatus,
    workspaceId,
  ])

  const create = useCallback(async (input: WorkspaceAgentCreateInput, requestId: string) => {
    if (!workspaceId || !canQuery) throw new Error('Native agent directory is unavailable')
    if (!requestId) throw new Error('A stable create request ID is required')
    let harness: NativeHarness | undefined
    if (input.harness !== undefined) {
      if (!isNativeHarness(input.harness)) throw new Error('WORKSPACE_AGENT_HARNESS_DENIED')
      harness = input.harness
    }
    const pendingId = `native-agent:${workspaceId}:${contextQuery?.viewerPrincipalId ?? ''}:${requestId}`
    setPendingAgentIds((current) => new Set(current).add(pendingId))
    try {
      return await createMutation({
        workspaceId,
        requestId,
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        harness,
        modelId: input.modelId,
        reasoning: input.reasoning,
        permissionMode: input.permissionMode,
        effort: input.effort,
        avatarColor: input.avatarColor,
        avatarShape: input.avatarShape,
        allowedToolIds: input.allowedToolIds,
        teamIds: input.teamIds,
        visibility: input.visibility,
      })
    } finally {
      setPendingAgentIds((current) => {
        const next = new Set(current)
        next.delete(pendingId)
        return next
      })
    }
  }, [canQuery, contextQuery?.viewerPrincipalId, createMutation, setPendingAgentIds, workspaceId])

  const update = useCallback(async (
    agentId: string,
    patch: AgentMutationPatch,
    expectedRevision: string,
  ) => {
    if (!workspaceId || !canQuery) throw new Error('Native agent directory is unavailable')
    setPendingAgentIds((current) => new Set(current).add(agentId))
    try {
      const { harness, ...profilePatch } = patch
      if (harness !== undefined && !isNativeHarness(harness)) {
        throw new Error('WORKSPACE_AGENT_HARNESS_DENIED')
      }
      const nativePatch: NativeUpdatePatch = {
        ...profilePatch,
        ...(harness === undefined ? {} : { harness }),
      }
      return await updateMutation({ workspaceId, agentId, patch: nativePatch, expectedRevision })
    } finally {
      setPendingAgentIds((current) => {
        const next = new Set(current)
        next.delete(agentId)
        return next
      })
    }
  }, [canQuery, setPendingAgentIds, updateMutation, workspaceId])

  const restore = useCallback(async (agentId: string, expectedRevision?: string) => {
    const signal = restoreScope.current?.signal
    if (!workspaceId || !canQuery || !signal || signal.aborted) throw new Error('Native agent directory is unavailable')
    setPendingAgentIds((current) => new Set(current).add(agentId))
    try {
      // HTTP archive completion can precede the native subscription's archived revision.
      const revision = expectedRevision ?? await waitForArchivedRevision(convex, workspaceId, agentId, signal)
      if (signal.aborted) throw new Error('Native agent directory is unavailable')
      if (!revision) throw new Error('The archived agent is no longer available')
      return await restoreMutation({ workspaceId, agentId, expectedRevision: revision })
    } finally {
      setPendingAgentIds((current) => {
        const next = new Set(current)
        next.delete(agentId)
        return next
      })
    }
  }, [canQuery, convex, restoreMutation, setPendingAgentIds, workspaceId])

  const archive = useCallback(async (agentId: string) => {
    if (!workspaceId || !canQuery) throw new Error('Native agent directory is unavailable')
    setPendingArchiveIds((current) => new Set(current).add(agentId))
    try {
      await overlayAppClient.agents.archive(workspaceId, agentId)
    } catch (error) {
      setPendingArchiveIds((current) => {
        const next = new Set(current)
        next.delete(agentId)
        return next
      })
      throw error
    }
    setPendingArchiveIds((current) => {
      const next = new Set(current)
      next.delete(agentId)
      return next
    })
  }, [canQuery, setPendingArchiveIds, workspaceId])

  const value = useMemo<AgentDirectoryValue>(() => {
    const loaded = canQuery && listStatus === 'Exhausted'
    const detail = detailAgentId === null || detailQuery === undefined
      ? undefined
      : detailQuery === null
        ? null
        : detailQuery.id === detailAgentId ? detailQuery : null
    return {
      configured: true,
      mode: canQuery && contextQuery ? 'native' : 'unavailable',
      workspaceId,
      directory: loaded ? listQuery.results : null,
      viewerPrincipalId: contextQuery?.viewerPrincipalId ?? null,
      canCreate: contextQuery?.canCreate ?? false,
      canBootstrapChiefs: contextQuery?.canBootstrapChiefs ?? false,
      loading: !settledAuthFailure && (
        !workspaceReady || identityPending || authLoading || (canQuery && (!contextQuery || listStatus !== 'Exhausted'))
      ),
      error: settledAuthFailure ? 'Sign in to load your agents.' : null,
      detail,
      pendingAgentIds,
      pendingArchiveIds,
      setDetailAgentId,
      create,
      update,
      restore,
      archive,
      retry,
    }
  }, [
    archive, canQuery, contextQuery, create, detailAgentId, detailQuery, listQuery.results, listStatus,
    authLoading, identityPending, pendingAgentIds, pendingArchiveIds, restore, retry, settledAuthFailure,
    setDetailAgentId, update, workspaceId, workspaceReady,
  ])

  return <AgentDirectoryContext.Provider value={value}>{children}</AgentDirectoryContext.Provider>
}

function updateDirectoryLists(
  store: OptimisticLocalStore,
  workspaceId: string,
  update: (query: { args: { includeArchived?: boolean; paginationOpts: { cursor: string | null } } }, value: NativeAgentPage) => NativeAgentPage,
) {
  for (const query of store.getAllQueries(api.agents.nativeDirectory.list)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId) continue
    store.setQuery(api.agents.nativeDirectory.list, query.args, update(query, query.value))
  }
}

function updateAgentCaches(
  store: OptimisticLocalStore,
  workspaceId: string,
  agentId: string,
  update: (agent: NativeAgent) => NativeAgent,
) {
  updateDirectoryLists(store, workspaceId, (query, value) => ({
    ...value,
    page: query.args.includeArchived
      ? value.page
      : value.page.map((agent) => agent.id === agentId ? update(agent) : agent),
  }))
  for (const query of store.getAllQueries(api.agents.nativeDirectory.get)) {
    if (query.value == null || query.args.workspaceId !== workspaceId || query.args.agentId !== agentId) continue
    store.setQuery(api.agents.nativeDirectory.get, query.args, update(query.value))
  }
}

function restoreAgentCaches(store: OptimisticLocalStore, workspaceId: string, agentId: string) {
  let restoredAgent: NativeAgent | null = null
  for (const query of store.getAllQueries(api.agents.nativeDirectory.list)) {
    if (query.args.workspaceId !== workspaceId || !query.args.includeArchived || query.value === undefined) continue
    restoredAgent = query.value.page.find((agent) => agent.id === agentId) ?? restoredAgent
  }
  for (const query of store.getAllQueries(api.agents.nativeDirectory.get)) {
    if (query.args.workspaceId !== workspaceId || query.args.agentId !== agentId || !query.value) continue
    restoredAgent = query.value
  }
  if (!restoredAgent) return
  const restored = { ...restoredAgent }
  delete restored.archivedAt
  updateDirectoryLists(store, workspaceId, (query, value) => {
    if (query.args.includeArchived) {
      return { ...value, page: value.page.filter((agent) => agent.id !== agentId) }
    }
    if (query.args.paginationOpts.cursor !== null) return value
    return {
      ...value,
      page: [restored, ...value.page.filter((agent) => agent.id !== agentId)],
    }
  })
  for (const query of store.getAllQueries(api.agents.nativeDirectory.get)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId || query.args.agentId !== agentId) continue
    store.setQuery(api.agents.nativeDirectory.get, query.args, restored)
  }
}

export function useAgentDirectory() {
  const context = useContext(AgentDirectoryContext)
  const configuration = useConvexAuthConfiguration()
  if (context.mode === 'legacy' && configuration.nativeAuthConfigured) {
    return {
      ...context,
      configured: true,
      mode: 'unavailable' as const,
      loading: false,
      error: 'Native agent directory is unavailable.',
    }
  }
  return context
}
