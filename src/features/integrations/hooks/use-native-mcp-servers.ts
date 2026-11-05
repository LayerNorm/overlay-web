'use client'

import { useMutation, usePaginatedQuery, useConvexAuth } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import type { OptimisticLocalStore } from 'convex/browser'
import type { McpServerSummary } from '@overlay/app-core'

const listRef = makeFunctionReference<'query'>('integrations/nativeMcpServers:list')
const getRef = makeFunctionReference<'query'>('integrations/nativeMcpServers:get')
const updateMetadataRef = makeFunctionReference<'mutation'>('integrations/nativeMcpServers:updateMetadata')
const changeScopeRef = makeFunctionReference<'mutation'>('integrations/nativeMcpServers:changeScope')

export type NativeMcpSummary = McpServerSummary & {
  workspaceId: string
  endpointRedacted: true
  commandState?: {
    id: string
    kind: 'test' | 'connect' | 'disconnect'
    status: 'pending' | 'succeeded' | 'failed'
    startedAt: number
    finishedAt?: number
    toolCount?: number
  }
}

type NativeListPage = {
  page: NativeMcpSummary[]
  isDone: boolean
  continueCursor: string
}

export type NativeMcpAvailability = 'disabled' | 'loading' | 'available' | 'unavailable'

export function patchNativeMcpEnabled(store: OptimisticLocalStore, args: {
  workspaceId: string
  mcpServerId: string
  enabled: boolean
}) {
  for (const { args: queryArgs, value } of store.getAllQueries(listRef)) {
    const page = value as NativeListPage | undefined
    if (queryArgs.workspaceId !== args.workspaceId || !page || !Array.isArray(page.page)) continue
    store.setQuery(listRef, queryArgs, {
      ...page,
      page: page.page.map((row) => row._id === args.mcpServerId
        ? { ...row, enabled: args.enabled }
        : row),
    })
  }
  const getArgs = { workspaceId: args.workspaceId, mcpServerId: args.mcpServerId }
  const selected = store.getQuery(getRef, getArgs)
  if (selected) store.setQuery(getRef, getArgs, { ...selected, enabled: args.enabled })
}

export function useNativeMcpServers({
  configured,
  hasConvexClient,
  workspaceId,
  workspaceReady,
  view,
}: {
  configured: boolean
  hasConvexClient: boolean
  workspaceId: string | null
  workspaceReady: boolean
  view?: 'personal' | 'workspace' | 'archived'
}) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const canQuery = configured && hasConvexClient && workspaceReady && Boolean(workspaceId) && !authLoading && isAuthenticated
  const query = usePaginatedQuery(
    listRef,
    canQuery ? { workspaceId: workspaceId!, view } : 'skip',
    { initialNumItems: 30 },
  )
  const updateMetadata = useMutation(updateMetadataRef).withOptimisticUpdate((store, args) => {
    if (typeof args.enabled === 'boolean') patchNativeMcpEnabled(store, args as Parameters<typeof patchNativeMcpEnabled>[1])
  })
  const changeScope = useMutation(changeScopeRef)
  const availability: NativeMcpAvailability = !configured
    ? 'disabled'
    : !hasConvexClient || (workspaceReady && !authLoading && !isAuthenticated)
      ? 'unavailable'
      : !workspaceReady || authLoading || !workspaceId
        ? 'loading'
        : 'available'

  return {
    availability,
    servers: (query.results ?? []) as NativeMcpSummary[],
    loading: query.status === 'LoadingFirstPage',
    hasMore: query.status === 'CanLoadMore',
    loadingMore: query.status === 'LoadingMore',
    loadMore: () => { if (query.status === 'CanLoadMore') query.loadMore(30) },
    updateMetadata: (args: {
      workspaceId: string
      mcpServerId: string
      expectedUpdatedAt: number
      name?: string
      description?: string
      enabled?: boolean
      timeoutMs?: number
      defaultToolPolicy?: 'allow' | 'approval_required' | 'deny'
    }) => updateMetadata(args),
    changeScope: (args: {
      workspaceId: string
      mcpServerId: string
      expectedUpdatedAt: number
      action: 'personal' | 'workspace' | 'archive' | 'restore'
    }) => changeScope(args),
  }
}
