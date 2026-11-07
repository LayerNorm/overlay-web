'use client'

import { useCallback } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs } from 'convex/server'
import type { SkillSummary } from '@overlay/app-core'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

type UpdateArgs = FunctionArgs<typeof api.integrations.skillsBrowse.update>

function useSkillWorkspace(): string | null {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  return status === 'ready' && activeWorkspaceId && isAuthenticated && !isLoading ? activeWorkspaceId : null
}

/** The skills of a view, live: undefined while loading, null without access. */
export function useLiveSkills(view: PanelScope | undefined): Array<SkillSummary & { canEdit: boolean }> | null | undefined {
  const workspaceId = useSkillWorkspace()
  return useQuery(api.integrations.skillsBrowse.list, workspaceId ? { workspaceId, ...(view ? { view } : {}) } : 'skip') as
    Array<SkillSummary & { canEdit: boolean }> | null | undefined
}

function updateOptimistically(store: OptimisticLocalStore, { workspaceId, skillId, expectedUpdatedAt: _expected, ...patch }: UpdateArgs) {
  for (const { args, value } of store.getAllQueries(api.integrations.skillsBrowse.list)) {
    if (!value || args.workspaceId !== workspaceId) continue
    store.setQuery(api.integrations.skillsBrowse.list, args, value.map(skill => (skill._id === skillId ? { ...skill, ...patch } : skill)))
  }
}

function removeOptimistically(store: OptimisticLocalStore, { workspaceId, skillId }: { workspaceId: string; skillId: Id<'skills'> }) {
  for (const { args, value } of store.getAllQueries(api.integrations.skillsBrowse.list)) {
    if (!value || args.workspaceId !== workspaceId) continue
    store.setQuery(api.integrations.skillsBrowse.list, args, value.filter(skill => skill._id !== skillId))
  }
}

/** Native skill commands; edits and deletes show at once and roll back by themselves if refused. */
export function useSkillCommands() {
  const workspaceId = useSkillWorkspace()
  const create = useMutation(api.integrations.skillsBrowse.create)
  const update = useMutation(api.integrations.skillsBrowse.update).withOptimisticUpdate(updateOptimistically)
  const remove = useMutation(api.integrations.skillsBrowse.remove).withOptimisticUpdate(removeOptimistically)
  const ws = useCallback(() => {
    if (!workspaceId) throw new Error('Skills are not available yet.')
    return workspaceId
  }, [workspaceId])
  return {
    create: useCallback((input: Omit<FunctionArgs<typeof api.integrations.skillsBrowse.create>, 'workspaceId'>) =>
      create({ ...input, workspaceId: ws() }), [create, ws]),
    update: useCallback((input: Omit<UpdateArgs, 'workspaceId' | 'skillId'> & { skillId: string }) =>
      update({ ...input, skillId: input.skillId as Id<'skills'>, workspaceId: ws() }), [update, ws]),
    remove: useCallback((skillId: string) => remove({ skillId: skillId as Id<'skills'>, workspaceId: ws() }), [remove, ws]),
  }
}
