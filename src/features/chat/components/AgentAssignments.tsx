'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { ThreadActivityIndicator } from '@/components/layout/sidebar/ThreadActivityIndicator'
import { THREAD_ACTIVITY_LABELS, type ThreadActivityStatus } from '@/shared/agents/thread-activity'
import type { AssignmentOrigin } from '@/shared/work/assignment-execution'

function assignmentActivityStatus(status: string): ThreadActivityStatus {
  switch (status) {
    case 'queued':
    case 'publication_pending':
    case 'running':
    case 'waiting_for_children': return 'working'
    case 'waiting_for_input':
    case 'waiting_for_approval':
    case 'waiting_for_authorization':
    case 'waiting_for_resources': return 'needs_input'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'idle'
  }
}

export type AssignmentNavigation = {
  assignmentId: string
  title: string
  href: string
}

export type AssignmentNavigationItem = AssignmentNavigation & {
  agentName: string
  status: string
  disposition?: string
  dispositionReason?: string
}

export function AgentAssignments({ parent, assignments, origin }: {
  parent: AssignmentNavigation | null
  assignments: AssignmentNavigationItem[]
  origin?: AssignmentOrigin
}) {
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  if (!parent && assignments.length === 0 && !origin) return null
  const completed = assignments.filter(item => item.status === 'completed').length
  return (
    <section aria-label="Delegated work" className="my-3 min-w-0 space-y-3">
      {origin ? <p className="px-2 text-xs text-(--muted)">Origin: Slack · {origin.channelName ? `#${origin.channelName.replace(/^#/, '')}` : origin.channelId}</p> : null}
      {parent ? (
        <Button asChild variant="ghost" className="h-auto max-w-full justify-start gap-2 px-2 py-2 text-left font-normal">
          <Link href={parent.href} title={`Back to ${parent.title}`}>
            <ArrowLeft size={14} aria-hidden className="shrink-0 text-(--muted)" />
            <span className="min-w-0">
              <span className="block text-[11px] text-(--muted)">Assigned from</span>
              <span className="block truncate text-sm">{parent.title}</span>
            </span>
          </Link>
        </Button>
      ) : null}
      {assignments.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-(--border) bg-(--surface-subtle)/30">
          <Button variant="ghost" className="h-auto w-full justify-start gap-2 rounded-none px-3 py-3 font-normal"
            aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
            <GitBranch size={15} aria-hidden className="shrink-0 text-(--muted)" />
            <span className="min-w-0 flex-1 text-left text-sm">Assignments</span>
            <span className="text-xs text-(--muted)">{completed}/{assignments.length} completed</span>
            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          </Button>
          <ul id={listId} hidden={!expanded} className="border-t border-(--border) p-1">
            {assignments.map(item => {
              const status = assignmentActivityStatus(item.status)
              return (
                <li key={item.assignmentId}>
                  <Button asChild variant="ghost" className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal">
                    <Link href={item.href} aria-label={`${item.title}, ${item.agentName}, ${THREAD_ACTIVITY_LABELS[status]}`}>
                      <ThreadActivityIndicator status={status} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm" title={item.title}>{item.title}</span>
                        <span className="block truncate text-xs text-(--muted)">{item.agentName} · {THREAD_ACTIVITY_LABELS[status]}</span>
                        {item.disposition === 'excluded' ? <span className="block text-xs text-(--muted)">Excluded: {item.dispositionReason}</span> : null}
                      </span>
                      <ArrowUpRight size={14} aria-hidden className="shrink-0 text-(--muted)" />
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
