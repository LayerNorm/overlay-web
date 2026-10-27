'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from '@overlay/ui/primitives'
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
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { canWorkOnItem } from '@/shared/work/permissions'
import { WORK_LIMITS } from '@/shared/work/status'
import { newItemScope } from '@/shared/workspaces/panel-scope'
import type { WorkViewer } from '@/shared/work/query'
import { useWorkRoute } from '../lib/use-work-route'
import { publishSidebarWork } from './WorkSidebarSection'
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
  /** A load failure after the list was shown; cleared by a successful reload. */
  error: string | null
  refresh: () => Promise<void>
  /** Whether the viewer may edit this task (status, fields, comments). The server decides again on every change. */
  canWork: (item: WorkItem) => boolean
  createTask: (input: Omit<CreateWorkItemRequest, 'scope'>) => Promise<WorkItem | null>
  updateTask: (id: string, patch: UpdateWorkItemRequest) => Promise<WorkItem | null>
  moveTask: (id: string, input: MoveWorkItemRequest) => Promise<WorkItem | null>
  /** Takes a task out of view without asking the server (after an archive elsewhere). */
  dropLocal: (id: string) => void
  /** Makes a task the list does not hold (another scope, archived, past the list limit) available to read and edit. */
  adoptTask: (item: WorkItem) => void
  /** Asks the server for one task again and shows its current state, wherever the task is held. */
  refreshTask: (id: string) => Promise<void>
}

const WorkDataContext = createContext<WorkData | null>(null)

export function useWorkData(): WorkData {
  const value = useContext(WorkDataContext)
  if (!value) throw new Error('useWorkData must be used inside WorkDataProvider')
  return value
}

/** A change that puts `item` in place of the task with its id and leaves every other task alone. */
function swapIn(item: WorkItem): (current: WorkItem[]) => WorkItem[] {
  return (current) => current.map((existing) => (existing.id === item.id ? item : existing))
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Loads the tasks for the page's scope and keeps them in step with what the person does: every change appears at once,
 * is confirmed by the server's answer, and is rolled back with a message if the server refuses.
 *
 * A change belongs to the view it started in. When the person switches scope or workspace, answers to changes made in
 * the old view are ignored, so they never land in the new one.
 */
export function WorkDataProvider({ children }: { children: ReactNode }) {
  const { listView, scope } = useWorkRoute()
  const { user } = useAuth()
  const { activeWorkspace } = useWorkspace()
  const { access, viewer: accessViewer } = useWorkspaceCreateAccess()
  const [items, setItems] = useState<WorkItem[]>([])
  // Tasks opened by link that the list does not hold. Editable like any other, but never part of the list itself.
  const [extras, setExtras] = useState<ReadonlyMap<string, WorkItem>>(() => new Map())
  const [state, setState] = useState<WorkLoadState>('loading')
  const [context, setContext] = useState<WorkContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const extrasRef = useRef(extras)
  extrasRef.current = extras
  // The newest load wins, and a load never overwrites a change that is still waiting for the server.
  const loadId = useRef(0)
  // Bumped whenever the view changes; a change started in an earlier view is ignored when it answers.
  const view = useRef(0)
  const pending = useRef(0)
  // A refresh is owed once the waiting changes settle (a load arrived meanwhile, or edits overlapped or failed).
  const refreshDue = useRef(false)
  // The newest change to each task. Only its answer is applied, so an earlier answer never lands over a newer edit.
  const newest = useRef(new Map<string, number>())
  const changeCount = useRef(0)

  const load = useCallback(async () => {
    const id = ++loadId.current
    try {
      const [list, ctx] = await Promise.all([
        overlayAppClient.work.list(listView ? { view: listView } : undefined),
        overlayAppClient.work.context().catch(() => null),
      ])
      if (id !== loadId.current) return
      if (pending.current === 0) setItems(list.items)
      else refreshDue.current = true
      if (ctx) setContext(ctx)
      setState('ready')
      setError(null)
    } catch (caught) {
      if (id !== loadId.current) return
      setState((current) => (current === 'ready' ? current : 'error'))
      setError(messageOf(caught, 'Could not load tasks.'))
    }
  }, [listView])

  /** Starts a new view: nothing that is still waiting from the old one counts any more. */
  const resetView = useCallback((options?: { keepExtras?: boolean }) => {
    view.current += 1
    pending.current = 0
    refreshDue.current = false
    newest.current.clear()
    if (!options?.keepExtras) setExtras(new Map())
  }, [])

  useEffect(() => {
    resetView({ keepExtras: true })
    setState('loading')
    void load()
  }, [load, resetView])

  useWorkspaceChanged(useCallback(() => {
    resetView()
    setItems([])
    setContext(null)
    setState('loading')
    void load()
  }, [load, resetView]))

  useEffect(() => {
    const reload = () => void load()
    window.addEventListener(WORK_UPDATED_EVENT, reload)
    return () => window.removeEventListener(WORK_UPDATED_EVENT, reload)
  }, [load])

  useEffect(() => {
    const reloadIdentity = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      if (!workspaceId || workspaceId === activeWorkspace?.id) void load()
    }
    window.addEventListener('overlay:identity-updated', reloadIdentity)
    return () => window.removeEventListener('overlay:identity-updated', reloadIdentity)
  }, [activeWorkspace?.id, load])

  /** One change has settled; when nothing is waiting any more and a refresh is owed, ask the server what is true. */
  const settle = useCallback((startedIn: number) => {
    if (view.current !== startedIn) return
    pending.current -= 1
    if (pending.current === 0 && refreshDue.current) {
      refreshDue.current = false
      void load()
    }
  }, [load])

  /** Applies `change` to a task wherever it is held: the list, or the tasks opened by link. */
  const applyToTask = useCallback((id: string, change: (current: WorkItem[]) => WorkItem[]) => {
    if (itemsRef.current.some((item) => item.id === id)) {
      setItems(change)
      return
    }
    setExtras((current) => {
      const task = current.get(id)
      const next = task ? change([task])[0] : undefined
      return next ? new Map(current).set(id, next) : current
    })
  }, [])

  const findTask = useCallback((id: string) => itemsRef.current.find((item) => item.id === id) ?? extrasRef.current.get(id), [])

  /** Runs `request` with the screen already updated by `optimistic`; puts this one task back if the server refuses. */
  const mutate = useCallback(async (
    id: string,
    optimistic: (current: WorkItem[]) => WorkItem[],
    request: () => Promise<WorkItem>,
    fallback: string,
  ): Promise<WorkItem | null> => {
    const startedIn = view.current
    const before = findTask(id)
    const mine = ++changeCount.current
    // Two changes to one task in flight can finish in either order on the server: check what is true once both settle.
    if (newest.current.has(id)) refreshDue.current = true
    newest.current.set(id, mine)
    pending.current += 1
    applyToTask(id, optimistic)
    try {
      const item = await request()
      if (view.current === startedIn && newest.current.get(id) === mine) applyToTask(id, swapIn(item))
      return item
    } catch (caught) {
      if (view.current === startedIn) {
        // Only this task goes back, and only if nothing newer is waiting on it; everything else stays as it is.
        if (newest.current.get(id) === mine && before) applyToTask(id, swapIn(before))
        else refreshDue.current = true
      }
      toast.error(messageOf(caught, fallback))
      return null
    } finally {
      if (view.current === startedIn && newest.current.get(id) === mine) newest.current.delete(id)
      settle(startedIn)
    }
  }, [applyToTask, findTask, settle])

  const createTask = useCallback<WorkData['createTask']>(async (input) => {
    const scopeToSend = newItemScope(scope)
    const startedIn = view.current
    pending.current += 1
    try {
      const { item } = await overlayAppClient.work.create({ ...input, ...(scopeToSend ? { scope: scopeToSend } : {}) })
      if (view.current === startedIn) setItems((current) => upsertItem(current, item))
      trackWork('work_task_created', { scope: item.scope, status: item.status })
      return item
    } catch (caught) {
      toast.error(messageOf(caught, 'Could not add the task.'))
      return null
    } finally {
      settle(startedIn)
    }
  }, [scope, settle])

  const updateTask = useCallback<WorkData['updateTask']>((id, patch) => {
    const target = findTask(id)
    if (!target) return Promise.resolve(null)
    const endRank = patch.status && patch.status !== target.status ? endRankOf(itemsRef.current, patch.status, id) : undefined
    const change = describeWorkChange(patch)
    trackWork(change.event, change.properties)
    return mutate(
      id,
      (current) => current.map((item) => (item.id === id ? applyItemPatch(item, patch, { now: Date.now(), endRank }) : item)),
      async () => {
        const { item } = await overlayAppClient.work.update(id, patch)
        // The server puts a task that changes column at the end of it; if our guess differed, other ranks may have moved.
        if (endRank !== undefined && item.rank !== endRank) refreshDue.current = true
        return item
      },
      'Could not save that change.',
    )
  }, [findTask, mutate])

  const moveTask = useCallback<WorkData['moveTask']>((id, input) => {
    const target = findTask(id)
    if (!target) return Promise.resolve(null)
    const status = input.status ?? target.status
    const rank = rankForDrop(itemsRef.current, { id, status, afterId: input.afterId, beforeId: input.beforeId })
    trackWork('work_task_moved', { status, changedColumn: status !== target.status })
    return mutate(
      id,
      (current) => current.map((item) => (item.id === id ? { ...item, status, rank, updatedAt: Date.now() } : item)),
      async () => {
        const { item } = await overlayAppClient.work.move(id, input)
        // The server works from the neighbours' live ranks. A different answer means they moved (or the column was
        // renumbered because ranks grew long), so the ranks on screen are out of date.
        if (item.rank !== rank) refreshDue.current = true
        return item
      },
      'Could not move the task.',
    )
  }, [findTask, mutate])

  const dropLocal = useCallback((id: string) => {
    setItems((current) => removeItem(current, id))
    setExtras((current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  const adoptTask = useCallback((item: WorkItem) => {
    if (itemsRef.current.some((existing) => existing.id === item.id)) return
    setExtras((current) => new Map(current).set(item.id, item))
  }, [])

  const refreshTask = useCallback(async (id: string) => {
    const startedIn = view.current
    try {
      const { item } = await overlayAppClient.work.get(id)
      if (view.current !== startedIn) return
      if (itemsRef.current.some((existing) => existing.id === id)) setItems((current) => upsertItem(current, item))
      else setExtras((current) => new Map(current).set(id, item))
    } catch {
      // Keep what is on screen; the next load corrects it.
    }
  }, [])

  useEffect(() => {
    if (state === 'ready') publishSidebarWork(listView, { items, context })
  }, [context, items, listView, state])

  const viewer = useMemo<WorkViewer | null>(
    () => (user?.id && context ? { userId: user.id, principalId: context.principalId } : null),
    [context, user?.id],
  )
  const people = useMemo(() => context?.people ?? [], [context])
  const personByPrincipal = useMemo(() => new Map(people.map((person) => [person.principalId, person])), [people])
  const byId = useMemo(() => {
    const all = new Map(items.map((item) => [item.id, item]))
    for (const [id, item] of extras) if (!all.has(id)) all.set(id, item)
    return all as ReadonlyMap<string, WorkItem>
  }, [extras, items])

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
    refresh: load,
    canWork, createTask, updateTask, moveTask, dropLocal, adoptTask, refreshTask,
  }), [adoptTask, byId, canWork, context, createTask, dropLocal, error, items, load, moveTask, people, personByPrincipal, refreshTask, state, updateTask, viewer])

  return <WorkDataContext.Provider value={value}>{children}</WorkDataContext.Provider>
}
