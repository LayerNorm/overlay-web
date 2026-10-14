'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { WORK_STATUS_LABELS } from '@/shared/work/status'
import { groupByStatus, parentTitle as parentTitleOf } from '@/shared/work/query'
import type { WorkItem, WorkStatus } from '@overlay/app-core'
import { WorkRow } from './WorkRow'
import { StatusIcon } from './work-ui'

/** Tasks grouped by status, what needs attention first. Finished work starts collapsed. */
export function WorkList({
  items,
  byId,
  today,
  selectedId,
  onOpen,
}: {
  items: WorkItem[]
  byId: ReadonlyMap<string, WorkItem>
  today: string
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const groups = useMemo(() => groupByStatus(items), [items])
  const [closed, setClosed] = useState<Partial<Record<WorkStatus, boolean>>>({ done: true })

  return (
    <div role="table" aria-label="Tasks" data-testid="work-list" className="pb-10">
      {groups.map((group) => {
        const collapsed = closed[group.status] === true
        return (
          <section key={group.status} role="rowgroup" data-testid={`work-group-${group.status}`}>
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() => setClosed((current) => ({ ...current, [group.status]: !collapsed }))}
              className="flex w-full items-center gap-2.5 px-6 pb-1.5 pt-5 text-left text-[13px] font-medium text-(--foreground)"
            >
              <ChevronDown size={14} className={`text-(--muted-light) transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden />
              <StatusIcon status={group.status} />
              <span>{WORK_STATUS_LABELS[group.status]}</span>
              <span className="font-normal text-(--muted-light)">{group.items.length}</span>
            </button>
            {collapsed ? null : group.items.map((item) => (
              <WorkRow
                key={item.id}
                item={item}
                parentTitle={parentTitleOf(item, byId)}
                today={today}
                selected={item.id === selectedId}
                onOpen={onOpen}
              />
            ))}
          </section>
        )
      })}
    </div>
  )
}
