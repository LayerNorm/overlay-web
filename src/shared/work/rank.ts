/**
 * Fractional ranks: strings that sort lexicographically, so a task can be inserted between two neighbours without
 * renumbering anything. Ranks are fractions in base 62 ("0.<digits>"), never ending in "0", and ordered by plain string
 * comparison (digits < upper < lower in ASCII, which Convex also uses for strings).
 *
 * Two clients inserting into the same gap can produce equal ranks; callers break ties with `compareRanked`.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

/** A rank this long (or longer) means a gap has been split many times; the column should be rebalanced. */
export const RANK_REBALANCE_LENGTH = 24

function digitValue(char: string | undefined): number {
  if (char === undefined) return 0
  const index = DIGITS.indexOf(char)
  if (index < 0) throw new Error(`Invalid rank character "${char}"`)
  return index
}

export function isValidRank(rank: unknown): rank is string {
  if (typeof rank !== 'string' || rank.length === 0) return false
  for (const char of rank) if (!DIGITS.includes(char)) return false
  return !rank.endsWith('0')
}

/** A string strictly between `a` and `b` (`a` may be '' for "before everything", `b` null for "after everything"). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let common = 0
    while ((a[common] ?? '0') === b[common]) common += 1
    if (common > 0) return b.slice(0, common) + midpoint(a.slice(common), b.slice(common))
  }
  const low = digitValue(a[0])
  const high = b !== null ? digitValue(b[0]) : BASE
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[low] + midpoint(a.slice(1), null)
}

/**
 * A rank that sorts after `before` and before `after`. Either may be null (start or end of the list). When the
 * neighbours are out of order or equal, the rank goes just after `before`, so a bad pair never throws mid-drag.
 */
export function rankBetween(before: string | null | undefined, after: string | null | undefined): string {
  const low = before ?? ''
  const high = after ?? null
  if (before != null && !isValidRank(before)) throw new Error('Invalid rank')
  if (after != null && !isValidRank(after)) throw new Error('Invalid rank')
  if (high !== null && low >= high) return midpoint(low, null)
  return midpoint(low, high)
}

/** `count` evenly spread, strictly increasing ranks of equal length. Used for first inserts and for rebalancing. */
export function spreadRanks(count: number): string[] {
  if (count <= 0) return []
  let width = 1
  while (BASE ** width <= count + 1) width += 1
  const total = BASE ** width
  const step = Math.floor(total / (count + 1))
  const ranks: string[] = []
  for (let i = 1; i <= count; i += 1) {
    let value = step * i
    let text = ''
    for (let place = 0; place < width; place += 1) {
      text = DIGITS[value % BASE] + text
      value = Math.floor(value / BASE)
    }
    ranks.push(text.replace(/0+$/, '') || DIGITS[1])
  }
  return ranks
}

export function needsRebalance(rank: string): boolean {
  return rank.length >= RANK_REBALANCE_LENGTH
}

/** Order for anything carrying a rank: rank first, then creation time and id so equal ranks stay stable. */
export function compareRanked(
  a: { rank: string; createdAt?: number; id?: string },
  b: { rank: string; createdAt?: number; id?: string },
): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  const byTime = (a.createdAt ?? 0) - (b.createdAt ?? 0)
  if (byTime !== 0) return byTime
  return (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0
}

/**
 * Where to put a dragged item in an ordered column: between the items it was dropped between. `ordered` is the column
 * without the dragged item; `index` is the slot (0 = top). Returns the new rank, plus whether the column should be
 * rebalanced afterwards.
 */
export function rankForSlot(ordered: ReadonlyArray<{ rank: string }>, index: number): { rank: string; rebalance: boolean } {
  const slot = Math.max(0, Math.min(index, ordered.length))
  const rank = rankBetween(ordered[slot - 1]?.rank ?? null, ordered[slot]?.rank ?? null)
  return { rank, rebalance: needsRebalance(rank) }
}
