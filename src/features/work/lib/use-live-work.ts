'use client'

import { useCallback } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs } from 'convex/server'
import type { UpdateWorkItemRequest, WorkContext, WorkEvent, WorkItem } from '@overlay/app-core'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScopeState } from '@/hooks/use-panel-scope'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { api } from '../../../../convex/_generated/api'
import { applyItemPatch, endRankOf, rankForDrop } from './work-state'

type UpdateArgs = FunctionArgs<typeof api.work.browse.update>
type MoveArgs = FunctionArgs<typeof api.work.browse.move>

/**
 * The workspace live queries run in, once the session can read it and the scope is settled; null before that. Waiting
 * for the scope keeps a Personal guess from opening (and then dropping) a subscription for the wrong list.
 */
function useWorkWorkspace(): string | null {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { known: scopeKnown } = usePanelScopeState()
  return status === 'ready' && activeWorkspaceId && isAuthenticated && !isLoading && scopeKnown ? activeWorkspaceId : null
}

/**
 * The tasks of a view and the Work context, live. The Work page, its sidebar sections and any other caller with the
 * same view share one subscription, so a change anywhere (this tab, another tab, an agent) reaches all of them.
 * `items` is undefined while loading and null without Work access.
 */
export function useLiveWork(listView: PanelScope | undefined) {
  const workspaceId = useWorkWorkspace()
  const items = useQuery(api.work.browse.list, workspaceId ? { workspaceId, ...(listView ? { view: listView } : {}) } : 'skip')
  const context = useQuery(api.work.browse.context, workspaceId ? { workspaceId } : 'skip')
  return {
    items: items as WorkItem[] | null | undefined,
    context: (context ?? null) as WorkContext | null,
  }
}

/** One task, live, wherever it is (another scope, archived, past the list window). Null when gone or hidden. */
export function useLiveWorkTask(id: string | null): WorkItem | null | undefined {
  const workspaceId = useWorkWorkspace()
  return useQuery(api.work.browse.get, workspaceId && id ? { workspaceId, id } : 'skip') as WorkItem | null | undefined
}

export type WorkLinkedThread =
  | { visible: false }
  | { visible: true; conversationId: string; agentId: string; title: string; state: 'working' | 'finished' | 'stopped'; updatedAt: number }

/** The agent thread working on a task, live. Undefined while loading; null when no agent has picked it up. */
export function useLiveWorkThread(id: string, enabled: boolean): WorkLinkedThread | null | undefined {
  const workspaceId = useWorkWorkspace()
  return useQuery(api.work.browse.linkedThread, workspaceId && enabled ? { workspaceId, id } : 'skip') as WorkLinkedThread | null | undefined
}

/** A task's activity and comments, live. */
export function useLiveWorkEvents(id: string): WorkEvent[] | undefined {
  const workspaceId = useWorkWorkspace()
  return useQuery(api.work.browse.events, workspaceId ? { workspaceId, workItemId: id } : 'skip') as WorkEvent[] | undefined
}

/** Replaces one task in every cached list and task query of its workspace. */
function patchTask(store: OptimisticLocalStore, workspaceId: string, id: string, change: (item: WorkItem, list: readonly WorkItem[]) => WorkItem) {
  for (const { args, value } of store.getAllQueries(api.work.browse.list)) {
    if (!value || args.workspaceId !== workspaceId) continue
    const list = value as WorkItem[]
    if (!list.some(item => item.id === id)) continue
    store.setQuery(api.work.browse.list, args, list.map(item => (item.id === id ? change(item, list) : item)) as never)
  }
  for (const { args, value } of store.getAllQueries(api.work.browse.get)) {
    if (value && args.workspaceId === workspaceId && args.id === id) store.setQuery(api.work.browse.get, args, change(value as WorkItem, []) as never)
  }
}

function updateOptimistically(store: OptimisticLocalStore, { workspaceId, id, expectedUpdatedAt: _expected, ...patch }: UpdateArgs) {
  const now = Date.now()
  patchTask(store, workspaceId, id, (item, list) => applyItemPatch(item, patch as UpdateWorkItemRequest, {
    now,
    endRank: patch.status && patch.status !== item.status && list.length ? endRankOf(list, patch.status, id) : undefined,
  }))
}

function moveOptimistically(store: OptimisticLocalStore, { workspaceId, id, status, afterId, beforeId }: MoveArgs) {
  const now = Date.now()
  patchTask(store, workspaceId, id, (item, list) => {
    const column = status ?? item.status
    return { ...item, status: column, rank: rankForDrop(list.length ? list : [item], { id, status: column, afterId, beforeId }), updatedAt: now }
  })
}

/**
 * Native task commands. Each shows its change at once in every live list and task; the server's answer replaces the
 * guess, and a refused change disappears by itself, leaving newer changes in place.
 */
export function useWorkCommands() {
  const workspaceId = useWorkWorkspace()
  const create = useMutation(api.work.browse.create)
  const update = useMutation(api.work.browse.update).withOptimisticUpdate(updateOptimistically)
  const move = useMutation(api.work.browse.move).withOptimisticUpdate(moveOptimistically)
  const comment = useMutation(api.work.browse.addComment)
  const requireWorkspace = useCallback(() => {
    if (!workspaceId) throw new Error('Work is not available yet.')
    return workspaceId
  }, [workspaceId])
  return {
    create: useCallback((input: Omit<FunctionArgs<typeof api.work.browse.create>, 'workspaceId'>) =>
      create({ ...input, workspaceId: requireWorkspace() }) as Promise<WorkItem | null>, [create, requireWorkspace]),
    update: useCallback((input: Omit<UpdateArgs, 'workspaceId'>) =>
      update({ ...input, workspaceId: requireWorkspace() }) as Promise<WorkItem | null>, [requireWorkspace, update]),
    move: useCallback((input: Omit<MoveArgs, 'workspaceId'>) =>
      move({ ...input, workspaceId: requireWorkspace() }) as Promise<WorkItem | null>, [move, requireWorkspace]),
    addComment: useCallback((workItemId: string, body: string) =>
      comment({ workItemId, body, workspaceId: requireWorkspace() }), [comment, requireWorkspace]),
  }
}
