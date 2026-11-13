import { pickFirstStringFromInput, type ToolLabelPhase } from './tool-labels'

/**
 * A tool row described by what the call did, like a coding agent's activity log:
 * "Read auth.ts:1-50", "Searched src for “x”", "Ran `npm test`", "Edited a.ts +20 −6".
 * `verb` is muted; `target` (a file, folder or note) and `code` (a command) are emphasized.
 */
export type ToolCallDescription = {
  verb: string
  target?: string
  /** Line range shown after the target, like ":1-50". */
  range?: string
  /** Muted trailing text, like `for “query”`. */
  detail?: string
  /** A shell command, shown in the mono font. */
  code?: string
  /** Unclipped text for the row's tooltip (full path or command), already redacted. */
  title?: string
  added?: number
  removed?: number
  /** An Overlay file the call created; the row opens it. */
  fileId?: string
}

const COMMAND_DISPLAY_LIMIT = 90
const TARGET_DISPLAY_LIMIT = 80

type Tense = { running: string; done: string; failed: string }
const tense = (running: string, done: string): Tense => ({ running, done, failed: `${running} failed` })

const VERBS = {
  ran: tense('Running', 'Ran'),
  read: tense('Reading', 'Read'),
  searched: tense('Searching', 'Searched'),
  listed: tense('Listing', 'Listed'),
  created: tense('Creating', 'Created'),
  edited: tense('Editing', 'Edited'),
  wrote: tense('Writing', 'Wrote'),
  opened: tense('Opening', 'Opened'),
  screenshot: tense('Taking a screenshot', 'Took a screenshot'),
  savedNote: tense('Saving note', 'Saved note'),
  generated: tense('Generating', 'Generated'),
  saved: tense('Saving', 'Saved'),
} as const

function verbFor(word: Tense, phase: ToolLabelPhase): string {
  if (phase === 'running') return word.running
  if (phase === 'error') return word.failed
  if (phase === 'denied') return `${word.running} denied`
  return word.done
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed
}

/**
 * Hides secret values a command might carry inline before it is shown: env assignments whose name says
 * key/token/secret/password, Authorization headers and password flags. Display only; the stored input is unchanged.
 */
export function redactCommand(command: string): string {
  return command
    .replace(/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, '$1=•••')
    .replace(/(Authorization:\s*(?:Bearer|Basic|Token)?\s*)("[^"]*"|'[^']*'|[^\s'"]+)/gi, '$1•••')
    .replace(/(--?(?:password|passwd|token|api-key|secret)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, '$1•••')
}

/** Counts changed lines of a unified diff, ignoring the file headers. */
export function diffStats(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

function unquote(token: string): string {
  return token.replace(/^(['"])(.*)\1$/, '$2')
}

/** Splits a simple command into words, keeping quoted words whole. Returns null for anything with shell syntax. */
function simpleWords(command: string): string[] | null {
  if (/[|;&<>`$()]|\n/.test(command.replace(/'[^']*'|"[^"]*"/g, ''))) return null
  return command.match(/'[^']*'|"[^"]*"|\S+/g)?.map(unquote) ?? null
}

type CommandShape = Omit<ToolCallDescription, 'verb' | 'title'> & { verb: Tense }

/**
 * Recognizes a few unambiguous read/search/list commands so the row says what happened. Anything piped, chained,
 * redirected or unfamiliar stays "Ran `command`" rather than risk a wrong summary.
 */
function describeCommand(command: string): CommandShape | null {
  const words = simpleWords(command.trim())
  if (!words?.length) return null
  const [program, ...rest] = words
  const operands = rest.filter(word => !word.startsWith('-'))
  if (program === 'rg' || program === 'grep') {
    // A flag that takes a value would make operand positions ambiguous.
    if (rest.some(word => /^-(?:e|f|g|t|T|A|B|C|m|-glob|-type|-regexp|-file|-max-count)$/.test(word))) return null
    const [pattern, ...paths] = operands
    if (!pattern || paths.length > 1) return null
    return { verb: VERBS.searched, target: paths[0] ?? '.', detail: `for “${clip(pattern, 48)}”` }
  }
  if (program === 'cat' && operands.length === 1 && rest.length === 1) {
    return { verb: VERBS.read, target: operands[0]! }
  }
  if (program === 'sed' && rest[0] === '-n' && rest.length === 3) {
    const range = /^(\d+)(?:,(\d+))?p$/.exec(rest[1]!)
    if (range) return { verb: VERBS.read, target: rest[2]!, range: `:${range[1]}${range[2] ? `-${range[2]}` : ''}` }
  }
  if ((program === 'head' || program === 'tail') && operands.length >= 1) {
    const file = operands.at(-1)!
    const count = /^-n$/.test(rest[0] ?? '') ? Number(rest[1]) : /^-(\d+)$/.exec(rest[0] ?? '')?.[1] ? Number(rest[0]!.slice(1)) : 10
    if (operands.length > 2 || !Number.isFinite(count)) return null
    if (program === 'head') return { verb: VERBS.read, target: file, range: `:1-${count}` }
    return { verb: VERBS.read, target: file, detail: `last ${count} lines` }
  }
  if (program === 'ls' && operands.length <= 1) return { verb: VERBS.listed, target: operands[0] ?? '.' }
  if (program === 'find' && operands.length >= 1 && !rest.includes('-exec') && !rest.includes('-delete')) {
    return { verb: VERBS.listed, target: operands[0]! }
  }
  return null
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

function fileIdFrom(output: Record<string, unknown> | undefined): string | undefined {
  const id = output?.fileId ?? output?.outputId ?? record(output?.artifact)?.fileId
  return typeof id === 'string' && id ? id : undefined
}

/**
 * Describes a call from its input and, once finished, its output. Returns null for tools without a richer
 * description; callers then use `getDescriptiveToolLabel`.
 */
export function describeToolCall(
  toolName: string,
  toolInput?: Record<string, unknown>,
  toolOutput?: unknown,
  phase: ToolLabelPhase = 'running',
): ToolCallDescription | null {
  const output = record(toolOutput)
  const succeeded = phase === 'complete' && output?.success !== false
  const make = (word: Tense, rest: Omit<ToolCallDescription, 'verb'> = {}): ToolCallDescription =>
    ({ verb: verbFor(word, phase), ...rest })
  const path = pickFirstStringFromInput(toolInput, ['path'])

  switch (toolName) {
    case 'computer_exec': {
      const raw = pickFirstStringFromInput(toolInput, ['command'])
      if (!raw) return null
      const command = redactCommand(raw)
      const shape = describeCommand(command)
      if (shape) {
        const { verb, target, ...rest } = shape
        return make(verb, { ...rest, ...(target ? { target: clip(basenameOrPath(target), TARGET_DISPLAY_LIMIT) } : {}), title: command })
      }
      const firstLine = command.split('\n')[0]!.trim()
      return make(VERBS.ran, { code: clip(firstLine, COMMAND_DISPLAY_LIMIT), title: command })
    }
    case 'computer_read_file':
      return path ? make(VERBS.read, { target: clip(basename(path), TARGET_DISPLAY_LIMIT), title: path }) : null
    case 'computer_write_file': {
      if (!path) return null
      const contents = typeof toolInput?.contents === 'string' ? toolInput.contents : ''
      const created = output?.created === true
      const stats = succeeded && typeof output?.linesAdded === 'number' && typeof output?.linesRemoved === 'number'
        ? { added: output.linesAdded, removed: output.linesRemoved }
        : succeeded && created ? { added: lineCount(contents), removed: 0 } : {}
      const word = !succeeded ? VERBS.wrote : created ? VERBS.created : output?.created === false ? VERBS.edited : VERBS.wrote
      return make(word, { target: clip(basename(path), TARGET_DISPLAY_LIMIT), title: path, ...stats })
    }
    case 'computer_list_files':
      return make(VERBS.listed, path ? { target: clip(basenameOrPath(path), TARGET_DISPLAY_LIMIT), title: path } : { target: '.' })
    case 'computer_open_url': {
      const url = pickFirstStringFromInput(toolInput, ['url'])
      if (!url) return null
      return make(VERBS.opened, { target: clip(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), TARGET_DISPLAY_LIMIT), title: url })
    }
    case 'computer_screenshot':
      return make(VERBS.screenshot)
    case 'computer_publish_file': {
      const name = pickFirstStringFromInput(toolInput, ['name']) ?? basename(pickFirstStringFromInput(toolInput, ['sourcePath']) ?? '')
      if (!name) return null
      return make(VERBS.saved, { target: clip(name, TARGET_DISPLAY_LIMIT), detail: 'to Files', ...(succeeded ? { fileId: fileIdFrom(output) } : {}) })
    }
    case 'write_file': {
      const name = pickFirstStringFromInput(toolInput, ['name'])
      const replacing = Boolean(pickFirstStringFromInput(toolInput, ['fileId']))
      if (!name && !replacing) return null
      return make(replacing ? VERBS.edited : VERBS.created, {
        target: name ? clip(basename(name), TARGET_DISPLAY_LIMIT) : 'a file',
        ...(succeeded ? { fileId: fileIdFrom(output) } : {}),
      })
    }
    case 'create_note': {
      const title = pickFirstStringFromInput(toolInput, ['title', 'name'])
      if (!title) return null
      return make(VERBS.savedNote, { target: clip(title, TARGET_DISPLAY_LIMIT), ...(succeeded ? { fileId: noteIdFrom(output) } : {}) })
    }
    case 'generate_image':
    case 'generate_video':
    case 'animate_image': {
      const kind = toolName === 'generate_image' ? 'an image' : 'a video'
      const fileId = succeeded && output?.status !== 'pending' ? fileIdFrom(output) : undefined
      return make(VERBS.generated, { target: kind, ...(fileId ? { fileId } : {}) })
    }
    case 'remote_diff': {
      const title = pickFirstStringFromInput(toolInput, ['title'])
      if (!title) return null
      const patch = typeof toolInput?.patch === 'string' ? toolInput.patch : ''
      const stats = patch ? diffStats(patch) : {}
      return make(VERBS.edited, { target: clip(basenameOrPath(title), TARGET_DISPLAY_LIMIT), title, ...stats })
    }
    case 'remote_terminal': {
      const raw = pickFirstStringFromInput(toolInput, ['title', 'summary'])
      if (!raw) return null
      const command = redactCommand(raw)
      return make(VERBS.ran, { code: clip(command.split('\n')[0]!.trim(), COMMAND_DISPLAY_LIMIT), title: command })
    }
    default:
      return null
  }
}

function noteIdFrom(output: Record<string, unknown> | undefined): string | undefined {
  const id = output?.noteId ?? output?.fileId
  return typeof id === 'string' && id ? id : undefined
}

/** A folder or "." stays as written; a file path shows only its name. */
function basenameOrPath(path: string): string {
  if (path === '.' || path === './' || path.endsWith('/')) return path
  return path.includes('/') && !/\.[A-Za-z0-9]+$/.test(path) ? path : basename(path)
}

/** The row's plain text, for screen readers and string-only consumers. */
export function toolCallDescriptionText(description: ToolCallDescription): string {
  return [
    description.verb,
    description.target ? `${description.target}${description.range ?? ''}` : '',
    description.detail ?? '',
    description.code ?? '',
    description.added !== undefined ? `+${description.added}` : '',
    description.removed !== undefined ? `−${description.removed}` : '',
  ].filter(Boolean).join(' ')
}

/** Lines a turn's finished file edits added and removed, or null when no edit reported counts. */
export function summarizeTurnDiff(
  calls: ReadonlyArray<{ kind: string; name?: string; state?: string; toolInput?: Record<string, unknown>; toolOutput?: unknown }>,
): { added: number; removed: number } | null {
  let added = 0
  let removed = 0
  let counted = false
  for (const call of calls) {
    if (call.kind !== 'tool' || !call.name || call.state !== 'output-available') continue
    const description = describeToolCall(call.name, call.toolInput, call.toolOutput, 'complete')
    if (description?.added === undefined && description?.removed === undefined) continue
    added += description.added ?? 0
    removed += description.removed ?? 0
    counted = true
  }
  return counted ? { added, removed } : null
}
