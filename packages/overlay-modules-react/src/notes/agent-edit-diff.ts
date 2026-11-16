const MAX_LCS_CELLS = 250_000

/** Aligns equal blocks and returns the differing ranges as [baseStart, baseEnd, docStart, docEnd]. */
export function diffBlockKeys(base: readonly string[], next: readonly string[]): Array<[number, number, number, number]> {
  let prefix = 0
  while (prefix < base.length && prefix < next.length && base[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < base.length - prefix && suffix < next.length - prefix
    && base[base.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1
  const a = base.slice(prefix, base.length - suffix)
  const b = next.slice(prefix, next.length - suffix)
  if (a.length === 0 && b.length === 0) return []
  if (a.length * b.length > MAX_LCS_CELLS) return [[prefix, prefix + a.length, prefix, prefix + b.length]]

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const hunks: Array<[number, number, number, number]> = []
  let i = 0
  let j = 0
  let open: [number, number] | null = null
  const close = () => {
    if (open) hunks.push([prefix + open[0], prefix + i, prefix + open[1], prefix + j])
    open = null
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close()
      i += 1
      j += 1
    } else {
      open ??= [i, j]
      if (j < b.length && (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) j += 1
      else i += 1
    }
  }
  close()
  return hunks
}
