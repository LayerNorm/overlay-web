/**
 * Codex-style patches for computer_apply_patch. Parsing and applying are pure; the executor reads every touched
 * file, calls planComputerPatch, and only writes when the whole patch applied cleanly in memory.
 *
 *   *** Begin Patch
 *   *** Add File: path          (every following line starts with +)
 *   *** Delete File: path
 *   *** Update File: path
 *   *** Move to: new/path       (optional, right after Update File)
 *   @@ optional anchor line     (jump to the next line containing this text)
 *    context line
 *   -removed line
 *   +added line
 *   *** End of File             (optional: the hunk must end at the end of the file)
 *   *** End Patch
 */

export type ComputerPatchHunk = { anchors: string[]; lines: Array<{ kind: ' ' | '-' | '+'; text: string }>; endOfFile: boolean }

export type ComputerPatchOperation =
  | { kind: 'add'; path: string; contents: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: ComputerPatchHunk[] }

export class ComputerPatchError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line ? `Patch line ${line}: ${message}` : message)
  }
}

const HEADER = /^\*\*\* (Add File|Delete File|Update File): (.+)$/

export function parseComputerPatch(patch: string): ComputerPatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop()
  let start = 0
  while (start < lines.length && lines[start]!.trim() === '') start++
  if (lines[start]?.trim() !== '*** Begin Patch') throw new ComputerPatchError('The patch must start with "*** Begin Patch".', start + 1)
  if (lines.at(-1)?.trim() !== '*** End Patch') throw new ComputerPatchError('The patch must end with "*** End Patch".', lines.length)
  const operations: ComputerPatchOperation[] = []
  let index = start + 1
  const end = lines.length - 1
  while (index < end) {
    const line = lines[index]!
    const header = HEADER.exec(line.trim())
    if (!header) {
      if (line.trim() === '') { index++; continue }
      throw new ComputerPatchError(`Expected "*** Add File:", "*** Update File:" or "*** Delete File:", got "${line.slice(0, 80)}".`, index + 1)
    }
    const path = header[2]!.trim()
    index++
    if (header[1] === 'Delete File') { operations.push({ kind: 'delete', path }); continue }
    if (header[1] === 'Add File') {
      const body: string[] = []
      while (index < end && !HEADER.test(lines[index]!.trim())) {
        const added = lines[index]!
        if (!added.startsWith('+')) throw new ComputerPatchError('Every line of an added file must start with "+".', index + 1)
        body.push(added.slice(1))
        index++
      }
      operations.push({ kind: 'add', path, contents: body.length ? `${body.join('\n')}\n` : '' })
      continue
    }
    let moveTo: string | undefined
    if (lines[index]?.startsWith('*** Move to: ')) { moveTo = lines[index]!.slice('*** Move to: '.length).trim(); index++ }
    const hunks: ComputerPatchHunk[] = []
    let hunk: ComputerPatchHunk | undefined
    while (index < end && !HEADER.test(lines[index]!.trim())) {
      const body = lines[index]!
      if (body.startsWith('@@')) {
        const anchor = body.slice(2).trim()
        if (!hunk || hunk.lines.length) { hunk = { anchors: [], lines: [], endOfFile: false }; hunks.push(hunk) }
        if (anchor) hunk.anchors.push(anchor)
      } else if (body === '*** End of File') {
        if (!hunk) throw new ComputerPatchError('"*** End of File" must follow a hunk.', index + 1)
        hunk.endOfFile = true
      } else {
        const kind = body[0]
        // A blank line inside a hunk is an empty context line (editors often strip the leading space).
        if (body === '') { hunk ??= pushHunk(hunks); hunk.lines.push({ kind: ' ', text: '' }) }
        else if (kind === ' ' || kind === '-' || kind === '+') { hunk ??= pushHunk(hunks); hunk.lines.push({ kind, text: body.slice(1) }) }
        else throw new ComputerPatchError(`Hunk lines must start with " ", "-" or "+", got "${body.slice(0, 80)}".`, index + 1)
      }
      index++
    }
    if (!hunks.some(item => item.lines.length) && !moveTo) throw new ComputerPatchError(`Update of ${path} has no changes.`)
    operations.push({ kind: 'update', path, ...(moveTo ? { moveTo } : {}), hunks: hunks.filter(item => item.lines.length) })
  }
  if (!operations.length) throw new ComputerPatchError('The patch contains no file operations.')
  return operations
}

function pushHunk(hunks: ComputerPatchHunk[]): ComputerPatchHunk {
  const hunk = { anchors: [], lines: [], endOfFile: false }
  hunks.push(hunk)
  return hunk
}

/** Exact match first, then ignoring trailing whitespace, then ignoring surrounding whitespace (as Codex does). */
function findSequence(lines: string[], needle: string[], from: number, endOfFile: boolean): number {
  const normalizers = [(s: string) => s, (s: string) => s.trimEnd(), (s: string) => s.trim()]
  for (const normalize of normalizers) {
    const target = needle.map(normalize)
    const candidates = endOfFile ? [lines.length - needle.length] : Array.from({ length: Math.max(0, lines.length - needle.length + 1 - from) }, (_, i) => from + i)
    for (const start of candidates) {
      if (start < from || start < 0) continue
      if (target.every((line, offset) => normalize(lines[start + offset]!) === line)) return start
    }
  }
  return -1
}

export function applyComputerPatchHunks(path: string, original: string, hunks: ComputerPatchHunk[]): string {
  const crlf = original.includes('\r\n')
  const text = crlf ? original.replace(/\r\n/g, '\n') : original
  const trailingNewline = text.endsWith('\n') || text === ''
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
  let cursor = 0
  for (const [hunkIndex, hunk] of hunks.entries()) {
    for (const anchor of hunk.anchors) {
      const found = lines.findIndex((line, i) => i >= cursor && line.includes(anchor))
      const loose = found >= 0 ? found : lines.findIndex((line, i) => i >= cursor && line.trim().includes(anchor.trim()))
      if (loose < 0) throw new ComputerPatchError(`${path}: hunk ${hunkIndex + 1} anchor "@@ ${anchor}" was not found.`)
      cursor = loose + 1
    }
    const before = hunk.lines.filter(line => line.kind !== '+').map(line => line.text)
    const after = hunk.lines.filter(line => line.kind !== '-').map(line => line.text)
    if (!before.length) {
      // Pure insertion: at the anchor position, or at the end of the file.
      const at = hunk.endOfFile || !hunk.anchors.length ? lines.length : cursor
      lines.splice(at, 0, ...after)
      cursor = at + after.length
      continue
    }
    const start = findSequence(lines, before, cursor, hunk.endOfFile)
    if (start < 0) {
      throw new ComputerPatchError(
        `${path}: hunk ${hunkIndex + 1} did not match. Expected these lines${cursor ? ` after line ${cursor}` : ''}:\n${before.slice(0, 8).join('\n')}${before.length > 8 ? '\n…' : ''}\nRe-read the file and regenerate the hunk.`,
      )
    }
    lines.splice(start, before.length, ...after)
    cursor = start + after.length
  }
  const joined = lines.join('\n') + (lines.length && trailingNewline ? '\n' : '')
  return crlf ? joined.replace(/\n/g, '\r\n') : joined
}

export type ComputerPatchFileChange =
  | { kind: 'add'; path: string; after: string }
  | { kind: 'delete'; path: string; before: string }
  | { kind: 'update'; path: string; moveTo?: string; before: string; after: string }

/**
 * Applies every operation in memory against `files` (current contents, null when missing). Throws on the first
 * problem, so nothing is written unless the whole patch applies.
 */
export function planComputerPatch(operations: ComputerPatchOperation[], files: ReadonlyMap<string, string | null>): ComputerPatchFileChange[] {
  const state = new Map(files)
  const changes: ComputerPatchFileChange[] = []
  const touched = new Set<string>()
  const claim = (path: string) => {
    if (touched.has(path)) throw new ComputerPatchError(`${path} appears more than once in the patch; combine its changes into one section.`)
    touched.add(path)
  }
  for (const operation of operations) {
    claim(operation.path)
    const current = state.get(operation.path)
    if (current === undefined) throw new Error(`Patch file ${operation.path} was not loaded.`)
    if (operation.kind === 'add') {
      if (current !== null) throw new ComputerPatchError(`${operation.path} already exists; use "*** Update File" to change it.`)
      changes.push({ kind: 'add', path: operation.path, after: operation.contents })
    } else if (operation.kind === 'delete') {
      if (current === null) throw new ComputerPatchError(`${operation.path} does not exist, so it cannot be deleted.`)
      changes.push({ kind: 'delete', path: operation.path, before: current })
    } else {
      if (current === null) throw new ComputerPatchError(`${operation.path} does not exist; use "*** Add File" to create it.`)
      if (operation.moveTo) {
        claim(operation.moveTo)
        if (state.get(operation.moveTo) !== null) throw new ComputerPatchError(`Cannot move ${operation.path} to ${operation.moveTo}: the destination already exists.`)
      }
      const after = applyComputerPatchHunks(operation.path, current, operation.hunks)
      changes.push({ kind: 'update', path: operation.path, ...(operation.moveTo ? { moveTo: operation.moveTo } : {}), before: current, after })
    }
  }
  return changes
}

/** Every path the patch reads or writes, so the executor can load them first. */
export function computerPatchPaths(operations: ComputerPatchOperation[]): string[] {
  return [...new Set(operations.flatMap(op => op.kind === 'update' && op.moveTo ? [op.path, op.moveTo] : [op.path]))]
}
