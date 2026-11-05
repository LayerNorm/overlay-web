'use client'

import type { OptimisticLocalStore } from 'convex/browser'
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import type { FunctionArgs } from 'convex/server'
import { api } from '../../../../convex/_generated/api'
import { optimisticallyChangeSkill } from './native-skills-optimistic'

type ChangeScopeArgs = FunctionArgs<typeof api.integrations.nativeSkills.changeScope>

function optimisticallyChangeScope(store: OptimisticLocalStore, args: ChangeScopeArgs) {
  if (args.action === 'archive') optimisticallyChangeSkill(store, args, { archivedAt: Date.now() })
  if (args.action === 'move' && args.to) optimisticallyChangeSkill(store, args, { scope: args.to })
  if (args.action === 'restore') {
    const row = store.getQuery(api.integrations.nativeSkills.get, { workspaceId: args.workspaceId, skillId: args.skillId })
    if (row) optimisticallyChangeSkill(store, args, { archivedAt: undefined, archivedFromScope: undefined, scope: row.archivedFromScope ?? row.scope })
  }
}

export function useNativeSkills(workspaceId: string, view: 'personal' | 'workspace' | 'archived') {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ready = isAuthenticated && !isLoading
  const list = usePaginatedQuery(api.integrations.nativeSkills.list, ready ? { workspaceId, view } : 'skip', { initialNumItems: 50 })
  const permissions = useQuery(api.integrations.nativeSkills.permissions, ready ? { workspaceId } : 'skip')
  const create = useMutation(api.integrations.nativeSkills.create)
  const update = useMutation(api.integrations.nativeSkills.update).withOptimisticUpdate((store, args) => {
    optimisticallyChangeSkill(store, args, { name: args.name, description: args.description, instructions: args.instructions, enabled: args.enabled })
  })
  const remove = useMutation(api.integrations.nativeSkills.remove).withOptimisticUpdate((store, args) => {
    optimisticallyChangeSkill(store, args, null)
  })
  const changeScope = useMutation(api.integrations.nativeSkills.changeScope).withOptimisticUpdate(optimisticallyChangeScope)
  return { ...list, results: ready ? list.results : [], permissions: ready ? permissions : undefined,
    loading: isLoading || (ready && list.status === 'LoadingFirstPage'), denied: !isLoading && !isAuthenticated,
    create, update, remove, changeScope }
}

/** Mount only under native Convex auth and a surface-local error boundary. Never fall back to HTTP on denial. */
export function useNativeSkillAvailability(workspaceId: string, workspaceOnly = false) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ready = isAuthenticated && !isLoading
  const current = usePaginatedQuery(api.integrations.nativeSkills.availability,
    ready ? { workspaceId, workspaceOnly, legacyPersonal: false } : 'skip', { initialNumItems: 50 })
  const legacy = usePaginatedQuery(api.integrations.nativeSkills.availability,
    ready && !workspaceOnly ? { workspaceId, workspaceOnly: false, legacyPersonal: true } : 'skip', { initialNumItems: 50 })
  return {
    skills: ready ? [...current.results, ...(!workspaceOnly ? legacy.results : [])] : [],
    loading: isLoading || (ready && (current.status === 'LoadingFirstPage' || (!workspaceOnly && legacy.status === 'LoadingFirstPage'))),
    denied: !isLoading && !isAuthenticated,
    hasMore: ready && (current.status === 'CanLoadMore' || (!workspaceOnly && legacy.status === 'CanLoadMore')),
    loadMore: () => {
      if (current.status === 'CanLoadMore') current.loadMore(50)
      if (!workspaceOnly && legacy.status === 'CanLoadMore') legacy.loadMore(50)
    },
  }
}
