/**
 * Shared serialization for @-mention chips that need to round-trip through plain text /
 * markdown (e.g., automations instructions stored as markdown). The token format is
 * `@<name> [[overlay:<type>:<id>]]`, which renders readably in any plain-text view and
 * can be parsed back into mention metadata at execution time.
 */

import type { MentionType } from '@/shared/knowledge/mention-types'

const VALID_TYPES: ReadonlySet<MentionType> = new Set([
  'file',
  'connector',
  'automation',
  'skill',
  'mcp',
  'chat',
])

const TOKEN_RE = /\[\[overlay:([a-z]+):([^\]]+)\]\]/g

export function serializeMentionToken(type: MentionType, id: string): string {
  return `[[overlay:${type}:${id}]]`
}

export function serializeMentionInline(type: MentionType, id: string, name: string): string {
  return `@${name} ${serializeMentionToken(type, id)}`
}

export interface ParsedMention {
  type: MentionType
  id: string
  /** Best-effort name extracted from the immediately preceding `@<name>` if present. */
  name?: string
}

/**
 * Find every `[[overlay:type:id]]` token in the input. Returns unique mentions in order
 * of first appearance. The optional name is taken from a preceding `@<name>` substring.
 */
export function parseMentionTokens(input: string): ParsedMention[] {
  if (!input) return []
  const seen = new Set<string>()
  const out: ParsedMention[] = []
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(input)) !== null) {
    const rawType = match[1]
    const id = match[2]
    if (!rawType || !id) continue
    if (!VALID_TYPES.has(rawType as MentionType)) continue
    const type = rawType as MentionType
    const key = `${type}::${id}`
    if (seen.has(key)) continue
    seen.add(key)

    // Look back up to ~80 chars for an `@name` immediately preceding this token.
    const sliceStart = Math.max(0, match.index - 80)
    const lookback = input.slice(sliceStart, match.index).trimEnd()
    const nameMatch = lookback.match(/@([^\s@]{1,64})$/)
    out.push({ type, id, name: nameMatch?.[1] })
  }
  return out
}

/** Strip mention tokens from text, keeping the human-readable `@name` portion. */
export function stripMentionTokens(input: string): string {
  if (!input) return ''
  return input.replace(TOKEN_RE, '').replace(/\s{2,}/g, ' ').trim()
}
