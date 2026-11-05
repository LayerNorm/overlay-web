import { Check, CircleAlert, LoaderCircle, MessageCircleQuestion, Square } from 'lucide-react'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { THREAD_ACTIVITY_LABELS, summarizeThreadActivity, type ThreadActivity, type ThreadActivityStatus } from '@/shared/agents/thread-activity'

const ICONS = { working: LoaderCircle, needs_input: MessageCircleQuestion, ready: Check, completed: Check, failed: CircleAlert, cancelled: Square }

export function ThreadActivityIndicator({ status }: { status?: ThreadActivityStatus }) {
  if (!status || status === 'idle') return <span className="agent-thread-status" aria-hidden />
  const Icon = ICONS[status]
  const label = THREAD_ACTIVITY_LABELS[status]
  return <DelayedTooltip label={label} side="right" className="shrink-0"><span className="agent-thread-status" data-status={status} role="img" aria-label={label}>
    <Icon size={13} className={status === 'working' ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
  </span></DelayedTooltip>
}

export function AgentActivitySummary({ activity, fallback }: { activity?: ThreadActivity[]; fallback?: string }) {
  const summary = summarizeThreadActivity(activity ?? [])
  const label = summary.map(item => `${item.count} ${item.label}`).join(' · ') || fallback || (activity ? 'No active tasks' : '')
  return <span className="block truncate text-[11px] leading-4 text-(--muted)" title={label}>
    {summary.length ? summary.map((item, index) => <span key={item.status}>
      {index > 0 ? ' · ' : ''}<span className="agent-activity-count" data-status={item.status}>{item.count} {item.label}</span>
    </span>) : label}
  </span>
}
