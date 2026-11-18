'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, CircleAlert, LoaderCircle } from 'lucide-react'
import type { AutomationRunSummary } from '@overlay/app-core'
import { formatAutomationRunError } from '@overlay/app-core/automations'
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Input } from '@overlay/ui/primitives'
import { formatRunTime } from '../lib/automation-schedule'

/** The name in the panel's hero, edited in place like an agent's name. */
export function InlineName({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = useRef(false)
  const finish = (commit: boolean) => {
    if (!editing.current) return
    editing.current = false
    const next = draft?.trim()
    if (commit && next && next !== value) onCommit(next)
    setDraft(null)
  }
  if (draft === null) {
    return (
      <Button
        variant="ghost"
        type="button"
        aria-label="Edit automation name"
        onClick={() => { editing.current = true; setDraft(value) }}
        className="h-auto max-w-full rounded-md px-2 py-0.5 text-lg font-medium leading-6 text-(--foreground) hover:bg-(--surface-subtle)"
      >
        <span className="line-clamp-2">{value}</span>
      </Button>
    )
  }
  return (
    <Input
      autoFocus
      aria-label="Automation name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); finish(false) }
        else if (event.key === 'Enter') { event.preventDefault(); finish(true) }
      }}
      className="h-8 text-center text-lg font-medium"
    />
  )
}

export function DetailsDisclosure({ label, summary, children }: { label: string; summary?: string; children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          className="group/details-disclosure h-8 w-full justify-start rounded-md px-1 text-left text-xs font-medium text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)"
        >
          <span className="shrink-0">{label}</span>
          {summary ? (
            <span className="ml-auto min-w-0 flex-1 truncate pl-3 text-right font-normal text-(--muted-light) group-data-[state=open]/details-disclosure:hidden">
              {summary}
            </span>
          ) : null}
          <ChevronRight
            size={14}
            className={'shrink-0 transition-transform duration-200 group-data-[state=open]/details-disclosure:rotate-90 ' + (summary ? 'ml-2 group-data-[state=open]/details-disclosure:ml-auto' : 'ml-auto')}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}

type RunTone = 'completed' | 'failed' | 'running' | 'other'

function runTone(status: AutomationRunSummary['status']): RunTone {
  if (status === 'completed' || status === 'succeeded') return 'completed'
  if (status === 'failed' || status === 'dead_letter') return 'failed'
  if (status === 'queued' || status === 'running' || status === 'cancel_requested') return 'running'
  return 'other'
}

const RUN_LABELS: Record<Exclude<RunTone, 'failed'>, string> = { completed: 'Completed', running: 'Running', other: 'Skipped' }

export function RunRow({ run, onRetry }: { run: AutomationRunSummary; onRetry: () => void }) {
  const tone = runTone(run.status)
  const Icon = tone === 'failed' ? CircleAlert : tone === 'running' ? LoaderCircle : Check
  const label = run.status === 'cancelled' ? 'Cancelled' : tone === 'failed' ? null : RUN_LABELS[tone]
  const error = tone === 'failed' ? formatAutomationRunError(run.errorMessage ?? run.error) : null
  return (
    <li className="flex h-8 items-center gap-2 px-1 text-xs" title={error ?? undefined}>
      <span className="agent-thread-status" data-status={tone === 'failed' ? 'failed' : undefined}>
        <Icon size={13} aria-hidden className={tone === 'running' ? 'animate-spin motion-reduce:animate-none' : undefined} />
      </span>
      <span className="min-w-0 flex-1 truncate text-(--foreground)">
        {formatRunTime(run.startedAt ?? run.scheduledFor ?? run.createdAt)}
      </span>
      {label === null ? (
        <Button type="button" variant="ghost" size="xs" onClick={onRetry} className="h-6 px-2 text-(--muted)">Retry</Button>
      ) : (
        <span className={'agent-activity-count shrink-0 ' + (tone === 'running' ? '' : 'text-(--muted-light)')}>{label}</span>
      )}
    </li>
  )
}
