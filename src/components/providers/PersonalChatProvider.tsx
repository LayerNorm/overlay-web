'use client'

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useConvexAuth, useMutation, usePaginatedQuery } from 'convex/react'
import { usePersonalChatTranscript } from './usePersonalChatTranscript'
import { updatePersonalChatList, findPersonalChatSummary, minimalSummary, movePersonalChatRow, personalChatListStatus } from './personal-chat-store'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  createPersonalChatArchiveOptimisticUpdate,
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
export type NativePersonalCreateArgs = FunctionArgs<typeof api.chat.personal.create>
export type NativePersonalSubmitArgs = FunctionArgs<typeof api.chat.personal.submit>
export type NativePersonalPreferencesArgs = FunctionArgs<typeof api.chat.personal.setPreferences>
type ListStatus = 'disabled' | 'loading' | 'ready' | 'unavailable'
type PersonalTranscriptRow = FunctionReturnType<typeof api.chat.personal.getMessages>['page'][number]

type PersonalChatList = {
  rows: PersonalChatSummary[]
  status: ListStatus
  hasMore: boolean
  loadingMore: boolean
  loadMore(): void
}

type PersonalChatTranscript = {
  conversationId: string | null
  rows: PersonalTranscriptRow[]
  status: ListStatus
  queryStatus: string
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
  transcript: PersonalChatTranscript
  active: PersonalChatList
  archived: PersonalChatList
  create(args: NativePersonalCreateArgs): Promise<Id<'conversations'>>
  submit(args: NativePersonalSubmitArgs): Promise<FunctionReturnType<typeof api.chat.personal.submit>>
  setPreferences(args: NativePersonalPreferencesArgs): Promise<void>
  setPendingTranscriptConversation(
    conversationId: string | null,
    ownerId?: string | null,
    intentKey?: string | null,
  ): void
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

const emptyTranscript: PersonalChatTranscript = {
  conversationId: null,
  rows: [],
  status: 'disabled',
  queryStatus: 'Skipped',
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
  transcript: emptyTranscript,
  active: emptyList,
  archived: emptyList,
  async create() { throw new Error('Native personal chat is unavailable') },
  async submit() { throw new Error('Native personal chat is unavailable') },
  async setPreferences() { throw new Error('Native personal chat is unavailable') },
  setPendingTranscriptConversation() {},
  async rename() {},
  async setArchived() {},
  async setRead() {},
})

export function PersonalChatProvider({ children, backendReady = false }: { children: ReactNode; backendReady?: boolean }) {
  const authConfiguration = useConvexAuthConfiguration()
  const workspace = useWorkspace()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceId = workspace.activeWorkspaceId
  const nativeConfigured = authConfiguration.nativeAuthConfigured && backendReady
  const available = nativeConfigured && authConfiguration.hasConvexClient

  if (!available) {
    const status: ListStatus = nativeConfigured ? 'unavailable' : 'disabled'
    const value: PersonalChatContextValue = {
      configured: nativeConfigured,
      available: false,
      workspaceId,
      selectedConversationId: null,
      selectedSummary: undefined,
      transcript: { ...emptyTranscript, status },
      active: { ...emptyList, status },
      archived: { ...emptyList, status },
      async create() { throw new Error('Native personal chat is unavailable') },
      async submit() { throw new Error('Native personal chat is unavailable') },
      async setPreferences() { throw new Error('Native personal chat is unavailable') },
      setPendingTranscriptConversation() {},
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
        transcript: { ...emptyTranscript, status: 'unavailable' },
        active: { ...emptyList, status: 'unavailable' },
        archived: { ...emptyList, status: 'unavailable' },
        async create() { throw new Error('Native personal chat is unavailable') },
        async submit() { throw new Error('Native personal chat is unavailable') },
        async setPreferences() { throw new Error('Native personal chat is unavailable') },
        setPendingTranscriptConversation() {},
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
  const canQuery = Boolean(workspaceReady && workspaceId && !authLoading && isAuthenticated)
  const canQueryActive = canQuery && needsActiveList
  const canQueryArchived = canQuery && needsArchivedList
  const canQuerySummary = canQuery && canReadSelectedSummary
  const { selectedConversationId, selectedSummary, transcript, setPendingTranscriptConversation } = usePersonalChatTranscript({
    workspaceId, canQuery, canRead: canReadSelectedSummary, pathname, routeId,
  })
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
  const createMutation = useMutation(api.chat.personal.create)
  const submitMutation = useMutation(api.chat.personal.submit)
  const preferencesMutation = useMutation(api.chat.personal.setPreferences)
    .withOptimisticUpdate((store, args) => {
      const update = (row: PersonalChatSummary) => ({
        ...row,
        ...(args.askModelIds !== undefined ? { askModelIds: args.askModelIds } : {}),
        ...(args.actModelId !== undefined ? { actModelId: args.actModelId } : {}),
        ...(args.lastMode !== undefined ? { lastMode: args.lastMode } : {}),
      })
      const queryArgs = { workspaceId: args.workspaceId, conversationId: args.conversationId }
      const summary = store.getQuery(api.chat.personal.getSummary, queryArgs)
      if (summary) store.setQuery(api.chat.personal.getSummary, queryArgs, update(summary))
      for (const archived of [false, true]) {
        updatePersonalChatList(store, args.workspaceId, archived, args.conversationId, update)
      }
    })

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

  const create = useCallback(async (args: NativePersonalCreateArgs) => {
    return await createMutation(args)
  }, [createMutation])
  const submit = useCallback(async (args: NativePersonalSubmitArgs) => {
    return await submitMutation(args)
  }, [submitMutation])
  const setPreferences = useCallback(async (args: NativePersonalPreferencesArgs) => {
    await preferencesMutation(args)
  }, [preferencesMutation])
  const baseListStatus = personalChatListStatus({ configured, workspaceReady, authLoading, workspaceId, isAuthenticated })
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
    transcript,
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
    create,
    submit,
    setPreferences,
    setPendingTranscriptConversation,
  }), [
    activeQuery,
    transcript,
    archivedQuery,
    canQueryActive,
    canQueryArchived,
    configured,
    activeStatus,
    archivedStatus,
    rename,
    create,
    submit,
    setPreferences,
    setPendingTranscriptConversation,
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

export function usePersonalChat() {
  return useContext(PersonalChatContext)
}
