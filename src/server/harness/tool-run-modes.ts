/**
 * How the harness may overlap the tool calls a model emits in one step.
 *
 * The AI SDK starts every call from a step at once (see
 * https://ai-sdk.dev/cookbook/node/call-tools-in-parallel). This module decides which of those calls may
 * actually run together:
 *
 * - `parallel`: read-only lookups. They overlap with anything except an exclusive call.
 * - `resource`: calls that read or change a shared resource. Each names the locks it needs, shared or exclusive,
 *   so two writes to one file, or a command and a write on one computer, never overlap.
 * - `exclusive`: plan and control tools, anything that needs approval, and every tool not classified here. They
 *   run alone, so approval prompts still appear one at a time.
 *
 * Calls that conflict always run in the order the model emitted them.
 */

export type HarnessResourceLock = { key: string; exclusive: boolean }

export type HarnessToolRunMode =
  | { kind: 'parallel' }
  | { kind: 'resource'; locks: HarnessResourceLock[] }
  | { kind: 'exclusive' }

/** Tools that only read. Anything not listed here or below runs exclusively. */
const PARALLEL_TOOL_IDS = new Set([
  'search_knowledge', 'search_in_files', 'list_files', 'read_file',
  'search_memory', 'search_messages', 'list_chats', 'read_chat',
  'list_notes', 'get_note', 'list_skills', 'find_skills', 'load_skill', 'search_skill_registries',
  'list_automations', 'list_tasks', 'get_task', 'list_agents', 'read_agent_reply',
  'web_search', 'deep_search', 'web_fetch', 'search_mcp_tools',
])

/** Computer state shared by every command and file on that computer. */
const COMPUTER = 'computer'
/** The visible desktop and browser, which only one actor can drive at a time. */
const DESKTOP = 'computer:desktop'

const shared = (key: string): HarnessResourceLock => ({ key, exclusive: false })
const exclusive = (key: string): HarnessResourceLock => ({ key, exclusive: true })

function field(input: unknown, name: string): unknown {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>)[name] : undefined
}

function stringField(input: unknown, name: string): string | undefined {
  const value = field(input, name)
  return typeof value === 'string' && value ? value : undefined
}

/** File locks normalise trivial spelling differences; anything cleverer would need the computer's filesystem. */
function fileLock(path: string | undefined, write: boolean): HarnessResourceLock[] {
  if (!path) return write ? [exclusive(COMPUTER)] : [shared(COMPUTER)]
  const normalized = path.replace(/\/+/g, '/').replace(/\/\.(?=\/|$)/g, '').replace(/(.)\/$/, '$1')
  return [shared(COMPUTER), { key: `file:${normalized}`, exclusive: write }]
}

function computerRunMode(name: string, input: unknown): HarnessToolRunMode | undefined {
  switch (name) {
    case 'computer_read_file':
    case 'computer_grep':
    case 'computer_glob':
      return { kind: 'resource', locks: fileLock(stringField(input, 'path'), false) }
    case 'computer_list_files':
    case 'computer_publish_file':
      return { kind: 'resource', locks: [shared(COMPUTER)] }
    case 'computer_write_file':
    case 'computer_edit_file':
      return { kind: 'resource', locks: fileLock(stringField(input, 'path'), true) }
    case 'computer_exec':
    case 'computer_apply_patch':
      return { kind: 'resource', locks: [exclusive(COMPUTER)] }
    case 'computer_terminal': {
      const action = field(input, 'action')
      return { kind: 'resource', locks: [action === 'read' || action === 'list' ? shared(COMPUTER) : exclusive(COMPUTER)] }
    }
    case 'computer_screenshot':
      return { kind: 'resource', locks: [shared(DESKTOP)] }
    case 'computer_open_url':
    case 'computer_input':
    case 'computer_browser':
      return { kind: 'resource', locks: [exclusive(DESKTOP)] }
    default:
      return undefined
  }
}

function overlayRunMode(name: string, input: unknown): HarnessToolRunMode | undefined {
  const noteId = stringField(input, 'noteId')
  if (noteId && ['append_to_note', 'replace_note_section', 'edit_note', 'update_note', 'delete_note'].includes(name)) {
    return { kind: 'resource', locks: [exclusive(`note:${noteId}`)] }
  }
  const taskId = stringField(input, 'taskId')
  if (taskId && ['update_task', 'comment_on_task', 'archive_task', 'restore_task'].includes(name)) {
    return { kind: 'resource', locks: [exclusive(`task:${taskId}`)] }
  }
  return undefined
}

export function harnessToolRunMode(
  name: string,
  input: unknown,
  options: { control?: boolean; needsApproval?: boolean } = {},
): HarnessToolRunMode {
  if (options.control || options.needsApproval) return { kind: 'exclusive' }
  if (PARALLEL_TOOL_IDS.has(name)) return { kind: 'parallel' }
  return computerRunMode(name, input) ?? overlayRunMode(name, input) ?? { kind: 'exclusive' }
}

export function harnessRunModesConflict(left: HarnessToolRunMode, right: HarnessToolRunMode): boolean {
  if (left.kind === 'exclusive' || right.kind === 'exclusive') return true
  if (left.kind === 'parallel' || right.kind === 'parallel') return false
  return left.locks.some(a => right.locks.some(b => a.key === b.key && (a.exclusive || b.exclusive)))
}

/**
 * Runs tasks as soon as no earlier unfinished task conflicts with them. A task only waits on tasks enqueued before
 * it, so the scheduler cannot deadlock, and conflicting tasks keep their call order.
 */
export function createHarnessToolScheduler() {
  const active = new Set<{ mode: HarnessToolRunMode; settled: Promise<unknown> }>()
  return {
    run<T>(mode: HarnessToolRunMode, task: () => Promise<T>): Promise<T> {
      const blockers = [...active].filter(entry => harnessRunModesConflict(entry.mode, mode)).map(entry => entry.settled)
      const result = Promise.allSettled(blockers).then(task)
      const entry = { mode, settled: result.then(() => undefined, () => undefined) }
      active.add(entry)
      void entry.settled.then(() => active.delete(entry))
      return result
    },
    get pending(): number { return active.size },
  }
}

export type HarnessToolScheduler = ReturnType<typeof createHarnessToolScheduler>
