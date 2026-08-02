import { Fragment, type ReactNode } from 'react'

export type RoomMention = { type: string; id: string; name: string }

/** `@` followed by a file-ish or single-word token, e.g. `@notes.pdf` or `@maya`. */
const LOOSE_MENTION = /@[^\s@]+/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionChip(label: string, key: string): ReactNode {
  return (
    <span
      key={key}
      className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 align-middle text-xs font-medium text-[var(--foreground)]"
    >
      {label}
    </span>
  )
}

/**
 * Renders `@name` tokens as chips inside a room message, matching how the
 * composer and the personal chat transcript show a mention. Named room members
 * match first (their names may contain spaces); anything else that reads like a
 * mention — a file, an agent typed by hand — still gets the chip treatment so
 * the body does not swallow it as plain prose.
 */
export function RoomMessageMentions({
  text,
  mentions,
}: {
  text: string
  mentions: RoomMention[]
}) {
  if (!text) return null
  const names = [...new Set(mentions.map((mention) => mention.name).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  const pattern = names.length
    ? new RegExp(`@(?:${names.join('|')})|${LOOSE_MENTION.source}`, 'g')
    : new RegExp(LOOSE_MENTION.source, 'g')

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(mentionChip(match[0], `${match.index}-${match[0]}`))
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  if (nodes.length === 0) return <>{text}</>

  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={typeof node === 'string' ? `text-${index}` : index}>{node}</Fragment>
      ))}
    </>
  )
}
