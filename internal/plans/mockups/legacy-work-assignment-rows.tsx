/** The rows PR #409 shipped before the Work redesign, kept only so mockups can show the before state. */
import * as React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { ThreadActivityIndicator } from '../../../src/components/layout/sidebar/ThreadActivityIndicator'
import { THREAD_ACTIVITY_LABELS, resolveThreadActivity } from '../../../src/shared/agents/thread-activity'
import type { AssignmentExecution } from '../../../src/shared/work/assignment-execution'

export function LegacyAssignmentRows({ items }: { items: AssignmentExecution[] }) {
  return <ul className="divide-y divide-(--border)/60">
    {items.map(item => {
      const status = resolveThreadActivity({ status: item.status, updatedAt: 0 }, null)
      return <li key={item.assignmentId} className="min-w-0 py-2">
        <a href={'#' + item.conversationId} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-(--surface-subtle)">
          <ThreadActivityIndicator status={status} />
          <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
          <ArrowUpRight size={13} className="shrink-0 text-(--muted)" aria-hidden />
        </a>
        <div className="space-y-1 px-2 pt-1 text-xs text-(--muted)">
          <p>{item.agentName} · {THREAD_ACTIVITY_LABELS[status]}{item.disposition === 'accepted' ? ' · Accepted' : ''}</p>
          {item.disposition === 'excluded' ? <p>Excluded: {item.dispositionReason}</p> : null}
          <a href="#chief" className="block truncate hover:text-(--foreground) hover:underline" title={item.parent.title}>Assigned from {item.parent.title}</a>
          {item.origin ? <p>Origin: Slack · {item.origin.channelName ? `#${item.origin.channelName.replace(/^#/, '')}` : item.origin.channelId}</p> : null}
        </div>
      </li>
    })}
  </ul>
}
