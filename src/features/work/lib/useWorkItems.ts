'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateWork, WorkItem, WorkPatch, WorkView, WorkPlacement } from '@overlay/app-core/work'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { rankBetween } from '@/shared/work/rank'
import { WORK_UPDATED_EVENT } from '@/shared/work/status'

export function notifyWorkChanged(workspaceId: string) {
  window.dispatchEvent(new CustomEvent(WORK_UPDATED_EVENT, { detail: workspaceId }))
  try { window.localStorage.setItem('overlay:work-version', `${workspaceId}:${Date.now()}:${Math.random()}`) } catch { /* Storage may be blocked. Focus refresh remains available. */ }
}
export function useWorkItems(workspaceId: string | null, view: WorkView | undefined) {
  const key = `${workspaceId ?? ''}:${view ?? 'all'}`
  const [state, setState] = useState<{ key: string; items: WorkItem[]; error: string | null }>({ key: '', items: [], error: null })
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const version = useRef(0)
  const contextVersion = useRef(0)
  const pendingRef = useRef(new Set<string>())
  const controller = useRef<AbortController | null>(null)
  const init = useCallback(() => ({ headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId ?? '' }, cache: 'no-store' as const }), [workspaceId])
  const refresh = useCallback(async () => {
    if (!workspaceId || [...pendingRef.current].some((entry) => entry.startsWith(`${key}|`))) return
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    const current = ++version.current
    try {
      const items = await overlayAppClient.work.list(view, { ...init(), signal: request.signal })
      if (current === version.current) setState({ key, items, error: null })
    } catch (error) {
      if (request.signal.aborted || current !== version.current) return
      setState((old) => ({ key, items: old.key === key ? old.items : [], error: error instanceof Error ? error.message : 'Work couldn’t load.' }))
    }
  }, [workspaceId, view, init, key])
  const invalidate = useCallback(() => { contextVersion.current++; version.current++; controller.current?.abort() }, [])
  useEffect(() => {
    contextVersion.current++
    void refresh()
    const changed = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail === workspaceId) void refresh()
    }
    const storage = (event: StorageEvent) => { if (event.key === 'overlay:work-version' && event.newValue?.startsWith(`${workspaceId}:`)) void refresh() }
    const focus = () => { void refresh() }
    window.addEventListener(WORK_UPDATED_EVENT, changed); window.addEventListener('storage', storage); window.addEventListener('focus', focus)
    return () => {
      invalidate()
      window.removeEventListener(WORK_UPDATED_EVENT, changed); window.removeEventListener('storage', storage); window.removeEventListener('focus', focus)
    }
  }, [refresh, workspaceId, invalidate])
  const busy = (id: string, value: boolean) => {
    const pendingKey = `${key}|${id}`
    if (value) pendingRef.current.add(pendingKey); else pendingRef.current.delete(pendingKey)
    setPending(new Set(pendingRef.current))
  }
  async function create(body: CreateWork) {
    if (!workspaceId) throw new Error('Choose a workspace')
    if (pendingRef.current.has(`${key}|new`)) throw new Error('A task is being added')
    const captured = contextVersion.current
    busy('new', true); ++version.current
    try {
      const saved = await overlayAppClient.work.create(body, init())
      if (captured === contextVersion.current) setState((old) => ({ key, items: [...(old.key === key ? old.items : []), saved], error: null }))
      notifyWorkChanged(workspaceId)
      return saved
    } finally { busy('new', false); if (captured === contextVersion.current) void refresh() }
  }
  async function update(item: WorkItem, patch: WorkPatch) {
    if (pendingRef.current.has(`${key}|${item._id}`)) throw new Error('This task is being saved')
    const captured = contextVersion.current
    busy(item._id, true); ++version.current; controller.current?.abort()
    // Nullable optional fields are normalized only by the backend; keep the optimistic projection narrow.
    setState((old) => old.key !== key ? old : { ...old, items: old.items.map((row) => row._id === item._id ? { ...row, ...(patch.startDate !== undefined ? { startDate: patch.startDate ?? undefined } : {}), ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ?? undefined } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.title ? { title: patch.title } : {}), ...(patch.assigneePrincipalId !== undefined ? { assigneePrincipalId: patch.assigneePrincipalId ?? undefined } : {}) } : row) })
    try {
      const saved = await overlayAppClient.work.update(item._id, { expectedUpdatedAt: item.updatedAt, patch }, init())
      if (captured === contextVersion.current) setState((old) => old.key !== key ? old : { ...old, items: old.items.map((row) => row._id === item._id ? saved : row) })
      notifyWorkChanged(item.workspaceId)
      return saved
    } catch (error) {
      if (captured === contextVersion.current) setState((old) => old.key !== key ? old : { ...old, items: old.items.map((row) => row._id === item._id ? item : row), error: error instanceof Error ? error.message : 'Could not save task.' })
      throw error
    } finally { busy(item._id, false); if (captured === contextVersion.current) void refresh() }
  }
  async function move(item: WorkItem, placement: Omit<WorkPlacement, 'action' | 'expectedUpdatedAt'>) {
    if (pendingRef.current.has(`${key}|${item._id}`)) throw new Error('This task is being saved')
    const captured = contextVersion.current
    busy(item._id, true); ++version.current; controller.current?.abort()
    let rank = item.rank
    try { rank = rankBetween(state.items.find((row) => row._id === placement.beforeId)?.rank, state.items.find((row) => row._id === placement.afterId)?.rank) } catch { /* Backend rebalances exhausted/equal gaps. */ }
    setState((old) => old.key !== key ? old : { ...old, items: old.items.map((row) => row._id === item._id ? { ...row, status: placement.status, rank } : row) })
    try {
      const { item: saved } = await overlayAppClient.work.reorder(item._id, { ...placement, expectedUpdatedAt: item.updatedAt }, init())
      if (captured === contextVersion.current) setState((old) => old.key !== key ? old : { ...old, items: old.items.map((row) => row._id === item._id ? saved : row) })
      notifyWorkChanged(item.workspaceId)
      return saved
    } catch (e) {
      if (captured === contextVersion.current) setState((old) => old.key !== key ? old : { ...old, items: old.items.map((row) => row._id === item._id ? item : row) })
      throw e
    } finally { busy(item._id, false); if (captured === contextVersion.current) void refresh() }
  }
  return { items: state.key === key ? state.items : [], loading: state.key !== key, error: state.key === key ? state.error : null, pending: new Set([...pending].filter((entry) => entry.startsWith(`${key}|`)).map((entry) => entry.slice(key.length + 1))), create, update, move, refresh, init }
}
