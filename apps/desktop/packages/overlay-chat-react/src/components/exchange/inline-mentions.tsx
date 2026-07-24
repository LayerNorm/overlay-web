import { type ReactNode } from 'react'

export function renderInlineMentions(
  text: string,
  mentions?: Array<{ type: string; id: string; name: string }>
): ReactNode {
  if (!mentions?.length || !text) return text
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const escaped = sorted.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`@(${escaped.join('|')})`, 'g')
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <span
        key={match.index}
        className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-muted)] border border-[var(--border)] px-1.5 py-0.5 text-xs font-medium text-[var(--foreground)] align-middle mx-0.5"
      >
        {match[0]}
      </span>
    )
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
}
