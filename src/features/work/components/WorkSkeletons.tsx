'use client'

import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { HeaderSearch } from '@overlay/ui/primitives'
import { PageSubviewTabs } from '@/components/layout/PageSubviewTabs'
import type { WorkView } from '@/shared/work/views'
import { WorkComposerPlaceholder } from './WorkTaskComposer'

/*
 * Work's loading states. Each mirrors the loaded view's own classes (column, gutters, row and card geometry), so data
 * fills in without anything moving. Change one alongside the component it mirrors.
 */

const TITLE_WIDTHS = ['w-2/5', 'w-1/2', 'w-1/3', 'w-[45%]', 'w-[38%]']

function Bar({ className }: { className: string }) {
  return <div className={`ui-skeleton-line rounded-md ${className}`} aria-hidden />
}

/** A zero-width character in the row's font, so a placeholder line box is exactly as tall as the real text. */
function TextBox({ className }: { className: string }) {
  return <span className={className} aria-hidden>{'​'}</span>
}

/** `WorkList`'s group header (chevron, status glyph, label, count) and `WorkRow`s. */
function ListSkeleton() {
  return (
    <div className="pb-10" aria-hidden>
      {[3, 2].map((rows, group) => (
        <div key={group}>
          <div className="flex w-full items-center gap-2.5 px-6 pb-1.5 pt-5">
            <Bar className="size-3.5 shrink-0 rounded-sm" />
            <Bar className="size-4 shrink-0 rounded-full" />
            <TextBox className="text-[13px]" />
            <Bar className={`h-3 ${group === 0 ? 'w-20' : 'w-12'}`} />
          </div>
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="flex h-10 items-center gap-3 px-6">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center"><Bar className="size-4 rounded-full" /></div>
              <div className="min-w-0 flex-1"><Bar className={`h-3 ${TITLE_WIDTHS[(group * 3 + index) % TITLE_WIDTHS.length]}`} /></div>
              <div className="flex shrink-0 items-center gap-3.5">
                <div className="hidden w-14 justify-end sm:flex"><Bar className="h-2.5 w-9" /></div>
                <div className="p-0.5"><Bar className="size-[22px] rounded-full" /></div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** `WorkBoard`'s five columns: header (glyph, label, count) and cards. */
function BoardSkeleton() {
  return (
    <div className="flex h-full min-w-min gap-3.5 px-3 pb-6 pt-4 sm:px-4" aria-hidden>
      {[1, 2, 2, 1, 1].map((cards, column) => (
        <div key={column} className="flex min-h-0 shrink-0 basis-[82vw] flex-col sm:max-w-85 sm:flex-1 sm:shrink sm:basis-59">
          <div className="flex items-center gap-2 px-1.5 pb-2.5">
            <Bar className="size-4 shrink-0 rounded-full" />
            <TextBox className="text-[13px]" />
            <Bar className="h-3 w-16" />
          </div>
          <div className="flex flex-col gap-2 p-0.5 pb-5">
            {Array.from({ length: cards }).map((_, card) => (
              <div key={card} className="flex flex-col gap-2.5 rounded-[10px] border border-(--border) bg-(--surface-elevated) p-3">
                <div className="space-y-1.5 py-0.5">
                  <Bar className="h-3 w-[85%]" />
                  {(column + card) % 2 === 0 ? <Bar className="h-3 w-1/2" /> : null}
                </div>
                <div className="flex h-5 items-center gap-2">
                  <Bar className="size-4 rounded-full" />
                  <span className="flex-1" />
                  <Bar className="size-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** `WorkTimeline`: the 52px week header, then 40px rows of label and bar. */
function TimelineSkeleton() {
  return (
    <div className="h-full overflow-hidden" aria-hidden>
      <div className="flex h-[52px]">
        <div className="w-[132px] shrink-0 sm:w-[300px]" />
        <div className="flex flex-1 gap-6 pt-[9px]">
          {[0, 1, 2, 3].map((week) => <Bar key={week} className="h-3 w-12" />)}
        </div>
      </div>
      {[[8, 30], [22, 26], [4, 40], [30, 22], [14, 34]].map(([left, width], row) => (
        <div key={row} className="flex h-10">
          <div className="flex w-[132px] shrink-0 items-center gap-2.5 pr-4 sm:w-[300px]">
            <div className="min-w-0 flex-1"><Bar className={`h-3 ${['w-3/5', 'w-4/5', 'w-1/2', 'w-2/3', 'w-[70%]'][row]}`} /></div>
            <Bar className="size-5 rounded-full" />
          </div>
          <div className="relative flex-1">
            <div className="ui-skeleton-line absolute top-[9px] h-[22px] rounded-md" style={{ left: `${left}%`, width: `${width}%` }} aria-hidden />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The body of the Work page while tasks load, in the same column as the loaded view. */
export function WorkBodySkeleton({ view }: { view: WorkView }) {
  if (view === 'board') {
    return (
      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-hidden" role="status" aria-label="Loading tasks">
        <BoardSkeleton />
      </div>
    )
  }
  if (view === 'timeline') {
    return (
      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 px-3 sm:px-4" role="status" aria-label="Loading tasks">
        <TimelineSkeleton />
      </div>
    )
  }
  return (
    <div className="mx-auto w-full max-w-4xl px-3 sm:px-4" role="status" aria-label="Loading tasks">
      <ListSkeleton />
    </div>
  )
}

/**
 * The Work route before its code and data load: the real header (breadcrumbs, view tabs, search), the List skeleton
 * and the composer. The route cannot read the view without suspending, so it shows the List, the default view.
 */
export function WorkRouteSkeleton() {
  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title="List"
          tabs={<PageSubviewTabs />}
          search={<HeaderSearch value="" onChange={() => undefined} label="Search tasks" placeholder="Search tasks" />}
        />
      )}
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <WorkBodySkeleton view="list" />
        </div>
        <WorkComposerPlaceholder />
      </AppScreenBody>
    </AppScreenShell>
  )
}

/** One `AgentNode` on the Organization chart: a 30px creature and two lines. */
function AgentNodeSkeleton({ wide = false }: { wide?: boolean }) {
  // The chart's cards are filled, so the bars take the page colour to stay visible on them.
  return (
    <div className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5" aria-hidden>
      <Bar className="size-[30px] shrink-0 rounded-full bg-(--background)" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center"><TextBox className="text-[13px]" /><Bar className={`h-3 bg-(--background) ${wide ? 'w-28' : 'w-20'}`} /></div>
        <div className="mt-0.5 flex items-center"><TextBox className="text-xs" /><Bar className="h-2.5 w-16 bg-(--background)" /></div>
      </div>
    </div>
  )
}

/** The Organization chart while agents load: the chief's card, the connector and a row of agents. */
export function OrganizationChartSkeleton() {
  return (
    <div className="mt-10 flex w-full flex-col items-center" role="status" aria-label="Loading organization">
      <div className="w-full max-w-xs rounded-2xl bg-(--surface-subtle) p-1.5"><AgentNodeSkeleton wide /></div>
      <div aria-hidden className="h-6 w-px bg-(--border)" />
      <div className="grid w-full grid-cols-1 gap-1 rounded-2xl bg-(--surface-subtle) p-1.5 sm:grid-cols-2 lg:grid-cols-3">
        <AgentNodeSkeleton />
        <div className="hidden sm:block"><AgentNodeSkeleton /></div>
        <div className="hidden lg:block"><AgentNodeSkeleton /></div>
      </div>
    </div>
  )
}

/** The Organization route before it loads: the real header, then the centred title, description and chart. */
export function OrganizationSkeleton() {
  return (
    <AppScreenShell header={<AppScreenHeader title="Organization" breadcrumbs={[{ label: 'Work' }]} />}>
      <AppScreenBody padding="none" maxWidth="none" className="min-w-0 overflow-auto">
        <div className="mx-auto flex min-h-full max-w-4xl flex-col items-center px-3 py-10 sm:px-4">
          <div className="flex items-center"><TextBox className="text-lg" /><Bar className="h-4 w-40" /></div>
          <div className="mt-2 flex items-center"><TextBox className="text-sm" /><Bar className="h-3 w-64" /></div>
          <OrganizationChartSkeleton />
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

/** A task or assignment panel's property grid: 30px rows of label and value. */
export function PropertyGridSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="mb-6 grid grid-cols-[92px_minmax(0,1fr)] gap-y-1" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="contents">
          <div className="flex h-[30px] items-center gap-2">
            <Bar className="size-3.5 rounded-sm" />
            <Bar className="h-2.5 w-12" />
          </div>
          <div className="flex h-[30px] items-center">
            <Bar className={`h-3 ${TITLE_WIDTHS[(index + 1) % TITLE_WIDTHS.length]}`} />
          </div>
        </div>
      ))}
    </div>
  )
}
