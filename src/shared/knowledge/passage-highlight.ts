/** Character span inside a passage, as [start, end) offsets. */
export type PassageHighlight = {
  start: number
  end: number
}

/** Words too common to be worth highlighting; they would light up whole passages. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not',
  'of', 'on', 'or', 'our', 's', 'so', 't', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'you', 'your',
])

const MIN_TERM_CHARS = 2
const MAX_TERMS = 12
const MAX_HIGHLIGHTS = 40

/**
 * Extracts the meaningful terms of a search query, preserving quoted phrases so
 * `"refund window"` highlights as one span rather than two loose words.
 */
export function extractQueryTerms(query: string): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  const phrasePattern = /"([^"]+)"/g
  let remainder = query
  for (const match of query.matchAll(phrasePattern)) {
    const phrase = match[1]!.trim().toLowerCase()
    if (phrase.length >= MIN_TERM_CHARS && !seen.has(phrase)) {
      seen.add(phrase)
      terms.push(phrase)
    }
    remainder = remainder.replace(match[0], ' ')
  }
  for (const raw of remainder.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const term = raw.trim()
    if (term.length < MIN_TERM_CHARS || STOP_WORDS.has(term) || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
    if (terms.length >= MAX_TERMS) break
  }
  return terms
}

/**
 * Finds where a query's terms occur inside a retrieved passage so the UI can
 * highlight exactly the text that grounded an answer.
 *
 * Matching is case-insensitive and constrained to whole words, so searching
 * `art` does not highlight the middle of `start`. Overlapping spans are merged
 * to keep the returned ranges non-overlapping and ordered.
 */
export function findPassageHighlights(passage: string, query: string): PassageHighlight[] {
  if (!passage || !query.trim()) return []
  const terms = extractQueryTerms(query)
  if (terms.length === 0) return []
  const haystack = passage.toLowerCase()
  const spans: PassageHighlight[] = []
  for (const term of terms) {
    let from = 0
    while (spans.length < MAX_HIGHLIGHTS) {
      const at = haystack.indexOf(term, from)
      if (at === -1) break
      from = at + term.length
      if (isWholeWord(haystack, at, term.length)) spans.push({ start: at, end: at + term.length })
    }
    if (spans.length >= MAX_HIGHLIGHTS) break
  }
  return mergeSpans(spans)
}

/**
 * True when the match is not embedded inside a longer word. Phrases already
 * contain separators, so only their outer edges are checked.
 */
function isWholeWord(haystack: string, start: number, length: number): boolean {
  const before = start > 0 ? haystack[start - 1]! : ''
  const after = start + length < haystack.length ? haystack[start + length]! : ''
  return !isWordChar(before) && !isWordChar(after)
}

function isWordChar(value: string): boolean {
  return value !== '' && /[\p{L}\p{N}]/u.test(value)
}

function mergeSpans(spans: PassageHighlight[]): PassageHighlight[] {
  if (spans.length === 0) return []
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: PassageHighlight[] = [sorted[0]!]
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}
