export type ThreadActivityStatus = 'idle' | 'working' | 'needs_input' | 'ready' | 'completed' | 'failed' | 'cancelled'

export type ThreadActivity = { conversationId: string; status: ThreadActivityStatus }

export function resolveThreadActivity(
  run: { status: string; completedAt?: number; updatedAt: number } | null,
  participant: { lastReadAt?: number; markedUnreadAt?: number } | null,
): ThreadActivityStatus {
  if (!run) return 'idle'
  switch (run.status) {
    case 'waiting_for_input':
    case 'waiting_for_approval':
    case 'waiting_for_resources':
    case 'waiting_for_authorization': return 'needs_input'
    case 'queued':
    case 'running':
    case 'waiting_for_children': return 'working'
    case 'completed': return participant?.markedUnreadAt
      || (participant?.lastReadAt ?? 0) < (run.completedAt ?? run.updatedAt) ? 'ready' : 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'idle'
  }
}

export const THREAD_ACTIVITY_LABELS: Record<ThreadActivityStatus, string> = {
  idle: 'New thread', working: 'Working', needs_input: 'Needs you', ready: 'Ready to review',
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
}

export function summarizeThreadActivity(activity: readonly ThreadActivity[]) {
  const count = (status: ThreadActivityStatus) => activity.filter(item => item.status === status).length
  return [
    { status: 'working', count: count('working'), label: 'working' },
    { status: 'ready', count: count('ready'), label: 'ready' },
    { status: 'needs_input', count: count('needs_input'), label: 'needs you' },
    { status: 'failed', count: count('failed'), label: 'failed' },
  ].filter(item => item.count > 0)
}
