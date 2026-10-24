'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ListChecks, Plus } from 'lucide-react'
import type { WorkItem } from '@overlay/app-core'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { WorkRefreshErrorNotice } from './WorkRefreshErrorNotice'
import { Button, HeaderSearch } from '@overlay/ui/primitives'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { requireShortcutHotkey } from '@/shared/shortcuts/shortcut-registry'
import { toWorkDate } from '@/shared/work/dates'
import { countOpen, filterWork } from '@/shared/work/query'
import { WORK_LIMITS } from '@/shared/work/status'
import { WORK_VIEW_LABELS, type WorkView } from '@/shared/work/views'
import { trackWork } from '../lib/work-analytics'
import { useWorkRoute } from '../lib/use-work-route'
import { useWorkUrlState } from '../lib/use-work-url-state'
import { useWorkData, WorkDataProvider } from './WorkDataProvider'
import { WorkBoard } from './WorkBoard'
import { WorkList } from './WorkList'
import { WorkPeek } from './WorkPeek'
import { WorkQuickAdd, type WorkQuickAddHandle } from './WorkQuickAdd'
import { WorkTimeline } from './WorkTimeline'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'

function ListSkeleton() {
  return (
    <div className="px-6 pt-5" role="status" aria-label="Loading tasks">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex h-10 items-center gap-3 border-b border-(--border)/60" aria-hidden>
          <div className="ui-skeleton-line h-4 w-4 shrink-0 rounded-full" />
          <div className={`ui-skeleton-line h-3 rounded-md ${index % 3 === 0 ? 'w-2/5' : index % 3 === 1 ? 'w-1/2' : 'w-1/3'}`} />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16" data-testid="work-empty">
      <div className="max-w-sm text-center">
        <ListChecks className="mx-auto mb-3 text-(--muted-light)" size={22} strokeWidth={1.5} aria-hidden />
        <h2 className="text-sm font-medium text-(--foreground)">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-(--muted)">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  )
}

/** What fills the page under the toolbar: a loading state, a message, or the List, Board, or Timeline. */
function WorkBody({
  view,
  scope,
  solo,
  visible,
  filtering,
  today,
  selectedId,
  onOpen,
}: {
  view: WorkView
  scope: PanelScope
  solo: boolean
  visible: WorkItem[]
  filtering: boolean
  today: string
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const { state, items, byId, refresh } = useWorkData()
  if (state === 'loading') return <ListSkeleton />
  if (state === 'error') {
    return (
      <EmptyState
        title="Could not load tasks"
        description="Check your connection, then try again."
        action={<Button variant="secondary" size="sm" onClick={() => void refresh()}>Try again</Button>}
      />
    )
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No tasks yet"
        description={scope === 'workspace' && !solo ? 'Tasks added to the workspace are shared with its members.' : 'Add a task above. It lands in Todo.'}
      />
    )
  }
  if (visible.length === 0) return filtering ? <EmptyState title="Nothing matches" description="Try another search." /> : null
  if (view === 'board') {
    return (
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <WorkBoard items={visible} today={today} selectedId={selectedId} onOpen={onOpen} />
      </div>
    )
  }
  if (view === 'timeline') {
    return (
      <div className="min-h-0 flex-1">
        <WorkTimeline items={visible} today={today} selectedId={selectedId} onOpen={onOpen} />
      </div>
    )
  }
  return <WorkList items={visible} byId={byId} today={today} selectedId={selectedId} onOpen={onOpen} />
}

function WorkScreen() {
  const { scope, view, solo } = useWorkRoute()
  const { taskId, openTask, closeTask } = useWorkUrlState()
  const { state, items, viewer, error, refresh, truncated } = useWorkData()
  const [query, setQuery] = useState('')
  const quickAdd = useRef<WorkQuickAddHandle>(null)
  const today = useMemo(() => toWorkDate(new Date()), [])

  useEffect(() => { trackWork('work_view_opened', { view, scope }) }, [scope, view])
  // C starts a new task from anywhere on the page (typing in a field is left alone).
  useHotkeys(requireShortcutHotkey('work.new'), () => quickAdd.current?.focus(), { preventDefault: true })

  const visible = useMemo(() => filterWork(items, { filter: 'all', query, viewer }), [items, query, viewer])
  const title = WORK_VIEW_LABELS[view]
  const selectedTask = items.find((item) => item.id === taskId)
  const loaded = state === 'ready'
  // The List scrolls the page; the Board and Timeline scroll inside their own area.
  const pageScrolls = view === 'list' || !loaded || visible.length === 0

  return (
    <AppScreenShell
      rightPanel={taskId ? <WorkPeek key={taskId} taskId={taskId} onClose={closeTask} /> : null}
      rightPanelOpen={Boolean(taskId)}
      rightPanelWidth={520}
      onRightPanelClose={closeTask}
      rightPanelOverlayLabel="Close task"
      header={(
        <AppScreenHeader
          title={selectedTask?.title ?? title}
          breadcrumbs={selectedTask ? [{ label: title }] : undefined}
          tabs={<PageSubviewTabs />}
          metadata={loaded ? <span className="text-xs text-(--muted-light)">{countOpen(items)} open</span> : undefined}
          search={<HeaderSearch value={query} onChange={setQuery} label="Search tasks" placeholder="Search tasks" />}
          actions={(
            <Button variant="primary" size="sm" onClick={() => quickAdd.current?.focus()} data-testid="work-new-task">
              <Plus size={14} aria-hidden />
              New task
            </Button>
          )}
        />
      )}
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex h-full min-h-0 flex-col" data-testid="work-page">
        {truncated ? <p className="mx-6 mt-3 shrink-0 text-xs text-(--muted)" role="note">Showing the first {WORK_LIMITS.listCap.toLocaleString('en-US')} tasks. Archive finished work to see the rest.</p> : null}
        {state !== 'error' ? <WorkRefreshErrorNotice error={error} onRetry={() => void refresh()} /> : null}
        <WorkQuickAdd ref={quickAdd} disabled={!loaded} />
        <div className={`flex min-h-0 flex-1 flex-col ${pageScrolls ? 'overflow-auto' : 'overflow-hidden'}`}>
          <WorkBody
            view={view}
            scope={scope}
            solo={solo}
            visible={visible}
            filtering={query.trim() !== ''}
            today={today}
            selectedId={taskId}
            onOpen={openTask}
          />
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

function WorkUnavailable() {
  return (
    <AppScreenShell>
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-(--foreground)">Work unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-(--muted)">Work is turned off for this deployment.</p>
          <Link href="/app/agents" className="mt-5 inline-flex h-9 items-center rounded-md border border-(--border) px-4 text-sm font-medium text-(--foreground) transition-colors hover:bg-(--surface-subtle)">Open Agents</Link>
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

/**
 * The Work page: Personal or Workspace tasks as a List, a Board, or a Timeline.
 *
 * The capability gate lives here, on the client, because the route's static shell is prerendered at
 * build time, when runtime feature flags are not yet known. `fallback` is shown until they load.
 */
export function WorkPage({ fallback }: { fallback: ReactNode }) {
  const { capabilities, isLoading } = useOverlayCapabilities()
  if (isLoading) return fallback
  if (!capabilities.work) return <WorkUnavailable />
  return (
    <WorkDataProvider>
      <WorkScreen />
    </WorkDataProvider>
  )
}
