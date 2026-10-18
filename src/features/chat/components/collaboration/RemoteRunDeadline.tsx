/** An absolute deadline stays understandable after reload and while progress is quiet. */
export function RemoteRunDeadline({deadlineAt, state}: {deadlineAt?: number; state: string}) {
  if (!deadlineAt || ['completed', 'cancelled', 'failed'].includes(state)) return null
  const deadline = new Date(deadlineAt)
  if (!Number.isFinite(deadline.getTime())) return null
  return <p className="mt-1 text-xs text-(--muted)">
    Task deadline <time dateTime={deadline.toISOString()}>{deadline.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
    })}</time>
  </p>
}
