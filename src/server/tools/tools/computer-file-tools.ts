import { createHash } from 'node:crypto'

/**
 * Pure helpers behind computer_read_file ranges, computer_grep and computer_glob. They never touch a computer, so
 * the executors stay thin and these can be tested directly.
 */

export const COMPUTER_READ_DEFAULT_LINES = 2_000
export const COMPUTER_READ_MAX_LINE_CHARS = 2_000
export const COMPUTER_READ_MAX_OUTPUT_CHARS = 120_000
export const COMPUTER_SEARCH_DEFAULT_RESULTS = 100
export const COMPUTER_SEARCH_MAX_RESULTS = 1_000
export const COMPUTER_SEARCH_MAX_OUTPUT_CHARS = 40_000
export const COMPUTER_SEARCH_MAX_LINE_CHARS = 500

/** Content hash agents pass back as `expected_sha` so edits never overwrite a newer version. */
export function computerContentSha(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export type ComputerLineSlice = {
  content: string
  startLine: number
  endLine: number
  totalLines: number
  truncated: boolean
  note?: string
}

function clipLine(line: string): string {
  return line.length > COMPUTER_READ_MAX_LINE_CHARS
    ? `${line.slice(0, COMPUTER_READ_MAX_LINE_CHARS)}… [line cut off at ${COMPUTER_READ_MAX_LINE_CHARS} chars]`
    : line
}

/**
 * Lines `offset`..`offset+limit-1` (1-based), each prefixed with its number and a tab. Oversized ranges stop at the
 * output cap and say where to continue instead of failing.
 */
export function sliceComputerLines(text: string, options: { offset?: number; limit?: number; numbered?: boolean } = {}): ComputerLineSlice {
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  const totalLines = lines.length
  const start = Math.max(1, Math.floor(options.offset ?? 1))
  const limit = Math.max(1, Math.floor(options.limit ?? COMPUTER_READ_DEFAULT_LINES))
  const numbered = options.numbered !== false
  const width = String(Math.min(totalLines, start + limit - 1)).length
  const out: string[] = []
  let chars = 0
  let end = start - 1
  for (let index = start - 1; index < Math.min(totalLines, start - 1 + limit); index++) {
    const body = clipLine(lines[index]!)
    const line = numbered ? `${String(index + 1).padStart(width, ' ')}\t${body}` : body
    if (chars + line.length + 1 > COMPUTER_READ_MAX_OUTPUT_CHARS && out.length > 0) break
    out.push(line)
    chars += line.length + 1
    end = index + 1
  }
  const truncated = end < totalLines
  const note = start > totalLines && totalLines > 0
    ? `offset ${start} is past the end of the file (${totalLines} lines).`
    : truncated
      ? `Showing lines ${start}-${end} of ${totalLines}. Read more with offset ${end + 1}.`
      : undefined
  return { content: out.join('\n'), startLine: start, endLine: end, totalLines, truncated, ...(note ? { note } : {}) }
}

export type ComputerGrepInput = {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'files_with_matches' | 'content' | 'count'
  context?: number
  case_insensitive?: boolean
  fixed_strings?: boolean
  multiline?: boolean
  max_results?: number
}

/** ripgrep argv; the pattern always follows `-e` and paths follow `--`, so neither can be read as a flag. */
export function computerGrepArgs(input: ComputerGrepInput, root: string): string[] {
  const mode = input.output_mode ?? 'files_with_matches'
  const args = ['--no-config', '--color', 'never', '--max-columns', String(COMPUTER_SEARCH_MAX_LINE_CHARS), '--max-columns-preview']
  if (mode === 'files_with_matches') args.push('--files-with-matches', '--sortr', 'modified')
  else if (mode === 'count') args.push('--count-matches')
  else {
    args.push('--json')
    const context = Math.min(Math.max(Math.floor(input.context ?? 0), 0), 20)
    if (context) args.push('--context', String(context))
  }
  if (input.case_insensitive) args.push('--ignore-case')
  if (input.fixed_strings) args.push('--fixed-strings')
  if (input.multiline) args.push('--multiline', '--multiline-dotall')
  if (input.glob) args.push('--glob', input.glob)
  if (input.type) args.push('--type', input.type)
  args.push('-e', input.pattern, '--', input.path || root)
  return args
}

export type ComputerGrepMatch = { path: string; line: number; text: string; context?: boolean }

type RgJsonEvent = {
  type: string
  data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number }
}

function capList<T>(items: T[], max: number, size: (item: T) => number) {
  const kept: T[] = []
  let chars = 0
  for (const item of items) {
    if (kept.length >= max) break
    const length = size(item)
    if (chars + length > COMPUTER_SEARCH_MAX_OUTPUT_CHARS && kept.length) break
    kept.push(item)
    chars += length
  }
  return { kept, truncated: kept.length < items.length }
}

/** Turns ripgrep stdout into a size-capped structured result for the model. */
export function parseComputerGrepOutput(stdout: string, input: ComputerGrepInput) {
  const mode = input.output_mode ?? 'files_with_matches'
  const max = Math.min(Math.max(Math.floor(input.max_results ?? COMPUTER_SEARCH_DEFAULT_RESULTS), 1), COMPUTER_SEARCH_MAX_RESULTS)
  const lines = stdout.split('\n').filter(Boolean)
  if (mode === 'files_with_matches') {
    const { kept, truncated } = capList(lines, max, item => item.length + 1)
    return { mode, files: kept, totalFiles: lines.length, truncated }
  }
  if (mode === 'count') {
    const counts = lines.map((line) => {
      const split = line.lastIndexOf(':')
      return { path: line.slice(0, split), count: Number(line.slice(split + 1)) }
    }).filter(item => Number.isFinite(item.count)).sort((a, b) => b.count - a.count)
    const { kept, truncated } = capList(counts, max, item => item.path.length + 8)
    return { mode, counts: kept, totalMatches: counts.reduce((sum, item) => sum + item.count, 0), truncated }
  }
  const matches: ComputerGrepMatch[] = []
  let matchCount = 0
  for (const line of lines) {
    let event: RgJsonEvent
    try { event = JSON.parse(line) as RgJsonEvent } catch (_error) { continue }
    if (event.type !== 'match' && event.type !== 'context') continue
    const path = event.data?.path?.text
    const lineNumber = event.data?.line_number
    if (!path || typeof lineNumber !== 'number') continue
    if (event.type === 'match') matchCount++
    const text = (event.data?.lines?.text ?? '').replace(/\r?\n$/, '').slice(0, COMPUTER_SEARCH_MAX_LINE_CHARS)
    matches.push({ path, line: lineNumber, text, ...(event.type === 'context' ? { context: true } : {}) })
  }
  // Cap by real matches; context lines ride along with the match they surround.
  let seen = 0
  const limited = matches.filter(item => item.context || ++seen <= max)
  const { kept, truncated } = capList(limited, Number.MAX_SAFE_INTEGER, item => item.path.length + item.text.length + 12)
  return { mode, matches: kept, totalMatches: matchCount, truncated: truncated || matchCount > max }
}

export type ComputerGlobInput = { pattern: string; path?: string; max_results?: number }

export function computerGlobArgs(input: ComputerGlobInput, root: string): string[] {
  // Later globs win in ripgrep, so the .git exclusion must follow the caller's pattern.
  return ['--no-config', '--files', '--hidden', '--glob', input.pattern, '--glob', '!.git', '--glob', '!**/.git/**', '--sortr', 'modified', '--', input.path || root]
}

export function parseComputerGlobOutput(stdout: string, input: ComputerGlobInput) {
  const max = Math.min(Math.max(Math.floor(input.max_results ?? COMPUTER_SEARCH_DEFAULT_RESULTS), 1), COMPUTER_SEARCH_MAX_RESULTS)
  const files = stdout.split('\n').filter(Boolean)
  const { kept, truncated } = capList(files, max, item => item.length + 1)
  return { files: kept, totalFiles: files.length, truncated }
}

/** ripgrep exits 1 when nothing matched; only 2+ is a real failure. */
export function ripgrepFailed(exitCode: number): boolean {
  return exitCode !== 0 && exitCode !== 1
}
