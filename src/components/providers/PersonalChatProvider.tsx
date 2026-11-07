'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useConvex, useConvexAuth, useMutation, usePaginatedQuery } from 'convex/react'
import { usePersonalChatTranscript } from './usePersonalChatTranscript'
import { useNativePersonalExecution } from './native-personal-execution'
import type { NativePersonalExecutionState } from './native-personal-execution'
import { updatePersonalChatList, findPersonalChatSummary, minimalSummary, movePersonalChatRow, personalChatListStatus } from './personal-chat-store'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  createPersonalChatArchiveOptimisticUpdate,
  updatePersonalChatUnread,
} from './personal-chat-optimistic'
import { useHasConvexClient } from '@/components/providers/ConvexAuthProvider'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { PersonalChatErrorBoundary } from './personal-chat-error-boundary'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
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
type NativeDeleteTurnArgs = FunctionArgs<typeof api.chat.personal.deleteTurn>
type NativeBranchArgs = FunctionArgs<typeof api.chat.personal.branch>
type NativeGeneratedUiInput = { conversationId: string; messageId: string; partId: string; data: GeneratedUiData }
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

type PersonalChatExecution = NativePersonalExecutionState

type PersonalChatContextValue = {
  configured: boolean
  available: boolean
  workspaceId: string | null
  viewerUserId: string | null
  selectedConversationId: string | null
  selectedSummary: PersonalChatSummary | null | undefined
  transcript: PersonalChatTranscript
  execution: PersonalChatExecution
  active: PersonalChatList
  archived: PersonalChatList
  create(args: NativePersonalCreateArgs): Promise<Id<'conversations'>>
  submit(args: NativePersonalSubmitArgs): Promise<FunctionReturnType<typeof api.chat.personal.submit>>
  setPreferences(args: NativePersonalPreferencesArgs): Promise<void>
  deleteTurn(args: NativeDeleteTurnArgs): Promise<void>
  branch(args: NativeBranchArgs): Promise<string>
  setGeneratedUi(args: NativeGeneratedUiInput): Promise<void>
  addAssistantNote(conversationId: string, turnId: string, text: string): Promise<void>
  findRecentChat(scope: 'personal' | 'workspace'): Promise<string | null>
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

const emptyExecution: PersonalChatExecution = { status: 'disabled', value: null }

const PersonalChatContext = createContext<PersonalChatContextValue>({
  configured: false,
  available: false,
  workspaceId: null,
  viewerUserId: null,
  selectedConversationId: null,
  selectedSummary: undefined,
  transcript: emptyTranscript,
  execution: emptyExecution,
  active: emptyList,
  archived: emptyList,
  async create() { throw new Error('Native personal chat is unavailable') },
  async submit() { throw new Error('Native personal chat is unavailable') },
  async setPreferences() { throw new Error('Native personal chat is unavailable') },
  async deleteTurn() { throw new Error('Native personal chat is unavailable') },
  async branch() { throw new Error('Native personal chat is unavailable') },
  async setGeneratedUi() { throw new Error('Native personal chat is unavailable') },
  async addAssistantNote() { throw new Error('Native personal chat is unavailable') },
  async findRecentChat() { return null },
  setPendingTranscriptConversation() {},
  async rename() {},
  async setArchived() {},
  async setRead() {},
})

export function PersonalChatProvider({ children }: { children: ReactNode }) {
  const hasConvexClient = useHasConvexClient()
  const workspace = useWorkspace()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const workspaceId = workspace.activeWorkspaceId

  if (!hasConvexClient) {
    const status: ListStatus = 'disabled'
    const value: PersonalChatContextValue = {
      configured: false,
      available: false,
      workspaceId,
      viewerUserId: null,
      selectedConversationId: null,
      selectedSummary: undefined,
      transcript: { ...emptyTranscript, status },
      execution: { ...emptyExecution, status },
      active: { ...emptyList, status },
      archived: { ...emptyList, status },
      async create() { throw new Error('Native personal chat is unavailable') },
      async submit() { throw new Error('Native personal chat is unavailable') },
      async setPreferences() { throw new Error('Native personal chat is unavailable') },
      async deleteTurn() { throw new Error('Native personal chat is unavailable') },
      async branch() { throw new Error('Native personal chat is unavailable') },
      async setGeneratedUi() { throw new Error('Native personal chat is unavailable') },
      async addAssistantNote() { throw new Error('Native personal chat is unavailable') },
      async findRecentChat() { return null },
      setPendingTranscriptConversation() {},
      async rename() { throw new Error('Native personal chat is unavailable') },
      async setArchived() { throw new Error('Native personal chat is unavailable') },
      async setRead() { throw new Error('Native personal chat is unavailable') },
    }
    return <PersonalChatContext.Provider value={value}>{children}</PersonalChatContext.Provider>
  }

  return (
    <PersonalChatErrorBoundary
      context={PersonalChatContext}
      resetKey={`${workspaceId ?? 'no-workspace'}:${pathname ?? ''}:${searchParams.toString()}`}
      fallbackChildren={children}
      fallbackValue={{
        configured: true,
        available: false,
        workspaceId,
        viewerUserId: null,
        selectedConversationId: null,
        selectedSummary: undefined,
        transcript: { ...emptyTranscript, status: 'unavailable' },
        execution: { ...emptyExecution, status: 'unavailable' },
        active: { ...emptyList, status: 'unavailable' },
        archived: { ...emptyList, status: 'unavailable' },
        async create() { throw new Error('Native personal chat is unavailable') },
        async submit() { throw new Error('Native personal chat is unavailable') },
        async setPreferences() { throw new Error('Native personal chat is unavailable') },
        async deleteTurn() { throw new Error('Native personal chat is unavailable') },
        async branch() { throw new Error('Native personal chat is unavailable') },
        async setGeneratedUi() { throw new Error('Native personal chat is unavailable') },
        async addAssistantNote() { throw new Error('Native personal chat is unavailable') },
        async findRecentChat() { return null },
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

function generatedUiMutationArgs(workspaceId: string | null, args: NativeGeneratedUiInput) {
  if (!workspaceId) throw new Error('Native personal chat is unavailable')
  return {
    workspaceId,
    conversationId: args.conversationId as Id<'conversations'>,
    messageId: args.messageId as Id<'conversationMessages'>,
    partId: args.partId,
    data: args.data as FunctionArgs<typeof api.chat.personal.setGeneratedUi>['data'],
  }
}

function isAutomationConsumerPath(pathname: string | null): boolean {
  if (!pathname) return false
  const handleRoute = parseWorkspaceHandleRoute(pathname)
  if (handleRoute) return handleRoute.surface === 'automations'
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'app' && segments.includes('automations')
}

function personalChatQueryDemand(pathname: string | null, routeParams: URLSearchParams) {
  const isChatSurface = isChatConsumerPath(pathname)
  const routeScope = readWorkspacePathScope(pathname ?? '')
    ?? legacyWorkspaceScopeForRoute('chat', routeParams)
  const view = routeParams.get('view')
  const isRoomView = ['dms', 'channels', 'room', 'rooms'].includes(view ?? '')
  const isNativePersonalChatSurface = (isChatSurface && !isRoomView) || isAutomationConsumerPath(pathname)
  const activeScope = routeScope === 'workspace' ? 'workspace' as const : 'personal' as const
  const handleRoute = pathname ? parseWorkspaceHandleRoute(pathname) : null
  const isArchivedRoute = handleRoute?.surface === 'archived'
    || pathname === '/app/archived'
    || pathname?.startsWith('/app/archived/') === true
    || (pathname?.startsWith('/app/w/') === true && pathname.endsWith('/archived'))
  const isArchivedSettings = pathname?.endsWith('/settings') === true && routeParams.get('section') === 'archived'
  // The sidebar lists AI chats on room routes too.
  const needsActiveList = isChatSurface
  const needsArchivedList = isArchivedRoute || isArchivedSettings
  const canReadSelectedSummary = isNativePersonalChatSurface || isArchivedRoute
  const routeId = canReadSelectedSummary ? routeParams.get('id') : null
  return { needsActiveList, needsArchivedList, canReadSelectedSummary, routeId, activeScope, isNativePersonalChatSurface }
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
  const client = useConvex()
  const [temporaryActive, setTemporaryActive] = useState(false)
  useEffect(() => {
    const updateTemporary = (event: Event) => {
      setTemporaryActive(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active))
    }
    window.addEventListener('overlay:temporary-chat', updateTemporary)
    return () => window.removeEventListener('overlay:temporary-chat', updateTemporary)
  }, [])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeParams = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const {
    needsActiveList, needsArchivedList, canReadSelectedSummary, routeId, activeScope, isNativePersonalChatSurface,
  } = personalChatQueryDemand(pathname, routeParams)
  const canQuery = Boolean(workspaceReady && workspaceId && !authLoading && isAuthenticated)
  const canQueryActive = canQuery && needsActiveList && !temporaryActive
  const canQueryArchived = canQuery && needsArchivedList
  const canReadNativeSummary = canReadSelectedSummary && !temporaryActive
  const canQuerySummary = canQuery && canReadNativeSummary
  const { selectedConversationId, selectedSummary, viewerUserId, transcript, setPendingTranscriptConversation } = usePersonalChatTranscript({
    workspaceId, canQuery, canRead: canReadNativeSummary, pathname, routeId,
  })
  const execution = useNativePersonalExecution({
    enabled: isNativePersonalChatSurface && !temporaryActive,
    canQuery,
    workspaceId,
    viewerUserId,
    conversationId: transcript.conversationId,
    summaryConversationId: selectedSummary?._id ?? null,
    transcriptConversationId: transcript.conversationId,
    transcriptStatus: transcript.status,
  })
  const activeQuery = usePaginatedQuery(
    api.chat.personal.list,
    canQueryActive ? { workspaceId: workspaceId!, archived: false, scope: activeScope } : 'skip',
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
    const current = client.watchQuery(api.chat.personal.getSummary, {
      workspaceId: summary.workspaceId,
      conversationId: summary._id,
    }).localQueryResult()
    if (current === null) throw new Error('Conversation is no longer available')
    // Undo may be invoked from a toast that captured an older row. Preserve
    // the latest optimistic summary even after the earlier mutation settles.
    const fallbackSummary = minimalSummary(current ?? summary)
    const mutateWithOptimism = archiveMutation.withOptimisticUpdate((store, args) => {
      const applyArchiveUpdate = createPersonalChatArchiveOptimisticUpdate(fallbackSummary, {
        getCurrent: (mutationArgs) => {
          const selected = store.getQuery(api.chat.personal.getSummary, {
            workspaceId: mutationArgs.workspaceId,
            conversationId: mutationArgs.conversationId as Id<'conversations'>,
          })
          return selected === null ? null
            : selected ?? findPersonalChatSummary(store, mutationArgs.workspaceId, mutationArgs.conversationId)
        },
        move: (mutationArgs, next) => movePersonalChatRow(
          store,
          mutationArgs.workspaceId,
          mutationArgs.conversationId,
          mutationArgs.archived,
          next,
        ),
        updateSummary: (mutationArgs, next) => {
          const queryArgs = {
            workspaceId: mutationArgs.workspaceId,
            conversationId: mutationArgs.conversationId as Id<'conversations'>,
          }
          // Keep pending operations on one summary even if its list row moves
          // out of the only loaded page. Convex rebases this from server data.
          store.setQuery(api.chat.personal.getSummary, queryArgs, next)
        },
      })
      applyArchiveUpdate(args)
    })
    await mutateWithOptimism({
      workspaceId: summary.workspaceId,
      conversationId: summary._id,
      archived,
    })
  }, [archiveMutation, client])

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
  const deleteTurnMutation = useMutation(api.chat.personal.deleteTurn)
  const branchMutation = useMutation(api.chat.personal.branch)
  const generatedUiMutation = useMutation(api.chat.personal.setGeneratedUi)
  const noteMutation = useMutation(api.chat.personal.addAssistantNote)
  const deleteTurn = useCallback(async (args: NativeDeleteTurnArgs) => {
    await deleteTurnMutation(args)
  }, [deleteTurnMutation])
  const branch = useCallback((args: NativeBranchArgs) => branchMutation(args), [branchMutation])
  const setGeneratedUi = useCallback(async (args: NativeGeneratedUiInput) => {
    await generatedUiMutation(generatedUiMutationArgs(workspaceId, args))
  }, [generatedUiMutation, workspaceId])
  const addAssistantNote = useCallback(async (conversationId: string, turnId: string, text: string) => {
    if (!workspaceId) return
    await noteMutation({ workspaceId, conversationId: conversationId as Id<'conversations'>, turnId, text })
  }, [noteMutation, workspaceId])
  const findRecentChat = useCallback(async (scope: 'personal' | 'workspace') => {
    if (!workspaceId) return null
    const result = await client.query(api.chat.personal.list, {
      workspaceId, archived: false, scope, paginationOpts: { numItems: 10, cursor: null },
    })
    return result.page[0]?._id ?? null
  }, [client, workspaceId])
  const baseListStatus = personalChatListStatus({ configured, workspaceReady, authLoading, workspaceId, isAuthenticated })
  const activeStatus = !needsActiveList || temporaryActive
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
    viewerUserId,
    selectedConversationId,
    selectedSummary: visibleSelectedSummary,
    transcript,
    execution,
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
    deleteTurn,
    branch,
    setGeneratedUi,
    addAssistantNote,
    findRecentChat,
    setPendingTranscriptConversation,
  }), [
    activeQuery,
    transcript,
    execution,
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
    deleteTurn,
    branch,
    setGeneratedUi,
    addAssistantNote,
    findRecentChat,
    setPendingTranscriptConversation,
    selectedConversationId,
    setArchived,
    setRead,
    visibleActiveRows,
    visibleArchivedRows,
    visibleSelectedSummary,
    workspaceId,
    viewerUserId,
  ])

  return <PersonalChatContext.Provider value={value}>{children}</PersonalChatContext.Provider>
}

export function usePersonalChat() {
  return useContext(PersonalChatContext)
}
