'use client'

import Link from 'next/link'
import { Button } from '@overlay/ui/primitives'
import { ArrowUpRight } from 'lucide-react'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { agentThreadHref } from '@/components/layout/sidebar-nav'
import { ThreadActivityIndicator } from '@/components/layout/sidebar/ThreadActivityIndicator'
import { THREAD_ACTIVITY_LABELS, resolveThreadActivity } from '@/shared/agents/thread-activity'
import type { AssignmentExecution } from '@/shared/work/assignment-execution'
import { useLiveAssignments } from '../lib/use-live-work'
import { useWorkRoute } from '../lib/use-work-route'

export function AssignmentExecutionRows({ items, onNavigate }: { items: AssignmentExecution[]; onNavigate?: () => void }) {
  const workspaceHref = useWorkspaceHref()
  const href = (item: { agentId: string; conversationId: string; scope: 'personal' | 'workspace' }) =>
    workspaceHref(null, agentThreadHref('/app/agents', item.agentId, item.conversationId, item.scope), item.scope)
  return <ul className="divide-y divide-(--border)/60">
    {items.map(item => {
      const status = resolveThreadActivity({ status: item.status, updatedAt: 0 }, null)
      return <li key={item.assignmentId} className="min-w-0 py-2">
        <Link href={href(item)} onClick={onNavigate} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-(--surface-subtle) focus-visible:outline-2 focus-visible:outline-(--foreground)">
          <ThreadActivityIndicator status={status} />
          <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
          <ArrowUpRight size={13} className="shrink-0 text-(--muted)" aria-hidden />
        </Link>
        <div className="space-y-1 px-2 pt-1 text-xs text-(--muted)">
          <p>{item.agentName} · {THREAD_ACTIVITY_LABELS[status]}{item.disposition === 'accepted' ? ' · Accepted' : ''}</p>
          {item.disposition === 'excluded' ? <p>Excluded: {item.dispositionReason}</p> : null}
          <Link href={href(item.parent)} onClick={onNavigate} className="block truncate hover:text-(--foreground) hover:underline" title={item.parent.title}>Assigned from {item.parent.title}</Link>
          {item.origin ? <p>Origin: Slack · {item.origin.channelName ? `#${item.origin.channelName.replace(/^#/, '')}` : item.origin.channelId}</p> : null}
        </div>
      </li>
    })}
  </ul>
}

export function WorkAssignmentExecutions({ query = '', compact = false, onNavigate }: { query?: string; compact?: boolean; onNavigate?: () => void }) {
  const { listView } = useWorkRoute()
  const { results, status, loadMore } = useLiveAssignments(listView)
  const items = results.filter(item => `${item.title} ${item.agentName}`.toLowerCase().includes(query.trim().toLowerCase()))
  if (status === 'LoadingFirstPage' || (!items.length && status === 'Exhausted')) return null
  return <section aria-label="Agent assignments" className={compact ? 'mt-3 border-t border-(--border) pt-3' : 'mx-6 mb-6 max-h-64 shrink-0 overflow-y-auto border-t border-(--border) pt-4'}>
    <h2 className="px-2 text-xs font-medium text-(--muted)">Agent assignments</h2>
    <AssignmentExecutionRows items={items} onNavigate={onNavigate} />
    {status !== 'Exhausted' ? <Button variant="ghost" size="sm" disabled={status !== 'CanLoadMore'} onClick={() => loadMore(25)}>Load more assignments</Button> : null}
  </section>
}
