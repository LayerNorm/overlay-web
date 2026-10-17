'use client'
import { unstyledButton } from '../../control-reset'
import { Button } from '@overlay/ui/primitives'

import { WORK_FILTERS, WORK_FILTER_LABELS, type WorkFilter } from '@/shared/work/query'

/** Everything, Needs you, Assigned to me. */
export function WorkToolbar({
  filter,
  onChange,
  needsYouCount,
}: {
  filter: WorkFilter
  onChange: (filter: WorkFilter) => void
  needsYouCount: number
}) {
  return (
    <div role="group" aria-label="Filter tasks" className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-(--border) px-6 py-3 scrollbar-none">
      {WORK_FILTERS.map((id) => {
        const active = filter === id
        const count = id === 'needs-you' ? needsYouCount : 0
        return (
          <Button variant="ghost"
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={unstyledButton(`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors ${
              active
                ? 'border-(--muted-light) bg-(--surface-subtle) text-(--foreground)'
                : 'border-(--border) text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)'
            }`)}
          >
            {count > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-violet-600 dark:bg-violet-400" aria-hidden /> : null}
            {WORK_FILTER_LABELS[id]}
            {count > 0 ? <span className="opacity-60">{count}</span> : null}
          </Button>
        )
      })}
    </div>
  )
}
