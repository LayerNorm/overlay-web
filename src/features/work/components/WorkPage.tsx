'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertCircle, ListChecks, Plus, X } from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { Button, HeaderSearch } from '@overlay/ui/primitives'
import { toWorkDate } from '@/shared/work/dates'
import { countOpen, filterWork, needsViewer } from '@/shared/work/query'
import { WORK_VIEW_LABELS } from '@/shared/work/views'
import { useWorkRoute } from '../lib/use-work-route'
import { useWorkUrlState } from '../lib/use-work-url-state'
import { useWorkData, WorkDataProvider } from './WorkDataProvider'
import { WorkBoard } from './WorkBoard'
import { WorkList } from './WorkList'
import { WorkPeek } from './WorkPeek'
import { WorkQuickAdd, type WorkQuickAddHandle } from './WorkQuickAdd'
import { WorkToolbar } from './WorkToolbar'

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

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="mx-6 mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
      <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40">
        <X size={14} />
      </button>
    </div>
  )
}

function WorkScreen() {
  const { scope, view, solo } = useWorkRoute()
  const { filter, taskId, setFilter, openTask, closeTask } = useWorkUrlState()
  const { state, items, byId, viewer, error, dismissError, refresh } = useWorkData()
  const [query, setQuery] = useState('')
  const quickAdd = useRef<WorkQuickAddHandle>(null)
  const today = useMemo(() => toWorkDate(new Date()), [])

  const visible = useMemo(() => filterWork(items, { filter, query, viewer }), [filter, items, query, viewer])
  const needsYouCount = useMemo(() => (viewer ? items.filter((item) => needsViewer(item, viewer)).length : 0), [items, viewer])
  const scopeLabel = scope === 'workspace' ? 'Workspace' : 'Personal'
  const title = solo ? WORK_VIEW_LABELS[view] : `${scopeLabel} / ${WORK_VIEW_LABELS[view]}`

  const loaded = state === 'ready'
  const filtering = filter !== 'all' || query.trim() !== ''

  return (
    <AppScreenShell
      rightPanel={taskId ? <WorkPeek key={taskId} taskId={taskId} onClose={closeTask} /> : null}
      rightPanelOpen={Boolean(taskId)}
      rightPanelWidth={520}
      onRightPanelClose={closeTask}
      rightPanelOverlayLabel="Close task"
      header={(
        <AppScreenHeader
          title={title}
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
        <WorkToolbar filter={filter} onChange={setFilter} needsYouCount={needsYouCount} />
        {error && state !== 'error' ? <ErrorBanner message={error} onDismiss={dismissError} /> : null}
        <WorkQuickAdd ref={quickAdd} disabled={!loaded} />
        <div className={`flex min-h-0 flex-1 flex-col ${view === 'list' || !loaded || visible.length === 0 ? 'overflow-auto' : 'overflow-hidden'}`}>
          {state === 'loading' ? <ListSkeleton /> : null}
          {state === 'error' ? (
            <EmptyState
              title="Could not load tasks"
              description="Check your connection, then try again."
              action={<Button variant="secondary" size="sm" onClick={() => void refresh()}>Try again</Button>}
            />
          ) : null}
          {loaded && items.length === 0 ? (
            <EmptyState
              title="No tasks yet"
              description={scope === 'workspace' && !solo ? 'Tasks added to the workspace are shared with its members.' : 'Add a task above. It lands in Todo.'}
            />
          ) : null}
          {loaded && items.length > 0 && visible.length === 0 && filtering ? (
            <EmptyState title="Nothing matches" description="Try another filter or search." />
          ) : null}
          {loaded && visible.length > 0 && view === 'list' ? (
            <WorkList items={visible} byId={byId} today={today} selectedId={taskId} onOpen={openTask} />
          ) : null}
          {loaded && visible.length > 0 && view === 'board' ? (
            <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
              <WorkBoard items={visible} today={today} selectedId={taskId} onOpen={openTask} />
            </div>
          ) : null}
          {loaded && visible.length > 0 && view === 'timeline' ? (
            <EmptyState title="Timeline is on its way" description="The List and Board show every task for now." />
          ) : null}
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

/** The Work page: Personal or Workspace tasks as a List, a Board, or a Timeline. */
export function WorkPage() {
  return (
    <WorkDataProvider>
      <WorkScreen />
    </WorkDataProvider>
  )
}
