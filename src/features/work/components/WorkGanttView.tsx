'use client'

import { useMemo, useState } from 'react'
import type { WorkItemDoc, WorkItemStatus } from '@overlay/api-client'
import {
  WORK_ITEM_STATUS_OPTIONS,
  formatWorkItemDay,
  workItemKey,
  workItemStatusDotClass,
} from '@/shared/work/work-item-ui'

const DAY_MS = 86_400_000
const DAY_WIDTH = 36
const ROW_HEIGHT = 36
/** Show at least this much runway either side of today when items leave it empty. */
const PAD_BEFORE_DAYS = 3
const PAD_AFTER_DAYS = 14

function startOfDay(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function toDay(value: string | number): number {
  // Date-only strings ("2026-10-12") parse as UTC midnight; normalize the same way the
  // drawer writes them (new Date(input.value + 'T00:00:00')) so bars line up.
  return startOfDay(new Date(value).getTime())
}

function barStatusClass(status: WorkItemStatus): string {
  switch (status) {
    case 'in_progress':
      return 'border-[#3730a3] bg-[#3730a3]/20 text-[#c7d2fe]'
    case 'in_review':
      return 'border-[#7c4a12] bg-[#7c4a12]/20 text-[#fcd9a8]'
    case 'done':
      return 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)] opacity-50'
    default:
      return 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]'
  }
}

interface ScheduledItem {
  item: WorkItemDoc
  start: number
  end: number
}

/** Gantt chart for work items: a day grid with one bar per scheduled item and an Unscheduled group below. */
export function WorkGanttView({
  items,
  onOpen,
}: {
  items: WorkItemDoc[]
  onOpen: (id: string) => void
}) {
  // Today is captured once per mount; the chart does not need to tick.
  const [today] = useState(() => startOfDay(Date.now()))
  const { days, todayOffset, scheduled, unscheduled, totalWidth } = useMemo(() => {
    const now = today
    const withDates: ScheduledItem[] = []
    const withoutDates: WorkItemDoc[] = []
    for (const item of items) {
      // A single date still draws a one-day bar anchored on that date.
      const start = item.startDate !== undefined ? toDay(item.startDate) : item.dueDate !== undefined ? toDay(item.dueDate) : undefined
      const end = item.dueDate !== undefined ? toDay(item.dueDate) : item.startDate !== undefined ? toDay(item.startDate) : undefined
      if (start === undefined || end === undefined) {
        withoutDates.push(item)
      } else {
        withDates.push({ item, start, end: Math.max(start, end) })
      }
    }

    const startMin = withDates.reduce((acc, entry) => Math.min(acc, entry.start), now - PAD_BEFORE_DAYS * DAY_MS)
    const endMax = withDates.reduce((acc, entry) => Math.max(acc, entry.end), now + PAD_AFTER_DAYS * DAY_MS)
    const first = Math.min(startMin, now - PAD_BEFORE_DAYS * DAY_MS)
    const last = Math.max(endMax, now + PAD_AFTER_DAYS * DAY_MS)
    const count = Math.max(1, Math.round((last - first) / DAY_MS) + 1)

    const dayList = Array.from({ length: count }, (_, i) => first + i * DAY_MS)
    return {
      days: dayList,
      todayOffset: Math.round((now - first) / DAY_MS),
      scheduled: withDates,
      unscheduled: withoutDates,
      totalWidth: count * DAY_WIDTH,
    }
  }, [items, today])

  const isWeekend = (ms: number) => {
    const day = new Date(ms).getDay()
    return day === 0 || day === 6
  }

  const rowLabel = (item: WorkItemDoc) => (
    <>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${workItemStatusDotClass(item.status)}`} />
      <span className="shrink-0 font-mono text-[10px] text-[var(--muted-light)]">{workItemKey(item)}</span>
      <span className="truncate">{item.title}</span>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--border)] text-xs">
      {/* Task column */}
      <div className="w-64 shrink-0 overflow-y-auto border-r border-[var(--border)]">
        <div className="sticky top-0 z-10 h-9 border-b border-[var(--border)] bg-[var(--background)]" />
        {scheduled.map(({ item }) => (
          <button
            key={item._id}
            type="button"
            onClick={() => onOpen(item._id)}
            className="flex h-9 w-full items-center gap-2 border-b border-[var(--border)] px-3 text-left text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            {rowLabel(item)}
          </button>
        ))}
        {unscheduled.length > 0 ? (
          <>
            <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-light)]">
              Unscheduled
            </div>
            {unscheduled.map((item) => (
              <button
                key={item._id}
                type="button"
                onClick={() => onOpen(item._id)}
                className="flex h-9 w-full items-center gap-2 border-b border-[var(--border)] px-3 text-left text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
              >
                {rowLabel(item)}
              </button>
            ))}
          </>
        ) : null}
      </div>

      {/* Timeline */}
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: totalWidth }}>
          <div className="sticky top-0 z-10 flex h-9 border-b border-[var(--border)] bg-[var(--background)]">
            {days.map((ms) => {
              const date = new Date(ms)
              return (
                <div
                  key={ms}
                  className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center border-r border-[var(--border)]/50 text-[9px] ${
                    isWeekend(ms) ? 'text-[var(--muted-light)]/50' : 'text-[var(--muted-light)]'
                  }`}
                >
                  <span>{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                  <span>{date.getDate()}</span>
                </div>
              )
            })}
          </div>

          <div className="relative">
            {/* Weekend + today underlay spanning all rows */}
            <div className="pointer-events-none absolute inset-0 z-0 flex">
              {days.map((ms) => (
                <div
                  key={ms}
                  className={`w-9 shrink-0 ${isWeekend(ms) ? 'bg-[var(--surface-muted)]/40' : ''}`}
                />
              ))}
            </div>
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-[var(--danger)] opacity-70"
              style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }}
            />

            {scheduled.map(({ item, start, end }) => {
              const left = Math.round((start - days[0]) / DAY_MS) * DAY_WIDTH
              const width = (Math.round((end - start) / DAY_MS) + 1) * DAY_WIDTH - 6
              const status = WORK_ITEM_STATUS_OPTIONS.find((entry) => entry.id === item.status)
              return (
                <div key={item._id} className="relative z-[1] border-b border-[var(--border)]" style={{ height: ROW_HEIGHT }}>
                  <button
                    type="button"
                    onClick={() => onOpen(item._id)}
                    title={`${item.title} · ${formatWorkItemDay(start)} – ${formatWorkItemDay(end)}${status ? ` · ${status.label}` : ''}`}
                    className={`absolute top-[9px] flex h-[18px] items-center overflow-hidden whitespace-nowrap rounded-[5px] border px-2 text-[9px] transition-transform hover:z-10 ${barStatusClass(item.status)}`}
                    style={{ left: left + 3, width: Math.max(width, DAY_WIDTH - 6) }}
                  >
                    {item.title}
                  </button>
                </div>
              )
            })}

            {unscheduled.length > 0 ? (
              <>
                <div className="relative z-[1] h-[27px]" />
                {unscheduled.map((item) => (
                  <div
                    key={item._id}
                    className="relative z-[1] flex h-9 items-center border-b border-[var(--border)] px-3 text-[10px] text-[var(--muted-light)]"
                  >
                    <button type="button" onClick={() => onOpen(item._id)} className="hover:text-[var(--muted)]">
                      Set dates to schedule
                    </button>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
