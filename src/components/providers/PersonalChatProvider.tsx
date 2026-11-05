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
import { usePathname, useSearchParams } from 'next/navigation'
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  insertPersonalChatRow,
  removePersonalChatRow,
  updatePersonalChatRow,
} from './personal-chat-optimistic'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { useWorkspace } from '@/contexts/WorkspaceContext'

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

function readConversationId(): string | null {
  return typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('id')
}

export function PersonalChatProvider({ children }: { children: ReactNode }) {
  const authConfiguration = useConvexAuthConfiguration()
  const workspace = useWorkspace()
  const workspaceId = workspace.switchingWorkspaceId ? null : workspace.activeWorkspaceId
  const nativeConfigured = authConfiguration.nativeAuthConfigured
  const available = nativeConfigured && authConfiguration.hasConvexClient

  if (!available) {
    const status: ListStatus = nativeConfigured ? 'unavailable' : 'disabled'
    const value: PersonalChatContextValue = {
      configured: nativeConfigured,
      available: false,
      workspaceId,
      selectedConversationId: readConversationId(),
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
    <NativePersonalChatProvider
      configured
      workspaceId={workspaceId}
      workspaceReady={workspace.status === 'ready' && !workspace.switchingWorkspaceId}
    >
      {children}
    </NativePersonalChatProvider>
  )
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
  const [routeConversationId, setRouteConversationId] = useRefState(readConversationId)
  const selectedConversationId = routeConversationId
  const canQuery = Boolean(workspaceReady && workspaceId && !authLoading && isAuthenticated)
  const activeQuery = usePaginatedQuery(
    api.chat.personal.list,
    canQuery ? { workspaceId: workspaceId!, archived: false } : 'skip',
    { initialNumItems: 30 },
  )
  const archivedQuery = usePaginatedQuery(
    api.chat.personal.list,
    canQuery ? { workspaceId: workspaceId!, archived: true } : 'skip',
    { initialNumItems: 30 },
  )
  const selectedSummary = useQuery(
    api.chat.personal.getSummary,
    canQuery && selectedConversationId
      ? { workspaceId: workspaceId!, conversationId: selectedConversationId as Id<'conversations'> }
      : 'skip',
  )
  const capturedSummaries = useRef(new Map<string, PersonalChatSummary>())

  useEffect(() => {
    setRouteConversationId(readConversationId())
  }, [pathname, searchParams, setRouteConversationId])

  useEffect(() => {
    function syncRoute() {
      setRouteConversationId(readConversationId())
    }
    window.addEventListener('overlay:chat-route-selected', syncRoute)
    window.addEventListener('popstate', syncRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', syncRoute)
      window.removeEventListener('popstate', syncRoute)
    }
  }, [setRouteConversationId])

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

  const archiveMutation = useMutation(api.chat.personal.setArchived).withOptimisticUpdate((store, args) => {
    const summary = capturedSummaries.current.get(args.conversationId)
      ?? findPersonalChatSummary(store, args.workspaceId, args.conversationId)
      ?? store.getQuery(api.chat.personal.getSummary, {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
      })
    const next = summary
      ? { ...summary, archivedAt: args.archived ? Date.now() : undefined }
      : null
    movePersonalChatRow(store, args.workspaceId, args.conversationId, args.archived, next)
    const queryArgs = { workspaceId: args.workspaceId, conversationId: args.conversationId }
    const selected = store.getQuery(api.chat.personal.getSummary, queryArgs)
    if (selected) {
      store.setQuery(api.chat.personal.getSummary, queryArgs, {
        ...selected,
        archivedAt: args.archived ? Date.now() : undefined,
      })
    }
  })

  const readMutation = useMutation(api.chat.personal.setRead).withOptimisticUpdate((store, args) => {
    const update = (row: PersonalChatSummary) => ({ ...row, unread: args.unread })
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
    capturedSummaries.current.set(summary._id, summary)
    try {
      await archiveMutation({
        workspaceId: summary.workspaceId,
        conversationId: summary._id,
        archived,
      })
    } finally {
      if (capturedSummaries.current.get(summary._id) === summary) {
        capturedSummaries.current.delete(summary._id)
      }
    }
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

  const listStatus: ListStatus = !configured
    ? 'disabled'
    : !workspaceReady || authLoading
      ? 'loading'
      : isAuthenticated
        ? 'ready'
        : 'unavailable'
  const visibleActiveRows = useMemo(
    () => canQuery ? activeQuery.results : [],
    [activeQuery.results, canQuery],
  )
  const visibleArchivedRows = useMemo(
    () => canQuery ? archivedQuery.results : [],
    [archivedQuery.results, canQuery],
  )
  const visibleSelectedSummary = canQuery ? selectedSummary : undefined
  const value = useMemo<PersonalChatContextValue>(() => ({
    configured,
    available: true,
    workspaceId,
    selectedConversationId,
    selectedSummary: visibleSelectedSummary,
    active: {
      rows: visibleActiveRows,
      status: listStatus,
      hasMore: canQuery && (activeQuery.status === 'CanLoadMore' || activeQuery.status === 'LoadingMore'),
      loadingMore: canQuery && activeQuery.status === 'LoadingMore',
      loadMore: () => { if (canQuery) activeQuery.loadMore(30) },
    },
    archived: {
      rows: visibleArchivedRows,
      status: listStatus,
      hasMore: canQuery && (archivedQuery.status === 'CanLoadMore' || archivedQuery.status === 'LoadingMore'),
      loadingMore: canQuery && archivedQuery.status === 'LoadingMore',
      loadMore: () => { if (canQuery) archivedQuery.loadMore(30) },
    },
    rename,
    setArchived,
    setRead,
  }), [
    activeQuery,
    archivedQuery,
    canQuery,
    configured,
    listStatus,
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

function useRefState<T>(getInitialValue: () => T): [T, (value: T) => void] {
  return useState(getInitialValue)
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
