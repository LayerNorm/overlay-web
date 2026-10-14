'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  WORK_UPDATED_EVENT,
  type CreateWorkItemRequest,
  type MoveWorkItemRequest,
  type UpdateWorkItemRequest,
  type WorkContext,
  type WorkItem,
  type WorkPerson,
} from '@overlay/app-core'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { canWorkOnItem } from '@/shared/work/permissions'
import { WORK_LIMITS } from '@/shared/work/status'
import { newItemScope } from '@/shared/workspaces/panel-scope'
import type { WorkViewer } from '@/shared/work/query'
import { useWorkRoute } from '../lib/use-work-route'
import { describeWorkChange, trackWork } from '../lib/work-analytics'
import { applyItemPatch, endRankOf, rankForDrop, removeItem, upsertItem } from '../lib/work-state'

export type WorkLoadState = 'loading' | 'ready' | 'error'

export interface WorkData {
  state: WorkLoadState
  items: WorkItem[]
  byId: ReadonlyMap<string, WorkItem>
  /** People and agents a task can be given to, and who is asking. Null until loaded. */
  context: WorkContext | null
  people: readonly WorkPerson[]
  personByPrincipal: ReadonlyMap<string, WorkPerson>
  viewer: WorkViewer | null
  /** The server returned as many tasks as it ever sends (`WORK_LIMITS.listCap`), so there may be more than are shown. */
  truncated: boolean
  /** The last change the server refused, in plain words; cleared by `dismissError` or the next change. */
  error: string | null
  dismissError: () => void
  refresh: () => Promise<void>
  /** Whether the viewer may edit this task (status, fields, comments). The server decides again on every change. */
  canWork: (item: WorkItem) => boolean
  createTask: (input: Omit<CreateWorkItemRequest, 'scope'>) => Promise<WorkItem | null>
  updateTask: (id: string, patch: UpdateWorkItemRequest) => Promise<WorkItem | null>
  moveTask: (id: string, input: MoveWorkItemRequest) => Promise<WorkItem | null>
  /** Puts a task in or takes it out of view without asking the server (after an archive or restore elsewhere). */
  dropLocal: (id: string) => void
}

const WorkDataContext = createContext<WorkData | null>(null)

export function useWorkData(): WorkData {
  const value = useContext(WorkDataContext)
  if (!value) throw new Error('useWorkData must be used inside WorkDataProvider')
  return value
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Loads the tasks for the page's scope and keeps them in step with what the person does: every change appears at once,
 * is confirmed by the server's answer, and is rolled back with a message if the server refuses.
 */
export function WorkDataProvider({ children }: { children: ReactNode }) {
  const { listView, scope, solo } = useWorkRoute()
  const { user } = useAuth()
  const { access, viewer: accessViewer } = useWorkspaceCreateAccess()
  const [items, setItems] = useState<WorkItem[]>([])
  const [state, setState] = useState<WorkLoadState>('loading')
  const [context, setContext] = useState<WorkContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  // The newest load wins, and a load never overwrites a change that is still waiting for the server.
  const loadId = useRef(0)
  const pending = useRef(0)
  // Changes to one task that the server has not answered yet. While several are waiting, only the last answer is
  // applied, so an earlier answer never flashes over a newer edit.
  const inflight = useRef(new Map<string, number>())

  const load = useCallback(async () => {
    const id = ++loadId.current
    try {
      const [list, ctx] = await Promise.all([
        overlayAppClient.work.list(listView ? { view: listView } : undefined),
        overlayAppClient.work.context().catch(() => null),
      ])
      if (id !== loadId.current) return
      if (pending.current === 0) setItems(list.items)
      if (ctx) setContext(ctx)
      setState('ready')
    } catch (caught) {
      if (id !== loadId.current) return
      setState((current) => (current === 'ready' ? current : 'error'))
      setError(messageOf(caught, 'Could not load tasks.'))
    }
  }, [listView])

  useEffect(() => {
    setState('loading')
    void load()
  }, [load])

  useWorkspaceChanged(useCallback(() => {
    setItems([])
    setContext(null)
    setState('loading')
    void load()
  }, [load]))

  useEffect(() => {
    const reload = () => void load()
    window.addEventListener(WORK_UPDATED_EVENT, reload)
    return () => window.removeEventListener(WORK_UPDATED_EVENT, reload)
  }, [load])

  /** Runs `request` with the screen already updated by `optimistic`; rolls back to `previous` when it fails. */
  const mutate = useCallback(async (
    id: string,
    optimistic: (current: WorkItem[]) => WorkItem[],
    request: () => Promise<WorkItem>,
    fallback: string,
  ): Promise<WorkItem | null> => {
    const previous = itemsRef.current
    setError(null)
    pending.current += 1
    inflight.current.set(id, (inflight.current.get(id) ?? 0) + 1)
    setItems(optimistic)
    try {
      const item = await request()
      if (inflight.current.get(id) === 1) setItems((current) => upsertItem(current, item))
      return item
    } catch (caught) {
      // With a newer edit still waiting, rolling back would undo it too: ask the server what is true instead.
      if (inflight.current.get(id) === 1) setItems(previous)
      setError(messageOf(caught, fallback))
      return null
    } finally {
      const left = (inflight.current.get(id) ?? 1) - 1
      if (left <= 0) inflight.current.delete(id)
      else inflight.current.set(id, left)
      pending.current -= 1
      if (pending.current === 0 && left > 0) void load()
    }
  }, [load])

  const createTask = useCallback<WorkData['createTask']>(async (input) => {
    const scopeToSend = newItemScope(solo ? 'personal' : scope)
    setError(null)
    pending.current += 1
    try {
      const { item } = await overlayAppClient.work.create({ ...input, ...(scopeToSend ? { scope: scopeToSend } : {}) })
      setItems((current) => upsertItem(current, item))
      trackWork('work_task_created', { scope: item.scope, status: item.status })
      return item
    } catch (caught) {
      setError(messageOf(caught, 'Could not add the task.'))
      return null
    } finally {
      pending.current -= 1
    }
  }, [scope, solo])

  const updateTask = useCallback<WorkData['updateTask']>((id, patch) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return Promise.resolve(null)
    const endRank = patch.status && patch.status !== target.status ? endRankOf(itemsRef.current, patch.status, id) : undefined
    const change = describeWorkChange(patch)
    trackWork(change.event, change.properties)
    return mutate(
      id,
      (current) => current.map((item) => (item.id === id ? applyItemPatch(item, patch, { now: Date.now(), endRank }) : item)),
      async () => (await overlayAppClient.work.update(id, patch)).item,
      'Could not save that change.',
    )
  }, [mutate])

  const moveTask = useCallback<WorkData['moveTask']>((id, input) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return Promise.resolve(null)
    const status = input.status ?? target.status
    const rank = rankForDrop(itemsRef.current, { id, status, afterId: input.afterId, beforeId: input.beforeId })
    trackWork('work_task_moved', { status, changedColumn: status !== target.status })
    return mutate(
      id,
      (current) => current.map((item) => (item.id === id ? { ...item, status, rank, updatedAt: Date.now() } : item)),
      async () => (await overlayAppClient.work.move(id, input)).item,
      'Could not move the task.',
    )
  }, [mutate])

  const dropLocal = useCallback((id: string) => setItems((current) => removeItem(current, id)), [])

  const viewer = useMemo<WorkViewer | null>(
    () => (user?.id && context ? { userId: user.id, principalId: context.principalId } : null),
    [context, user?.id],
  )
  const people = useMemo(() => context?.people ?? [], [context])
  const personByPrincipal = useMemo(() => new Map(people.map((person) => [person.principalId, person])), [people])
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const canWork = useCallback((item: WorkItem) => {
    if (!viewer || !context) return false
    return canWorkOnItem(
      { userId: item.createdBy, scope: item.scope, archivedAt: item.archivedAt ?? undefined, archivedFromScope: item.archivedFromScope ?? undefined, assigneePrincipalId: item.assigneePrincipalId },
      { userId: viewer.userId, role: accessViewer?.role ?? context.role },
      viewer.principalId,
      access.scope,
    )
  }, [access.scope, accessViewer?.role, context, viewer])

  const value = useMemo<WorkData>(() => ({
    state, items, byId, context, people, personByPrincipal, viewer, error,
    truncated: items.length >= WORK_LIMITS.listCap,
    dismissError: () => setError(null),
    refresh: load,
    canWork, createTask, updateTask, moveTask, dropLocal,
  }), [byId, canWork, context, createTask, dropLocal, error, items, load, moveTask, people, personByPrincipal, state, updateTask, viewer])

  return <WorkDataContext.Provider value={value}>{children}</WorkDataContext.Provider>
}
