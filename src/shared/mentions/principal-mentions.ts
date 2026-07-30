/**
 * Deterministic `@mention` resolution for humans and agents in a room.
 *
 * Substring matching on display names is not good enough: "@Sam" must not
 * mention "Samantha", and "@Research Bot" must win over "@Research". Mentions
 * are resolved by longest display name first, on word boundaries, and the
 * resulting principal ids are what the client sends — the server never re-parses
 * prose to decide who was addressed.
 */

export type MentionablePrincipal = {
  principalId: string
  displayName: string
  principalType: 'human' | 'agent'
  /** Most recent interaction, used to order suggestions. */
  lastActiveAt?: number
}

export const MENTION_SUGGESTION_LIMIT = 8

export function resolveMentionedPrincipalIds(
  text: string,
  principals: readonly MentionablePrincipal[],
): string[] {
  if (!text.includes('@')) return []
  const haystack = text.toLowerCase()
  const ordered = [...principals].sort((a, b) => b.displayName.length - a.displayName.length)
  const mentioned: string[] = []
  const consumed: Array<[number, number]> = []
  for (const principal of ordered) {
    const needle = `@${principal.displayName.toLowerCase()}`
    let from = 0
    while (from <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, from)
      if (index === -1) break
      from = index + 1
      const end = index + needle.length
      // An address like sam@scout.example is not a mention of Scout.
      if (!startsOnBoundary(haystack, index)) continue
      if (!endsOnBoundary(haystack, end)) continue
      if (consumed.some(([start, stop]) => index < stop && end > start)) continue
      consumed.push([index, end])
      if (!mentioned.includes(principal.principalId)) mentioned.push(principal.principalId)
      break
    }
  }
  return mentioned
}

/**
 * Suggestions for the composer: matches the token after `@`, most recently
 * active first, then alphabetical. Agents are not privileged over humans.
 */
export function suggestMentionPrincipals(args: {
  principals: readonly MentionablePrincipal[]
  query: string
  excludePrincipalId?: string
  limit?: number
}): MentionablePrincipal[] {
  const query = args.query.trim().toLowerCase()
  return args.principals
    .filter((principal) => principal.principalId !== args.excludePrincipalId)
    .filter((principal) => !query || principal.displayName.toLowerCase().includes(query))
    .sort((a, b) => (
      startsWith(b, query) - startsWith(a, query)
      || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)
      || a.displayName.localeCompare(b.displayName)
    ))
    .slice(0, args.limit ?? MENTION_SUGGESTION_LIMIT)
}

/** The active `@token` immediately before the caret, if any. */
export function readMentionQuery(text: string, caret: number): {
  query: string
  start: number
} | null {
  const upToCaret = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const at = upToCaret.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/[\s([{]/.test(upToCaret[at - 1]!)) return null
  const query = upToCaret.slice(at + 1)
  // A newline or a second @ ends the token.
  if (/[\n@]/.test(query)) return null
  return { query, start: at }
}

/** Replaces the active `@token` with the chosen display name. */
export function applyMentionSelection(args: {
  text: string
  caret: number
  principal: MentionablePrincipal
}): { text: string; caret: number } {
  const active = readMentionQuery(args.text, args.caret)
  if (!active) return { text: args.text, caret: args.caret }
  const insertion = `@${args.principal.displayName} `
  const text = args.text.slice(0, active.start) + insertion + args.text.slice(args.caret)
  return { text, caret: active.start + insertion.length }
}

function startsWith(principal: MentionablePrincipal, query: string): number {
  if (!query) return 0
  return principal.displayName.toLowerCase().startsWith(query) ? 1 : 0
}

function startsOnBoundary(text: string, at: number): boolean {
  if (at === 0) return true
  return /[\s([{"'`]/.test(text[at - 1]!)
}

function endsOnBoundary(text: string, end: number): boolean {
  if (end >= text.length) return true
  return !/[\p{L}\p{N}]/u.test(text[end]!)
}
