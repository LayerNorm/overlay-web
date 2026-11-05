'use client'

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  createPersonalChatArchiveOptimisticUpdate,
  insertPersonalChatRow,
  removePersonalChatRow,
  updatePersonalChatRow,
  updatePersonalChatUnread,
} from './personal-chat-optimistic'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import {
  isWorkspaceRouteTargetPending,
  legacyWorkspaceScopeForRoute,
  parseWorkspaceHandleRoute,
  readWorkspacePathScope,
  readWorkspaceRouteTarget,
} from '@/shared/workspaces/routing'

export type PersonalChatSummary = NonNullable<FunctionReturnType<typeof api.chat.personal.getSummary>>
type ListStatus = 'disabled' | 'loading' | 'ready' | 'unavailable'

type PersonalChatList = {
  rows: PersonalChatSummary[]
  status: ListStatus
  hasMore: boolean
  loadingMore: boolean
  loadMore(): void
}

type PersonalChatContextValue = {
  configured: boolean
  available: boolean
  workspaceId: string | null
  selectedConversationId: string | null
  selectedSummary: PersonalChatSummary | null | undefined
  active: PersonalChatList
  archived: PersonalChatList
  rename(conversationId: string, title: string): Promise<void>
  setArchived(summary: PersonalChatSummary, archived: boolean): Promise<void>
  setRead(summary: PersonalChatSummary, unread: boolean, throughMessageId?: Id<'conversationMessages'>): Promise<void>
}

const emptyList: PersonalChatList = {
  rows: [],
  status: 'disabled',
  hasMore: false,
  loadingMore: false,
  loadMore() {},
}

const PersonalChatContext = createContext<PersonalChatContextValue>({
  configured: false,
  available: false,
  workspaceId: null,
  selectedConversationId: null,
  selectedSummary: undefined,
  active: emptyList,
  archived: emptyList,
  async rename() {},
  async setArchived() {},
  async setRead() {},
})

export function PersonalChatProvider({ children }: { children: ReactNode }) {
  const authConfiguration = useConvexAuthConfiguration()
  const workspace = useWorkspace()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceId = workspace.activeWorkspaceId
  const nativeConfigured = authConfiguration.nativeAuthConfigured
  const available = nativeConfigured && authConfiguration.hasConvexClient

  if (!available) {
    const status: ListStatus = nativeConfigured ? 'unavailable' : 'disabled'
    const value: PersonalChatContextValue = {
      configured: nativeConfigured,
      available: false,
      workspaceId,
      selectedConversationId: null,
      selectedSummary: undefined,
      active: { ...emptyList, status },
      archived: { ...emptyList, status },
      async rename() { throw new Error('Native personal chat is unavailable') },
      async setArchived() { throw new Error('Native personal chat is unavailable') },
      async setRead() { throw new Error('Native personal chat is unavailable') },
    }
    return <PersonalChatContext.Provider value={value}>{children}</PersonalChatContext.Provider>
  }

  return (
    <PersonalChatErrorBoundary
      resetKey={`${workspaceId ?? 'no-workspace'}:${pathname ?? ''}:${searchParams.toString()}`}
      fallbackChildren={children}
      fallbackValue={{
        configured: true,
        available: false,
        workspaceId,
        selectedConversationId: null,
        selectedSummary: undefined,
        active: { ...emptyList, status: 'unavailable' },
        archived: { ...emptyList, status: 'unavailable' },
        async rename() { throw new Error('Native personal chat is unavailable') },
        async setArchived() { throw new Error('Native personal chat is unavailable') },
        async setRead() { throw new Error('Native personal chat is unavailable') },
      }}
    >
      <NativePersonalChatProvider
        configured
        workspaceId={workspaceId}
        workspaceReady={workspace.status === 'ready' && !isWorkspaceRouteTargetPending(
          readWorkspaceRouteTarget(pathname ?? ''), workspace.resolvedRouteTargetKey,
        )}
      >
        {children}
      </NativePersonalChatProvider>
    </PersonalChatErrorBoundary>
  )
}

type PersonalChatErrorBoundaryProps = {
  children: ReactNode
  fallbackChildren: ReactNode
  fallbackValue: PersonalChatContextValue
  resetKey: string
}

class PersonalChatErrorBoundary extends Component<
  PersonalChatErrorBoundaryProps,
  { failed: boolean; resetKey: string }
> {
  constructor(props: PersonalChatErrorBoundaryProps) {
    super(props)
    this.state = { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromProps(
    props: PersonalChatErrorBoundaryProps,
    state: { failed: boolean; resetKey: string },
  ) {
    return props.resetKey !== state.resetKey
      ? { failed: false, resetKey: props.resetKey }
      : null
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <PersonalChatContext.Provider value={this.props.fallbackValue}>
        {this.props.fallbackChildren}
      </PersonalChatContext.Provider>
    )
  }
}

function isChatConsumerPath(pathname: string | null): boolean {
  if (!pathname) return false
  const handleRoute = parseWorkspaceHandleRoute(pathname)
  if (handleRoute) return handleRoute.surface === 'chat'
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'app') return false
  if (segments[1] === 'w') {
    if (segments[3] === 'chat') return true
    return (segments[3] === 'personal' || segments[3] === 'workspace')
      && segments[4] === 'chat'
  }
  if (segments[1] === 'personal' || segments[1] === 'workspace') {
    return segments[2] === 'chat'
  }
  return segments[1] === 'chat'
}

function personalChatQueryDemand(pathname: string | null, routeParams: URLSearchParams) {
  const isChatSurface = isChatConsumerPath(pathname)
  const routeScope = readWorkspacePathScope(pathname ?? '')
    ?? legacyWorkspaceScopeForRoute('chat', routeParams)
  const view = routeParams.get('view')
  const isNativePersonalChatSurface = isChatSurface
    && routeScope !== 'workspace'
    && !['workspace-chats', 'dms', 'channels'].includes(view ?? '')
  const handleRoute = pathname ? parseWorkspaceHandleRoute(pathname) : null
  const isArchivedRoute = handleRoute?.surface === 'archived'
    || pathname === '/app/archived'
    || pathname?.startsWith('/app/archived/') === true
    || (pathname?.startsWith('/app/w/') === true && pathname.endsWith('/archived'))
  const isArchivedSettings = pathname?.endsWith('/settings') === true && routeParams.get('section') === 'archived'
  const needsActiveList = isNativePersonalChatSurface
  const needsArchivedList = isArchivedRoute || isArchivedSettings
  const canReadSelectedSummary = isNativePersonalChatSurface || isArchivedRoute
  const routeId = canReadSelectedSummary ? routeParams.get('id') : null
  return { needsActiveList, needsArchivedList, canReadSelectedSummary, routeId }
}

function NativePersonalChatProvider({
  children,
  configured,
  workspaceId,
  workspaceReady,
}: {
  children: ReactNode
  configured: boolean
  workspaceId: string | null
  workspaceReady: boolean
}) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const { needsActiveList, needsArchivedList, canReadSelectedSummary, routeId } = personalChatQueryDemand(pathname, routeParams)
  const [routeConversationId, setRouteConversationId] = useState<string | null>(null)
  const selectedConversationId = routeConversationId
  const canQuery = Boolean(workspaceReady && workspaceId && !authLoading && isAuthenticated)
  const canQueryActive = canQuery && needsActiveList
  const canQueryArchived = canQuery && needsArchivedList
  const canQuerySummary = canQuery && canReadSelectedSummary
  const activeQuery = usePaginatedQuery(
    api.chat.personal.list,
    canQueryActive ? { workspaceId: workspaceId!, archived: false } : 'skip',
    { initialNumItems: 30 },
  )
  const archivedQuery = usePaginatedQuery(
    api.chat.personal.list,
    canQueryArchived ? { workspaceId: workspaceId!, archived: true } : 'skip',
    { initialNumItems: 30 },
  )
  const selectedSummary = useQuery(
    api.chat.personal.getSummary,
    canQuerySummary && selectedConversationId
      ? { workspaceId: workspaceId!, conversationId: selectedConversationId as Id<'conversations'> }
      : 'skip',
  )

  useEffect(() => {
    setRouteConversationId(routeId)
  }, [routeId])

  useEffect(() => {
    function syncRoute() {
      setRouteConversationId(canReadSelectedSummary
        ? new URLSearchParams(window.location.search).get('id')
        : null)
    }
    window.addEventListener('overlay:chat-route-selected', syncRoute)
    window.addEventListener('popstate', syncRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', syncRoute)
      window.removeEventListener('popstate', syncRoute)
    }
  }, [canReadSelectedSummary])

  const renameMutation = useMutation(api.chat.personal.rename).withOptimisticUpdate((store, args) => {
    const update = (row: PersonalChatSummary) => ({
      ...row,
      title: args.title,
      lastModified: Date.now(),
    })
    for (const archived of [false, true]) {
      updatePersonalChatList(store, args.workspaceId, archived, args.conversationId, update)
    }
    const queryArgs = { workspaceId: args.workspaceId, conversationId: args.conversationId }
    const summary = store.getQuery(api.chat.personal.getSummary, queryArgs)
    if (summary) store.setQuery(api.chat.personal.getSummary, queryArgs, update(summary))
  })

  const archiveMutation = useMutation(api.chat.personal.setArchived)

  const readMutation = useMutation(api.chat.personal.setRead).withOptimisticUpdate((store, args) => {
    const update = (row: PersonalChatSummary) => updatePersonalChatUnread(
      row,
      args.unread,
      args.throughMessageId ? String(args.throughMessageId) : undefined,
    )
    for (const archived of [false, true]) {
      updatePersonalChatList(store, args.workspaceId, archived, args.conversationId, update)
    }
    const queryArgs = { workspaceId: args.workspaceId, conversationId: args.conversationId }
    const summary = store.getQuery(api.chat.personal.getSummary, queryArgs)
    if (summary) store.setQuery(api.chat.personal.getSummary, queryArgs, update(summary))
  })

  const rename = useCallback(async (conversationId: string, title: string) => {
    if (!workspaceId) throw new Error('Native personal chat is unavailable')
    await renameMutation({
      workspaceId,
      conversationId: conversationId as Id<'conversations'>,
      title,
    })
  }, [renameMutation, workspaceId])

  const setArchived = useCallback(async (summary: PersonalChatSummary, archived: boolean) => {
    const fallbackSummary = minimalSummary(summary)
    const mutateWithOptimism = archiveMutation.withOptimisticUpdate((store, args) => {
      const applyArchiveUpdate = createPersonalChatArchiveOptimisticUpdate(fallbackSummary, {
        getCurrent: (mutationArgs) => (
          store.getQuery(api.chat.personal.getSummary, {
            workspaceId: mutationArgs.workspaceId,
            conversationId: mutationArgs.conversationId as Id<'conversations'>,
          })
          ?? findPersonalChatSummary(store, mutationArgs.workspaceId, mutationArgs.conversationId)
        ),
        move: (mutationArgs, next) => movePersonalChatRow(
          store,
          mutationArgs.workspaceId,
          mutationArgs.conversationId,
          mutationArgs.archived,
          next,
        ),
        updateSelected: (mutationArgs, archivedAt) => {
          const queryArgs = {
            workspaceId: mutationArgs.workspaceId,
            conversationId: mutationArgs.conversationId as Id<'conversations'>,
          }
          const selected = store.getQuery(api.chat.personal.getSummary, queryArgs)
          if (selected) {
            store.setQuery(api.chat.personal.getSummary, queryArgs, { ...selected, archivedAt })
          }
        },
      })
      applyArchiveUpdate(args)
    })
    await mutateWithOptimism({
      workspaceId: summary.workspaceId,
      conversationId: summary._id,
      archived,
    })
  }, [archiveMutation])

  const setRead = useCallback(async (
    summary: PersonalChatSummary,
    unread: boolean,
    throughMessageId?: Id<'conversationMessages'>,
  ) => {
    await readMutation({
      workspaceId: summary.workspaceId,
      conversationId: summary._id,
      unread,
      ...(throughMessageId ? { throughMessageId } : {}),
    })
  }, [readMutation])

  const baseListStatus: ListStatus = !configured
    ? 'disabled'
    : !workspaceReady || authLoading
      ? 'loading'
      : !workspaceId
        ? 'unavailable'
      : isAuthenticated
        ? 'ready'
        : 'unavailable'
  const activeStatus = !needsActiveList
    ? 'disabled'
    : baseListStatus !== 'ready'
      ? baseListStatus
      : activeQuery.status === 'LoadingFirstPage'
      ? 'loading'
      : baseListStatus
  const archivedStatus = !needsArchivedList
    ? 'disabled'
    : baseListStatus !== 'ready'
      ? baseListStatus
      : archivedQuery.status === 'LoadingFirstPage'
      ? 'loading'
      : baseListStatus
  const visibleActiveRows = useMemo(
    () => canQueryActive ? activeQuery.results : [],
    [activeQuery.results, canQueryActive],
  )
  const visibleArchivedRows = useMemo(
    () => canQueryArchived ? archivedQuery.results : [],
    [archivedQuery.results, canQueryArchived],
  )
  const visibleSelectedSummary = canQuerySummary ? selectedSummary : undefined
  const value = useMemo<PersonalChatContextValue>(() => ({
    configured,
    available: true,
    workspaceId,
    selectedConversationId,
    selectedSummary: visibleSelectedSummary,
    active: {
      rows: visibleActiveRows,
      status: activeStatus,
      hasMore: canQueryActive && (activeQuery.status === 'CanLoadMore' || activeQuery.status === 'LoadingMore'),
      loadingMore: canQueryActive && activeQuery.status === 'LoadingMore',
      loadMore: () => { if (canQueryActive) activeQuery.loadMore(30) },
    },
    archived: {
      rows: visibleArchivedRows,
      status: archivedStatus,
      hasMore: canQueryArchived && (archivedQuery.status === 'CanLoadMore' || archivedQuery.status === 'LoadingMore'),
      loadingMore: canQueryArchived && archivedQuery.status === 'LoadingMore',
      loadMore: () => { if (canQueryArchived) archivedQuery.loadMore(30) },
    },
    rename,
    setArchived,
    setRead,
  }), [
    activeQuery,
    archivedQuery,
    canQueryActive,
    canQueryArchived,
    configured,
    activeStatus,
    archivedStatus,
    rename,
    selectedConversationId,
    setArchived,
    setRead,
    visibleActiveRows,
    visibleArchivedRows,
    visibleSelectedSummary,
    workspaceId,
  ])

  return <PersonalChatContext.Provider value={value}>{children}</PersonalChatContext.Provider>
}

function updatePersonalChatList(
  store: OptimisticLocalStore,
  workspaceId: string,
  archived: boolean,
  conversationId: string,
  update: (row: PersonalChatSummary) => PersonalChatSummary,
) {
  for (const query of store.getAllQueries(api.chat.personal.list)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId || query.args.archived !== archived) continue
    store.setQuery(api.chat.personal.list, query.args, {
      ...query.value,
      page: updatePersonalChatRow(query.value.page, conversationId, update),
    })
  }
}

function findPersonalChatSummary(
  store: OptimisticLocalStore,
  workspaceId: string,
  conversationId: string,
): PersonalChatSummary | undefined {
  for (const query of store.getAllQueries(api.chat.personal.list)) {
    if (query.args.workspaceId !== workspaceId || query.value === undefined) continue
    const summary = query.value.page.find((row) => row._id === conversationId)
    if (summary) return summary
  }
  return undefined
}

function minimalSummary(summary: PersonalChatSummary): PersonalChatSummary {
  return {
    _id: summary._id,
    workspaceId: summary.workspaceId,
    createdAt: summary.createdAt,
    scope: summary.scope,
    conversationType: summary.conversationType,
    title: summary.title,
    lastModified: summary.lastModified,
    archivedAt: summary.archivedAt,
    lastMessageId: summary.lastMessageId,
    lastMessageAt: summary.lastMessageAt,
    unread: summary.unread,
    lastReadAt: summary.lastReadAt,
    markedUnreadAt: summary.markedUnreadAt,
  }
}

function movePersonalChatRow(
  store: OptimisticLocalStore,
  workspaceId: string,
  conversationId: string,
  archived: boolean,
  summary: PersonalChatSummary | null,
) {
  for (const query of store.getAllQueries(api.chat.personal.list)) {
    if (query.value === undefined || query.args.workspaceId !== workspaceId) continue
    const isTargetList = query.args.archived === archived
    const pageHasRow = query.value.page.some((row) => row._id === conversationId)
    if (isTargetList && summary && query.args.paginationOpts.cursor === null) {
      store.setQuery(api.chat.personal.list, query.args, {
        ...query.value,
        page: insertPersonalChatRow(query.value.page, summary),
      })
    } else if (!isTargetList || pageHasRow) {
      store.setQuery(api.chat.personal.list, query.args, {
        ...query.value,
        page: removePersonalChatRow(query.value.page, conversationId),
      })
    }
  }
}

export function usePersonalChat() {
  return useContext(PersonalChatContext)
}
