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
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--
  const trimmed = path.slice(0, end)
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed
}

/**
 * Hides secret values a command might carry inline before it is shown: env assignments whose name says
 * key/token/secret/password, Authorization headers and password flags. Display only; the stored input is unchanged.
 */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i

export function redactCommand(command: string): string {
  return command
    .replace(/\b([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S+)/g, (whole, name: string) => (SECRET_NAME.test(name) ? `${name}=•••` : whole))
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
type ParsedCommand = { rest: string[]; operands: string[] }

/** A flag that takes a value would make search operand positions ambiguous. */
const SEARCH_VALUE_FLAG = /^-(?:e|f|g|t|T|A|B|C|m|-glob|-type|-regexp|-file|-max-count)$/

function describeSearch({ rest, operands }: ParsedCommand): CommandShape | null {
  if (rest.some(word => SEARCH_VALUE_FLAG.test(word))) return null
  const [pattern, ...paths] = operands
  if (!pattern || paths.length > 1) return null
  return { verb: VERBS.searched, target: paths[0] ?? '.', detail: `for “${clip(pattern, 48)}”` }
}

function describeCat({ rest, operands }: ParsedCommand): CommandShape | null {
  return operands.length === 1 && rest.length === 1 ? { verb: VERBS.read, target: operands[0]! } : null
}

function describeSed({ rest }: ParsedCommand): CommandShape | null {
  if (rest[0] !== '-n' || rest.length !== 3) return null
  const range = /^(\d+)(?:,(\d+))?p$/.exec(rest[1]!)
  if (!range) return null
  return { verb: VERBS.read, target: rest[2]!, range: `:${range[1]}${range[2] ? `-${range[2]}` : ''}` }
}

function lineCountFlag(rest: string[]): number {
  if (rest[0] === '-n') return Number(rest[1])
  const short = /^-(\d+)$/.exec(rest[0] ?? '')
  return short ? Number(short[1]) : 10
}

function describeHeadOrTail(head: boolean, { rest, operands }: ParsedCommand): CommandShape | null {
  const count = lineCountFlag(rest)
  if (operands.length < 1 || operands.length > 2 || !Number.isFinite(count)) return null
  const file = operands.at(-1)!
  return head
    ? { verb: VERBS.read, target: file, range: `:1-${count}` }
    : { verb: VERBS.read, target: file, detail: `last ${count} lines` }
}

function describeLs({ operands }: ParsedCommand): CommandShape | null {
  return operands.length <= 1 ? { verb: VERBS.listed, target: operands[0] ?? '.' } : null
}

function describeFind({ rest, operands }: ParsedCommand): CommandShape | null {
  if (!operands.length || rest.includes('-exec') || rest.includes('-delete')) return null
  return { verb: VERBS.listed, target: operands[0]! }
}

const COMMAND_DESCRIBERS: Record<string, (command: ParsedCommand) => CommandShape | null> = {
  rg: describeSearch,
  grep: describeSearch,
  cat: describeCat,
  sed: describeSed,
  head: command => describeHeadOrTail(true, command),
  tail: command => describeHeadOrTail(false, command),
  ls: describeLs,
  find: describeFind,
}

/**
 * Recognizes a few unambiguous read/search/list commands so the row says what happened. Anything piped, chained,
 * redirected or unfamiliar stays "Ran `command`" rather than risk a wrong summary.
 */
function describeCommand(command: string): CommandShape | null {
  const words = simpleWords(command.trim())
  if (!words?.length) return null
  const [program, ...rest] = words
  const describe = Object.hasOwn(COMMAND_DESCRIBERS, program!) ? COMMAND_DESCRIBERS[program!] : undefined
  return describe ? describe({ rest, operands: rest.filter(word => !word.startsWith('-')) }) : null
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

function fileIdFrom(output: Record<string, unknown> | undefined): string | undefined {
  const id = output?.fileId ?? output?.outputId ?? record(output?.artifact)?.fileId
  return typeof id === 'string' && id ? id : undefined
}

type CallContext = {
  toolName: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  succeeded: boolean
  make: (word: Tense, rest?: Omit<ToolCallDescription, 'verb'>) => ToolCallDescription
}

const target = (value: string) => clip(value, TARGET_DISPLAY_LIMIT)
const inputString = (call: CallContext, ...keys: string[]) => pickFirstStringFromInput(call.input, keys)

function describeCommandCall(call: CallContext, raw: string | null): ToolCallDescription | null {
  if (!raw) return null
  const command = redactCommand(raw)
  const shape = call.toolName === 'computer_exec' ? describeCommand(command) : null
  if (shape) {
    const { verb, target: path, ...rest } = shape
    return call.make(verb, { ...rest, ...(path ? { target: target(basenameOrPath(path)) } : {}), title: command })
  }
  return call.make(VERBS.ran, { code: clip(command.split('\n')[0]!.trim(), COMMAND_DISPLAY_LIMIT), title: command })
}

function describeComputerWrite(call: CallContext): ToolCallDescription | null {
  const path = inputString(call, 'path')
  if (!path) return null
  const { output, succeeded } = call
  const contents = typeof call.input?.contents === 'string' ? call.input.contents : ''
  const created = output?.created === true
  const counted = typeof output?.linesAdded === 'number' && typeof output?.linesRemoved === 'number'
  const stats = !succeeded ? {}
    : counted ? { added: output!.linesAdded as number, removed: output!.linesRemoved as number }
      : created ? { added: lineCount(contents), removed: 0 } : {}
  const word = !succeeded ? VERBS.wrote : created ? VERBS.created : output?.created === false ? VERBS.edited : VERBS.wrote
  return call.make(word, { target: target(basename(path)), title: path, ...stats })
}

function describeOverlayWrite(call: CallContext): ToolCallDescription | null {
  const name = inputString(call, 'name')
  const replacing = Boolean(inputString(call, 'fileId'))
  if (!name && !replacing) return null
  return call.make(replacing ? VERBS.edited : VERBS.created, {
    target: name ? target(basename(name)) : 'a file',
    ...(call.succeeded ? { fileId: fileIdFrom(call.output) } : {}),
  })
}

function describeGenerated(call: CallContext): ToolCallDescription {
  const fileId = call.succeeded && call.output?.status !== 'pending' ? fileIdFrom(call.output) : undefined
  return call.make(VERBS.generated, { target: call.toolName === 'generate_image' ? 'an image' : 'a video', ...(fileId ? { fileId } : {}) })
}

const TOOL_DESCRIBERS: Record<string, (call: CallContext) => ToolCallDescription | null> = {
  computer_exec: call => describeCommandCall(call, inputString(call, 'command')),
  remote_terminal: call => describeCommandCall(call, inputString(call, 'title', 'summary')),
  computer_read_file: (call) => {
    const path = inputString(call, 'path')
    return path ? call.make(VERBS.read, { target: target(basename(path)), title: path }) : null
  },
  computer_write_file: describeComputerWrite,
  computer_list_files: (call) => {
    const path = inputString(call, 'path')
    return call.make(VERBS.listed, path ? { target: target(basenameOrPath(path)), title: path } : { target: '.' })
  },
  computer_open_url: (call) => {
    const url = inputString(call, 'url')
    return url ? call.make(VERBS.opened, { target: target(url.replace(/^https?:\/\//, '').replace(/\/$/, '')), title: url }) : null
  },
  computer_screenshot: call => call.make(VERBS.screenshot),
  computer_publish_file: (call) => {
    const name = inputString(call, 'name') ?? basename(inputString(call, 'sourcePath') ?? '')
    if (!name) return null
    return call.make(VERBS.saved, { target: target(name), detail: 'to Files', ...(call.succeeded ? { fileId: fileIdFrom(call.output) } : {}) })
  },
  write_file: describeOverlayWrite,
  create_note: (call) => {
    const title = inputString(call, 'title', 'name')
    if (!title) return null
    return call.make(VERBS.savedNote, { target: target(title), ...(call.succeeded ? { fileId: noteIdFrom(call.output) } : {}) })
  },
  generate_image: describeGenerated,
  generate_video: describeGenerated,
  animate_image: describeGenerated,
  remote_diff: (call) => {
    const title = inputString(call, 'title')
    if (!title) return null
    const patch = typeof call.input?.patch === 'string' ? call.input.patch : ''
    return call.make(VERBS.edited, { target: target(basenameOrPath(title)), title, ...(patch ? diffStats(patch) : {}) })
  },
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
  const describe = Object.hasOwn(TOOL_DESCRIBERS, toolName) ? TOOL_DESCRIBERS[toolName] : undefined
  if (!describe) return null
  const output = record(toolOutput)
  return describe({
    toolName,
    input: toolInput,
    output,
    succeeded: phase === 'complete' && output?.success !== false,
    make: (word, rest = {}) => ({ verb: verbFor(word, phase), ...rest }),
  })
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
