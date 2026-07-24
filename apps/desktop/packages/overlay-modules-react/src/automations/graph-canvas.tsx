'use client'

import { GitBranch } from 'lucide-react'
import { AutomationFlowPreview, parseAutomationFlow } from './flow-utils'

export function AutomationGraphCanvas({
  source,
}: {
  source: string
  onSourceChange?: (source: string) => void
}) {
  const flow = parseAutomationFlow(source)

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Visual overview of the workflow steps.</p>
      <div className="min-h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
        <div className="flex min-h-72 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-6">
          {flow ? (
            <AutomationFlowPreview flow={flow} />
          ) : (
            <div className="flex max-w-md flex-col items-center gap-2 text-center">
              <GitBranch size={18} strokeWidth={1.75} className="text-[var(--muted)]" />
              <p className="text-sm text-[var(--muted)]">
                No flowchart source defined for this automation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
