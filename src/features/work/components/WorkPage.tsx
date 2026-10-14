'use client'

import { ListChecks } from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { WORK_VIEW_LABELS } from '@/shared/work/views'
import { useWorkRoute } from '../lib/use-work-route'

/** The Work page: Personal or Workspace tasks as a List, a Board, or a Timeline. */
export function WorkPage() {
  const { scope, view, solo } = useWorkRoute()
  const scopeLabel = solo ? 'Work' : scope === 'workspace' ? 'Workspace' : 'Personal'
  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title={solo ? WORK_VIEW_LABELS[view] : `${scopeLabel} / ${WORK_VIEW_LABELS[view]}`}
        />
      )}
    >
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center px-6" data-testid="work-page">
        <div className="max-w-sm text-center">
          <ListChecks className="mx-auto mb-3 text-(--muted-light)" size={22} strokeWidth={1.5} />
          <h2 className="text-sm font-medium text-(--foreground)">No tasks yet</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">
            Tasks you add show up here, as a list, on a board, and on a timeline.
          </p>
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
