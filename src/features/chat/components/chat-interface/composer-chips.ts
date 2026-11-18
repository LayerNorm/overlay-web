import type { MentionItem } from '@/shared/knowledge/mention-types'

export type ComposerChipSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string }
  | { kind: 'mention'; item: MentionItem }

const LINK_LABEL_MAX_LENGTH = 34
const URL_PATTERN = /https?:\/\/[^\s<>]+/g

/** Drop sentence punctuation that follows an address without being part of it. */
export function trimComposerUrl(candidate: string): string {
  let url = candidate.replace(/[.,;:!?'"]+$/, '')
  while (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, '')
  return /^https?:\/\/[^/?#]/.test(url) ? url : ''
}

/** The short host and path a link chip shows in place of the full address. */
export function composerLinkLabel(href: string): string {
  let label = href
  try {
    const url = new URL(href)
    label = url.hostname.replace(/^www\./, '') + (url.pathname === '/' ? '' : url.pathname)
  } catch {
    // Keep the raw text.
  }
  return label.length > LINK_LABEL_MAX_LENGTH ? `${label.slice(0, LINK_LABEL_MAX_LENGTH - 1)}…` : label
}

function startsToken(text: string, index: number): boolean {
  return index === 0 || /\s/.test(text[index - 1]!)
}

/**
 * Split plain composer text into the text, link and mention pieces it shows as
 * chips. A mention is rebuilt only for an exact `@name` that belongs to one
 * known item, because plain text carries no identity of its own.
 */
export function splitComposerChipSegments(
  text: string,
  mentionItems: readonly MentionItem[] = [],
): ComposerChipSegment[] {
  const nameCounts = new Map<string, number>()
  for (const item of mentionItems) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1)
  const candidates = mentionItems
    .filter((item) => item.name.trim() && nameCounts.get(item.name) === 1)
    .sort((left, right) => right.name.length - left.name.length)

  const found: Array<{ start: number; end: number; segment: ComposerChipSegment }> = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const href = trimComposerUrl(match[0])
    if (href && startsToken(text, match.index)) {
      found.push({ start: match.index, end: match.index + href.length, segment: { kind: 'link', href } })
    }
  }
  for (let index = text.indexOf('@'); index !== -1; index = text.indexOf('@', index + 1)) {
    if (!startsToken(text, index) || found.some((entry) => index >= entry.start && index < entry.end)) continue
    const item = candidates.find((candidate) => {
      const next = text[index + 1 + candidate.name.length]
      return text.startsWith(candidate.name, index + 1) && (next === undefined || !/[\p{L}\p{N}_]/u.test(next))
    })
    if (item) found.push({ start: index, end: index + 1 + item.name.length, segment: { kind: 'mention', item } })
  }
  found.sort((left, right) => left.start - right.start)

  const segments: ComposerChipSegment[] = []
  let cursor = 0
  for (const entry of found) {
    if (entry.start < cursor) continue
    if (entry.start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, entry.start) })
    segments.push(entry.segment)
    cursor = entry.end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}
