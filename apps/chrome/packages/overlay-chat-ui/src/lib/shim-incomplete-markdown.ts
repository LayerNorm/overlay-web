/**
 * Close open markdown structures so partial text renders styled while streaming.
 *
 * Called every render on the streaming tail; idempotent — when the real closer arrives
 * upstream, the next render drops the synthetic one.
 *
 * Handled:
 *   - unclosed fenced code block (odd number of ``` lines) → appends a closing ```
 *   - unclosed math block ($$ … without a trailing $$) → appends $$
 *   - unclosed GFM table header (header row + pipe continuation but no `| --- |`
 *     separator yet) → synthesizes a separator so rows render as a <table>
 *   - unclosed inline span (bold ** / italic * / inline code `) → appends matching token
 *
 * All shims are appended AFTER content, never inserted — this is token-safe.
 */
export function shimIncompleteMarkdown(text: string): string {
  if (!text) return text

  // 1. Fenced code block — count ``` occurrences. Odd → open.
  //    Must run BEFORE the inline-span pass because inside a code fence, raw `**` / `*`
  //    / single backticks are literal characters, not markdown syntax.
  const fenceMatches = text.match(/^```/gm)
  const fenceCount = fenceMatches ? fenceMatches.length : 0
  if (fenceCount % 2 === 1) {
    const needsNewline = !text.endsWith('\n')
    return text + (needsNewline ? '\n' : '') + '```'
  }

  // 2. Math block $$ — count standalone lines of exactly `$$`.
  const mathMatches = text.match(/^\$\$\s*$/gm)
  const mathCount = mathMatches ? mathMatches.length : 0
  if (mathCount % 2 === 1) {
    const needsNewline = !text.endsWith('\n')
    return text + (needsNewline ? '\n' : '') + '$$'
  }

  let out = text

  // 3. GFM table shim: a header row exists with no separator row yet.
  //    Detect the last contiguous run of pipe-lines at the tail.
  out = shimIncompleteTable(out)

  // 4. Inline spans on the last line — open bold **, italic *, or inline code `.
  out = shimIncompleteInlineSpans(out)

  return out
}

/**
 * Consider the last block of non-empty lines where every line starts with `|`.
 * If that run has exactly one line (the header) with no separator yet, or two lines
 * where the "second" is the start of a data row but no `---` separator was emitted,
 * inject a synthetic separator so remark-gfm recognizes the table live.
 *
 * Only triggers when:
 *   - header has at least one `|`-delimited cell
 *   - no line in the run is a valid GFM separator (`| --- | --- |`)
 */
function shimIncompleteTable(text: string): string {
  const lines = text.split('\n')

  // Find the last contiguous block of lines beginning with `|`.
  let endIdx = lines.length - 1
  // If the final line is empty (text ends with \n), use the last non-empty line.
  while (endIdx >= 0 && lines[endIdx]!.trim() === '') endIdx--
  if (endIdx < 0) return text
  if (!lines[endIdx]!.trimStart().startsWith('|')) return text

  let startIdx = endIdx
  while (startIdx - 1 >= 0 && lines[startIdx - 1]!.trimStart().startsWith('|')) {
    startIdx -= 1
  }

  // Guard: need a line before the run to NOT be a table already (i.e. this is a fresh
  // header, not an ongoing table whose separator already landed).
  const runHasSeparator = lines
    .slice(startIdx, endIdx + 1)
    .some((line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
  if (runHasSeparator) return text

  const header = lines[startIdx]!
  const cells = countPipeCells(header)
  if (cells < 1) return text

  // Synthesize an insert point after the header line. Real separator lands on next update.
  const separator = '| ' + Array.from({ length: cells }, () => '---').join(' | ') + ' |'
  const insertAfter = startIdx

  const beforeInsert = lines.slice(0, insertAfter + 1)
  const afterInsert = lines.slice(insertAfter + 1)
  return [...beforeInsert, separator, ...afterInsert].join('\n')
}

/** Count the cell count implied by a pipe row. Trims leading/trailing `|`. */
function countPipeCells(line: string): number {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return 0
  // Strip the bounding pipes and split on the rest.
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  if (!body.trim()) return 0
  return body.split('|').length
}

/**
 * Close open bold/italic/inline-code spans so partial words render styled while streaming.
 * Only inspects the last line to avoid closing inline spans that span multiple lines
 * in ways remark will re-parse differently when the content finishes arriving.
 */
function shimIncompleteInlineSpans(text: string): string {
  const newlineIdx = text.lastIndexOf('\n')
  const lastLine = newlineIdx >= 0 ? text.slice(newlineIdx + 1) : text
  if (!lastLine) return text
  // A fence-marker line's backticks are structural (already balanced by the fence
  // pass above), not inline-code delimiters — skip to avoid a spurious `.
  if (lastLine.trimStart().startsWith('```')) return text

  // Accumulate closers in the right precedence order. Each subsequent count considers
  // the already-appended closers so multiple open span types all close in one pass
  // (the shim is idempotent when applied repeatedly during streaming).
  let closers = ''
  let considered = lastLine

  if (countUnescaped(considered, '`') % 2 === 1) {
    closers += '`'
    considered += '`'
  }
  if (countUnescapedPair(considered, '**') % 2 === 1) {
    closers += '**'
    considered += '**'
  }
  if (countStandaloneAsterisks(considered) % 2 === 1) {
    closers += '*'
    considered += '*'
  }
  if (countUnescaped(considered, '_') % 2 === 1) {
    closers += '_'
  }

  return closers ? text + closers : text
}

function countUnescaped(s: string, ch: string): number {
  let count = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch && s[i - 1] !== '\\') count++
  }
  return count
}

function countUnescapedPair(s: string, pair: string): number {
  if (pair.length !== 2) return 0
  let count = 0
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === pair[0] && s[i + 1] === pair[1] && s[i - 1] !== '\\') {
      count++
      i += 1
    }
  }
  return count
}

/** Count `*` that are NOT part of `**` and NOT leading list markers (`* ` at start). */
function countStandaloneAsterisks(s: string): number {
  let count = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '*') continue
    if (s[i - 1] === '\\') continue
    if (s[i + 1] === '*' || s[i - 1] === '*') continue // part of **
    // Skip a leading list-marker asterisk: start of line + next char is space.
    const isLineStart = i === 0 || s[i - 1] === undefined
    if (isLineStart && s[i + 1] === ' ') continue
    count++
  }
  return count
}
