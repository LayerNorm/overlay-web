import { Check, CircleAlert, LoaderCircle, MessageCircleQuestion, Square } from 'lucide-react'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { THREAD_ACTIVITY_LABELS, summarizeThreadActivity, type ThreadActivity, type ThreadActivityStatus } from '@/shared/agents/thread-activity'

const ICONS = { working: LoaderCircle, needs_input: MessageCircleQuestion, ready: Check, failed: CircleAlert, cancelled: Square }

export function ThreadActivityIndicator({ status }: { status?: ThreadActivityStatus }) {
  // A reviewed result is an ordinary thread: only unreviewed results keep the check.
  if (!status || status === 'idle' || status === 'completed') return null
  const Icon = ICONS[status]
  const label = THREAD_ACTIVITY_LABELS[status]
  return <DelayedTooltip label={label} side="right" className="shrink-0"><span className="agent-thread-status" data-status={status} role="img" aria-label={label}>
    <Icon size={13} className={status === 'working' ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
  </span></DelayedTooltip>
}

/**
 * Subtitle under an agent name. Only in-progress statuses (working, ready,
 * needs you, failed) render; an agent with nothing going on shows just its name.
 */
export function AgentActivitySummary({ activity }: { activity?: ThreadActivity[] }) {
  const summary = summarizeThreadActivity(activity ?? [])
  if (!summary.length) return null
  const label = summary.map(item => `${item.count} ${item.label}`).join(' · ')
  return <span className="block truncate text-[11px] leading-4 text-(--muted)" title={label}>
    {summary.map((item, index) => <span key={item.status}>
      {index > 0 ? ' · ' : ''}<span className="agent-activity-count" data-status={item.status}>{item.count} {item.label}</span>
    </span>)}
  </span>
}
