'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ChartGantt,
  GanttChart,
  KanbanSquare,
  List,
  Loader2,
  Plus,
  Search,
} from 'lucide-react'
import type { OverlaySidebarAction } from '@overlay/app-core'
import type { WorkItemDoc, WorkItemPriority, WorkItemStatus } from '@overlay/api-client'
import { ListboxSelect } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { listViewForScope, scopeForNewItem, type PanelScope } from '@/shared/workspaces/panel-scope'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  formatWorkItemDate,
  workItemInitials,
  workItemKey,
  workItemPriorityClass,
  workItemStatusPillClass,
} from '@/shared/work/work-item-ui'
import { WorkItemDrawer } from '@/features/work/components/WorkItemDrawer'

type WorkViewKind = 'list' | 'board' | 'gantt'

const VIEW_TABS: { id: WorkViewKind; label: string; icon: typeof List }[] = [
  { id: 'list', label: 'Tasks', icon: List },
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'gantt', label: 'Gantt chart', icon: ChartGantt },
]

function resolveView(raw: string | null): WorkViewKind {
  return raw === 'board' || raw === 'gantt' ? raw : 'list'
}

function memberLabel(members: Record<string, string>, userId: string | undefined): string {
  if (!userId) return 'Unassigned'
  return members[userId] ?? 'Member'
}

function WorkViewInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const scope = usePanelScope() as PanelScope
  const solo = useIsSoloWorkspace()

  const view = resolveView(searchParams?.get('view') ?? null)
  const activeItemId = searchParams?.get('item')
  const [items, setItems] = useState<WorkItemDoc[] | null>(null)
  const [members, setMembers] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const newInputRef = useRef<HTMLInputElement>(null)

  const headers = useMemo(
    () => (activeWorkspaceId ? { headers: { [ACTIVE_WORKSPACE_HEADER]: activeWorkspaceId } } : undefined),
    [activeWorkspaceId],
  )

  const load = useCallback(() => {
    const viewParam = listViewForScope(scope, solo)
    return overlayAppClient.workItems
      .list<WorkItemDoc[]>(viewParam ? { view: viewParam } : undefined, headers)
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
  }, [scope, solo, headers])

  useEffect(() => {
    setItems(null)
    void load()
  }, [load])

  useEffect(() => {
    if (!activeWorkspaceId) return
    overlayAppClient.workspaces
      .management(activeWorkspaceId, 'people')
      .then((data) => {
        const map: Record<string, string> = {}
        for (const entry of data?.items ?? []) {
          if (entry.kind === 'member' && entry.principalId) map[entry.principalId] = entry.name ?? 'Member'
        }
        setMembers(map)
      })
      .catch(() => {})
  }, [activeWorkspaceId])

  // The "New task" sidebar action focuses the inline create row.
  useEffect(() => {
    const onSidebarAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: OverlaySidebarAction }>).detail?.action
      if (action?.actionKey !== 'work.create') return
      if (view !== 'list') setView('list')
      window.setTimeout(() => newInputRef.current?.focus(), 0)
    }
    window.addEventListener('overlay:sidebar-action', onSidebarAction)
    return () => window.removeEventListener('overlay:sidebar-action', onSidebarAction)
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (value === null) params.delete(key)
    else params.set(key, value)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname ?? '/app/work', { scroll: false })
  }, [pathname, router, searchParams])

  const setView = useCallback((next: WorkViewKind) => setParam('view', next === 'list' ? null : next), [setParam])
  const openItem = useCallback((id: string) => setParam('item', id), [setParam])
  const closeItem = useCallback(() => setParam('item', null), [setParam])

  const patchItem = useCallback((itemId: string, patch: Partial<WorkItemDoc>) => {
    setItems((prev) => prev?.map((item) => (item._id === itemId ? { ...item, ...patch } : item)) ?? prev)
  }, [])

  const updateItem = useCallback(async (itemId: string, patch: { status?: WorkItemStatus; priority?: WorkItemPriority }) => {
    patchItem(itemId, patch as Partial<WorkItemDoc>)
    try {
      await overlayAppClient.workItems.update({ itemId, ...patch }, headers)
    } catch {
      void load()
    }
  }, [headers, load, patchItem])

  const createItem = useCallback(async () => {
    const title = newTitle.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      await overlayAppClient.workItems.create({
        title,
        ...(scopeForNewItem(scope) === 'workspace' ? { scope: 'workspace' as const } : {}),
      }, headers)
      setNewTitle('')
      void load()
    } finally {
      setCreating(false)
    }
  }, [creating, headers, load, newTitle, scope])

  const visibleItems = useMemo(() => {
    const list = (items ?? []).filter((item) => !item.deletedAt && !item.archivedAt)
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((item) =>
      item.title.toLowerCase().includes(q) || workItemKey(item).toLowerCase().includes(q))
  }, [items, query])

  return (
    <AppScreenShell
      rightPanel={
        activeItemId ? (
          <WorkItemDrawer
            itemId={activeItemId}
            headers={headers}
            members={members}
            onClose={closeItem}
            onChanged={(patch) => { patchItem(activeItemId, patch) }}
            onDeleted={() => {
              setItems((prev) => prev?.filter((item) => item._id !== activeItemId) ?? prev)
              closeItem()
              void load()
            }}
          />
        ) : null
      }
      rightPanelOpen={Boolean(activeItemId)}
      onRightPanelClose={closeItem}
      rightPanelWidth="md"
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden">
        <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col px-4 py-6 sm:px-6">
          <header className="mb-5 flex items-center justify-between gap-4">
            <h1 className="text-xl font-medium tracking-tight" style={{ fontFamily: 'var(--font-serif)' }}>
              {scope === 'workspace' ? 'Workspace work' : 'Personal work'}
            </h1>
            <nav className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-1">
              {VIEW_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                    view === id
                      ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <Icon size={13} strokeWidth={1.75} />
                  {label}
                </button>
              ))}
            </nav>
          </header>

          {view !== 'list' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border)] text-center">
              {view === 'board'
                ? <KanbanSquare size={22} strokeWidth={1.5} className="text-[var(--muted-light)]" />
                : <GanttChart size={22} strokeWidth={1.5} className="text-[var(--muted-light)]" />}
              <p className="text-sm text-[var(--muted)]">
                {view === 'board' ? 'The board view is on the way.' : 'The Gantt chart is on the way.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative w-56">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter tasks"
                    className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface-muted)] pl-7 pr-2 text-xs outline-none placeholder:text-[var(--muted-light)] focus:border-[var(--muted-light)]"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--muted-light)]">
                      <th className="w-20 px-3 py-2 font-normal">Key</th>
                      <th className="px-3 py-2 font-normal">Title</th>
                      <th className="w-28 px-3 py-2 font-normal">Assignee</th>
                      <th className="w-24 px-3 py-2 font-normal">Priority</th>
                      <th className="w-28 px-3 py-2 font-normal">Status</th>
                      <th className="w-24 px-3 py-2 font-normal">Due</th>
                      <th className="w-24 px-3 py-2 font-normal">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items === null ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                          <Loader2 size={14} className="mr-2 inline animate-spin" /> Loading work…
                        </td>
                      </tr>
                    ) : visibleItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                          {query ? 'No tasks match that filter.' : 'No tasks yet. Create the first one below.'}
                        </td>
                      </tr>
                    ) : (
                      visibleItems.map((item) => (
                        <tr
                          key={item._id}
                          onClick={() => openItem(item._id)}
                          className={`cursor-pointer border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-subtle)] ${
                            activeItemId === item._id ? 'bg-[var(--surface-subtle)]' : ''
                          }`}
                        >
                          <td className="px-3 py-2">
                            <span className="font-mono text-[11px] text-[var(--muted)]">{workItemKey(item)}</span>
                          </td>
                          <td className="max-w-0 truncate px-3 py-2 text-[13px] text-[var(--foreground)]">
                            {item.title}
                          </td>
                          <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                            {item.assigneeUserId ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[9px] font-medium text-[var(--foreground)]">
                                  {workItemInitials(memberLabel(members, item.assigneeUserId))}
                                </span>
                                <span className="max-w-[64px] truncate">{memberLabel(members, item.assigneeUserId)}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--muted-light)]">Unassigned</span>
                            )}
                          </td>
                          <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                            <ListboxSelect
                              aria-label="Priority"
                              value={item.priority}
                              options={WORK_ITEM_PRIORITIES.map((p) => ({ value: p.id, label: p.label }))}
                              onChange={(priority) => void updateItem(item._id, { priority })}
                              className="w-fit"
                              buttonClassName={`h-7 gap-1 border-0 px-1.5 text-xs hover:bg-[var(--surface-muted)] ${workItemPriorityClass(item.priority)}`}
                              menuClassName="min-w-32"
                            />
                          </td>
                          <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                            <ListboxSelect
                              aria-label="Status"
                              value={item.status}
                              options={WORK_ITEM_STATUSES.map((s) => ({ value: s.id, label: s.label }))}
                              onChange={(status) => void updateItem(item._id, { status })}
                              className="w-fit"
                              buttonClassName={`h-6 rounded-full border px-2 text-[11px] ${workItemStatusPillClass(item.status)}`}
                              menuClassName="min-w-32"
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-[var(--muted)]">{formatWorkItemDate(item.dueDate)}</td>
                          <td className="px-3 py-2 text-xs text-[var(--muted)]">{formatWorkItemDate(item.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2">
                  <Plus size={13} className="text-[var(--muted-light)]" />
                  <input
                    ref={newInputRef}
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void createItem() }}
                    placeholder={creating ? 'Creating…' : 'New task'}
                    disabled={creating}
                    className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-light)] disabled:opacity-60"
                  />
                  {newTitle.trim() ? (
                    <button
                      type="button"
                      onClick={() => void createItem()}
                      className="rounded-md bg-[var(--surface-subtle)] px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                    >
                      Create
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </AppScreenBody>

    </AppScreenShell>
  )
}

export function WorkView() {
  return (
    <Suspense fallback={null}>
      <WorkViewInner />
    </Suspense>
  )
}
