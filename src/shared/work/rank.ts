const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
export const MAX_RANK_LENGTH = 32

export function isRank(rank: string): boolean {
  return /^[0-9a-z]+$/.test(rank) && !rank.endsWith('0') && rank.length <= MAX_RANK_LENGTH
}

/** Fractional lexical ranks. Zero is an implicit lower bound; no key ends in zero. */
export function rankBetween(before?: string, after?: string): string {
  if ((before !== undefined && !isRank(before)) || (after !== undefined && !isRank(after))) throw new Error('Invalid rank')
  if (before !== undefined && after !== undefined && before >= after) throw new Error('Ranks must be strictly ordered')
  let prefix = ''
  for (let i = 0; i < MAX_RANK_LENGTH; i++) {
    const lo = before?.[i] === undefined ? 0 : DIGITS.indexOf(before[i])
    const hi = after?.[i] === undefined ? DIGITS.length : DIGITS.indexOf(after[i])
    if (hi - lo > 1) return prefix + DIGITS[Math.floor((lo + hi) / 2)]
    prefix += DIGITS[lo]
    if (hi > lo) after = undefined
  }
  throw new Error('Rank space exhausted; rebalance the column')
}

export function rebalanceRanks(count: number): string[] {
  if (!Number.isInteger(count) || count < 0 || count > 10_000) throw new Error('Invalid rank count')
  const width = 4
  const space = DIGITS.length ** width
  const step = Math.floor(space / (count + 1))
  return Array.from({ length: count }, (_, i) => ((i + 1) * step).toString(36).padStart(width, '0') + 'i')
}
