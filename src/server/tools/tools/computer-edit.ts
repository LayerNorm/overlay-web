/**
 * Exact-string edits for computer_edit_file (and, later, computer_apply_patch). Everything here is pure: the
 * executor reads the file, calls applyComputerEdits, and writes the result only if every edit succeeded.
 */

export type ComputerEdit = { old_string: string; new_string: string; replace_all?: boolean }

export type ComputerEditFailure = { ok: false; code: 'not_found' | 'ambiguous' | 'no_op' | 'empty_old_string'; editIndex: number; message: string }
export type ComputerEditSuccess = { ok: true; text: string; replacements: number }

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) count++
  return count
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** Line numbers of every occurrence, so an ambiguous edit can say where to add context. */
function occurrenceLines(haystack: string, needle: string, max = 5): number[] {
  const lines: number[] = []
  for (let index = haystack.indexOf(needle); index !== -1 && lines.length < max; index = haystack.indexOf(needle, index + needle.length)) {
    lines.push(lineOf(haystack, index))
  }
  return lines
}

/**
 * Applies edits in order to an in-memory copy. Any missing, ambiguous or no-op edit fails the whole batch, so a
 * file is never left half-edited. Each edit sees the result of the edits before it.
 */
export function applyComputerEdits(original: string, edits: ComputerEdit[]): ComputerEditSuccess | ComputerEditFailure {
  // Files with CRLF endings still match edits written with LF, and keep CRLF when written back.
  const crlf = original.includes('\r\n') && !original.replace(/\r\n/g, '').includes('\n')
  let text = crlf ? original.replace(/\r\n/g, '\n') : original
  let replacements = 0
  for (const [editIndex, edit] of edits.entries()) {
    const oldString = crlf ? edit.old_string.replace(/\r\n/g, '\n') : edit.old_string
    const newString = crlf ? edit.new_string.replace(/\r\n/g, '\n') : edit.new_string
    if (!oldString) {
      return { ok: false, code: 'empty_old_string', editIndex, message: `Edit ${editIndex + 1}: old_string is empty. Use computer_write_file to create a file.` }
    }
    if (oldString === newString) {
      return { ok: false, code: 'no_op', editIndex, message: `Edit ${editIndex + 1}: old_string and new_string are identical.` }
    }
    const count = countOccurrences(text, oldString)
    if (count === 0) {
      const trimmed = oldString.trim()
      const hint = trimmed && trimmed !== oldString && text.includes(trimmed)
        ? ' The text exists with different surrounding whitespace; copy it exactly from computer_read_file (without the line-number prefix).'
        : ' Re-read the file with computer_read_file and copy old_string exactly, without the line-number prefix.'
      return { ok: false, code: 'not_found', editIndex, message: `Edit ${editIndex + 1}: old_string was not found${editIndex ? ' after the earlier edits were applied' : ''}.${hint}` }
    }
    if (count > 1 && !edit.replace_all) {
      return {
        ok: false, code: 'ambiguous', editIndex,
        message: `Edit ${editIndex + 1}: old_string matches ${count} places (lines ${occurrenceLines(text, oldString).join(', ')}${count > 5 ? ', …' : ''}). Add surrounding lines to make it unique, or set replace_all.`,
      }
    }
    text = edit.replace_all ? text.split(oldString).join(newString) : text.replace(oldString, () => newString)
    replacements += edit.replace_all ? count : 1
  }
  return { ok: true, text: crlf ? text.replace(/\n/g, '\r\n') : text, replacements }
}

function splitDiffLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

type Op = { kind: ' ' | '-' | '+'; line: string; a: number; b: number }

/** LCS over the changed middle only: edits touch small regions, so trimming the shared prefix and suffix keeps this cheap. */
function diffOps(before: string[], after: string[]): Op[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const a = before.slice(prefix, before.length - suffix)
  const b = after.slice(prefix, after.length - suffix)
  const ops: Op[] = []
  for (let i = 0; i < prefix; i++) ops.push({ kind: ' ', line: before[i]!, a: i, b: i })
  if (a.length * b.length > 4_000_000) {
    // Too large for a table; show it as a whole replacement.
    a.forEach((line, i) => ops.push({ kind: '-', line, a: prefix + i, b: prefix }))
    b.forEach((line, i) => ops.push({ kind: '+', line, a: prefix + a.length, b: prefix + i }))
  } else {
    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ kind: ' ', line: a[i]!, a: prefix + i, b: prefix + j }); i++; j++ }
      // Removals come before additions, as in a unified diff.
      else if (i < a.length && (j >= b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) { ops.push({ kind: '-', line: a[i]!, a: prefix + i, b: prefix + j }); i++ }
      else { ops.push({ kind: '+', line: b[j]!, a: prefix + i, b: prefix + j }); j++ }
    }
  }
  for (let k = 0; k < suffix; k++) {
    ops.push({ kind: ' ', line: before[before.length - suffix + k]!, a: before.length - suffix + k, b: after.length - suffix + k })
  }
  return ops
}

export const COMPUTER_DIFF_MAX_CHARS = 20_000

/** Unified diff with 3 lines of context, capped for the model's context. */
export function unifiedComputerDiff(path: string, before: string, after: string, context = 3) {
  const ops = diffOps(splitDiffLines(before), splitDiffLines(after))
  const changed = ops.map((op, index) => op.kind === ' ' ? -1 : index).filter(index => index >= 0)
  const linesAdded = ops.filter(op => op.kind === '+').length
  const linesRemoved = ops.filter(op => op.kind === '-').length
  if (!changed.length) return { diff: '', linesAdded, linesRemoved, truncated: false }
  const hunks: Array<[number, number]> = []
  for (const index of changed) {
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length - 1, index + context)
    const last = hunks.at(-1)
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else hunks.push([start, end])
  }
  const out = [`--- a${path.startsWith('/') ? '' : '/'}${path}`, `+++ b${path.startsWith('/') ? '' : '/'}${path}`]
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end + 1)
    const oldCount = slice.filter(op => op.kind !== '+').length
    const newCount = slice.filter(op => op.kind !== '-').length
    const oldStart = oldCount ? slice.find(op => op.kind !== '+')!.a + 1 : slice[0]!.a
    const newStart = newCount ? slice.find(op => op.kind !== '-')!.b + 1 : slice[0]!.b
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const op of slice) out.push(`${op.kind}${op.line}`)
  }
  const diff = out.join('\n')
  return diff.length > COMPUTER_DIFF_MAX_CHARS
    ? { diff: `${diff.slice(0, COMPUTER_DIFF_MAX_CHARS)}\n… [diff cut off; re-read the file to see the rest]`, linesAdded, linesRemoved, truncated: true }
    : { diff, linesAdded, linesRemoved, truncated: false }
}
