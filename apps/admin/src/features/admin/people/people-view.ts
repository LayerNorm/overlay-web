const DAY_MS = 86_400_000

/** Up to two initials from a name, else the first letter of the email. */
export function initials(name: string | undefined, email: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length > 0) return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('')
  return (email?.[0] ?? '?').toUpperCase()
}

/** "Oct 30", or "Oct 30, 2025" outside the current year. */
export function shortDate(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
}

/** A UTC day relative to today: "Today", "Yesterday", "3 days ago", else a short date. */
export function relativeDay(day: string, now = Date.now()): string {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  const then = Date.parse(`${day}T00:00:00Z`)
  const days = Math.round((today - then) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(then, now)
}
