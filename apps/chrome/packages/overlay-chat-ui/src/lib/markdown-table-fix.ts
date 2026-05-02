/**
 * Models often emit broken GFM tables: a second bullet in a cell is placed on the next `|...|`
 * line so the parser treats it as a new row (sometimes with an empty column).
 * Merge those continuations into the previous row using `<br />` (requires rehype-raw + sanitize).
 */

function countPipes(line: string): number {
  return (line.match(/\|/g) || []).length
}

/** Split a table row into cell strings (no outer empty strings from leading/trailing |). */
function splitRowCells(line: string): string[] {
  const t = line.trim()
  if (!t.startsWith('|')) return []
  const inner = t.slice(1).trimEnd()
  const endBar = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return endBar.split('|').map((c) => c.trim())
}

const BULLET_START = /^[•\-*]\s|^-\s|^\d+\.\s/m

function isBulletContinuationRow(cells: string[]): boolean {
  const trimmed = cells.map((c) => c.trim())
  const nonEmpty = trimmed.filter((c) => c !== '')
  if (nonEmpty.length !== 1) return false
  return BULLET_START.test(nonEmpty[0]!)
}

function bulletTextFromRow(cells: string[]): string {
  const trimmed = cells.map((c) => c.trim())
  const hit = trimmed.find((c) => c !== '')
  return hit ?? ''
}

function mergeContinuationIntoPreviousRow(prevLine: string, contLine: string): string {
  const prevCells = splitRowCells(prevLine)
  const contCells = splitRowCells(contLine)
  if (prevCells.length < 2 || contCells.length < 1) return prevLine

  const first = contCells[0] ?? ''
  const second = contCells[1] ?? ''
  const bulletish = BULLET_START.test(first.trim())
  const secondEmpty = (second === '' || second === undefined) && contCells.length <= 2

  // `| • second point |` (one cell) or `| • point | |` (bullet + empty col)
  if (bulletish && (contCells.length === 1 || secondEmpty)) {
    const lastIdx = prevCells.length - 1
    prevCells[lastIdx] = `${prevCells[lastIdx]} <br /> ${first.trim()}`
    return `| ${prevCells.join(' | ')} |`
  }

  return prevLine
}

/** Merge GFM rows where a bullet line was parsed as its own row (often with empty trailing columns). */
function mergeBulletContinuationIntoPreviousRow(prevLine: string, contLine: string): string | null {
  const prevCells = splitRowCells(prevLine)
  const contCells = splitRowCells(contLine)
  if (prevCells.length < 2 || contCells.length < 1) return null
  if (!isBulletContinuationRow(contCells)) return null

  const bullet = bulletTextFromRow(contCells)
  if (!bullet) return null

  const out = [...prevCells]
  let target = out.length - 1
  while (target >= 0 && out[target]!.trim() === '') target--
  if (target < 0) target = out.length - 1
  out[target] = `${out[target]!.trim()} <br /> ${bullet}`
  return `| ${out.join(' | ')} |`
}

function mergeTableBlock(lines: string[]): string[] {
  if (lines.length < 3) return lines

  const headerPipes = countPipes(lines[0]!)
  if (headerPipes < 2) return lines

  const out: string[] = [lines[0]!, lines[1]!]
  let i = 2

  while (i < lines.length) {
    const line = lines[i]!
    i++

    const pipes = countPipes(line)
    // Fewer pipes than header row → continuation of previous markdown row
    if (out.length >= 3 && pipes > 0 && pipes < headerPipes) {
      out[out.length - 1] = mergeContinuationIntoPreviousRow(out[out.length - 1]!, line)
      continue
    }

    if (out.length >= 3 && pipes >= headerPipes) {
      const cells = splitRowCells(line)
      if (
        cells.length >= 2 &&
        BULLET_START.test((cells[0] ?? '').trim()) &&
        (cells[1] === '' || cells[1] === undefined) &&
        cells.length === 2
      ) {
        out[out.length - 1] = mergeContinuationIntoPreviousRow(out[out.length - 1]!, line)
        continue
      }
      const mergedBullet = mergeBulletContinuationIntoPreviousRow(out[out.length - 1]!, line)
      if (mergedBullet) {
        out[out.length - 1] = mergedBullet
        continue
      }
    }

    out.push(line)
  }

  return out
}

export function mergeGfmTableContinuationLines(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trimStart().startsWith('|')) {
      out.push(line)
      i++
      continue
    }

    const block: string[] = []
    while (i < lines.length && lines[i]!.trimStart().startsWith('|')) {
      block.push(lines[i]!)
      i++
    }
    out.push(...mergeTableBlock(block))
  }

  return out.join('\n')
}
